/**
 * Minimal Stables API client (server-side only).
 *
 * Every write sends an Idempotency-Key (Stables stores the first result for
 * 24h and replays it on retries), so writes are safe to retry on transient
 * failures. Callers pass deterministic keys for money-moving writes so a
 * retried request can never create a second transfer.
 */
import { createHash, randomUUID } from "node:crypto";

import { assertEndpointAllowed } from "@/lib/app-mode.server";
import type { StablesConfig } from "./config.server";
import type {
  CreateQuoteRequest,
  CreateTransferRequest,
  CreateVerificationLinkRequest,
  StablesCustomer,
  StablesCustomerList,
  StablesQuote,
  SimulatedDeposit,
  StablesTransfer,
  StablesVerificationLink,
  ValidatePaymentMethodRequest,
  ValidatePaymentMethodResponse,
} from "./types";

type Configured = Extract<StablesConfig, { configured: true }>;

export class StablesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Array<{ field: string; message: string }> = [],
    /** Stables' machine-readable error code, when it sends one. */
    readonly code?: string,
    /** Stables' x-correlation-id for this response: what its support asks for. */
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "StablesError";
  }
}

const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Deterministic UUID v4-shaped key derived from `parts`, so the same logical
 * write always carries the same Idempotency-Key.
 */
export function idempotencyKey(...parts: string[]): string {
  const bytes = createHash("sha256").update(parts.join("\u0000")).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function request<T>(
  config: Configured,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    if (!options.idempotencyKey)
      throw new Error(`Idempotency-Key is required for ${method} ${path}.`);
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  // Last line of defence: TEST MODE never calls production Stables (and LIVE
  // never the sandbox), whatever config object was passed in.
  assertEndpointAllowed("stables", config.apiUrl);

  let lastError: StablesError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 2)));

    let response: Response;
    try {
      response = await fetch(`${config.apiUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      lastError = new StablesError(
        e instanceof Error && e.name === "TimeoutError"
          ? "Stables did not respond in time."
          : "Could not reach Stables.",
        0,
      );
      continue;
    }

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (response.ok) {
      if (payload === null) throw new StablesError("Stables returned an unreadable response.", 502);
      return payload as T;
    }

    const body = (payload ?? {}) as {
      message?: unknown;
      error?: unknown;
      fields?: unknown;
      code?: unknown;
    };
    const message =
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : `Stables request failed (${response.status}).`;
    const fields = Array.isArray(body.fields) ? (body.fields as StablesError["fields"]) : [];
    const code = typeof body.code === "string" ? body.code : undefined;
    const correlationId = response.headers.get("x-correlation-id") ?? undefined;
    lastError = new StablesError(message, response.status, fields, code, correlationId);
    if (!RETRYABLE.has(response.status)) break;
  }
  throw lastError ?? new StablesError("Stables request failed.", 0);
}

/** Create an individual customer requesting `base_payout`, with a hosted KYC link. */
export function createCustomerWithVerificationLink(
  config: Configured,
  body: CreateVerificationLinkRequest,
  key: string,
) {
  return request<StablesVerificationLink>(config, "POST", "/api/v1/customer/verification/link", {
    body,
    idempotencyKey: key,
  });
}

/** Fresh hosted KYC link for an existing customer. */
export function createVerificationLink(
  config: Configured,
  customerId: string,
  body: Pick<CreateVerificationLinkRequest, "ttl_in_secs" | "redirect">,
) {
  return request<StablesVerificationLink>(
    config,
    "POST",
    `/api/v1/customer/${encodeURIComponent(customerId)}/verification/link`,
    { body, idempotencyKey: randomUUID() },
  );
}

export function getCustomer(config: Configured, customerId: string) {
  return request<StablesCustomer>(
    config,
    "GET",
    `/api/v1/customers/${encodeURIComponent(customerId)}`,
  );
}

/**
 * Every customer of the tenant. The API has no filter or paging, so this is
 * only used to recover a customer we lost track of (see `startKyc`).
 */
export function listCustomers(config: Configured) {
  return request<StablesCustomerList>(config, "GET", "/api/v1/customers");
}

/** Each call asks for a fresh price, so each gets its own key. */
export function createQuote(config: Configured, body: CreateQuoteRequest) {
  return request<StablesQuote>(config, "POST", "/api/v1/quotes", {
    body,
    idempotencyKey: randomUUID(),
  });
}

export function createTransfer(config: Configured, body: CreateTransferRequest, key: string) {
  return request<StablesTransfer>(config, "POST", "/api/v1/transfer", {
    body,
    idempotencyKey: key,
  });
}

/** Current state of a transfer (the REST route behind the MCP `get_transfer` tool). */
export function getTransfer(config: Configured, transferId: string) {
  return request<StablesTransfer>(
    config,
    "GET",
    `/api/v1/transfers/${encodeURIComponent(transferId)}`,
  );
}

/**
 * Check bank details against the destination's payout rules without creating
 * anything or spending the quote. Answers 200 either way; the verdict is in
 * the body. Read-only, so a random key is fine.
 */
export function validatePaymentMethod(config: Configured, body: ValidatePaymentMethodRequest) {
  return request<ValidatePaymentMethodResponse>(
    config,
    "POST",
    "/api/v1/payment-methods/validate",
    {
      body,
      idempotencyKey: randomUUID(),
    },
  );
}

/**
 * SANDBOX ONLY: have Stables act as if the customer's crypto deposit arrived,
 * so an off-ramp transfer can progress to payout without an on-chain payment.
 * The endpoint takes no options (it cannot simulate a wrong amount). Callers
 * pass a key per transfer so a repeated click replays the first result.
 */
export function simulateTransferDeposit(config: Configured, transferId: string, key: string) {
  return request<SimulatedDeposit>(
    config,
    "POST",
    `/api/v1/transfers/${encodeURIComponent(transferId)}/sandbox/simulate-deposit`,
    { body: {}, idempotencyKey: key },
  );
}
