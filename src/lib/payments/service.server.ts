/**
 * Phase 2 payment flow on Stables (non-custodial):
 *
 *   create payment (a Stables preview quote decides whether the destination is
 *   supported) → Stables customer + hosted KYC (verified, base_payout)
 *   → quote (USDC or USDT on Solana, checked against expires_at) → the user's
 *   own bank account (holder name locked to the Stables customer record),
 *   validated by Stables → transfer → user sends the stablecoin from their own
 *   wallet to the single-use deposit address → server verifies the finalized
 *   Solana transaction → Stables webhooks (processed after acknowledging) and
 *   the reconciliation job drive the rest.
 *
 * LamportPay keeps no list of countries or currencies: Stables decides what is
 * supported, and which beneficiary fields a destination needs. LamportPay
 * never holds funds and keeps no balances.
 */
import type { Json } from "@/integrations/supabase/types";
import { toMajor, toMinor } from "@/lib/money";
import { isLikelySignature } from "@/lib/solana-rpc";
import {
  buildUsdcTransferTransaction,
  isValidPublicKey,
  verifyUsdcDeposit,
} from "@/lib/solana-usdc.server";
import * as stables from "@/lib/stables/client.server";
import { StablesError, idempotencyKey } from "@/lib/stables/client.server";
import { getStablesConfig, type StablesConfig } from "@/lib/stables/config.server";
import type {
  BankBeneficiary,
  BankDetailField,
  CreateQuoteRequest,
  PurposeCode,
  SimulatedDeposit,
  StablesCustomer,
  StablesFees,
  StablesQuote,
  StablesTransfer,
  StablesVerificationLink,
  StablesWebhookEvent,
  ValidatePaymentMethodResponse,
} from "@/lib/stables/types";
import { PAYMENT_CURRENCY_MINTS, isPaymentCurrency, type PaymentCurrency } from "@/lib/tokens";
import type { AuthenticatedUser } from "./auth.server";
import * as ledger from "./ledger.server";
import type { PaymentRow, StablesCustomerRow } from "./ledger.server";
import { getPaymentLimits, groupThousands, type PaymentLimits } from "./limits.server";
import {
  checkTransition,
  isTransferState,
  liftsTravelRuleHold,
  normalizeTransferStatus,
  type PaymentState,
  type TransferState,
} from "./state";
import {
  toPaymentListItem,
  toPaymentView,
  type BeneficiarySummary,
  type KycStatus,
  type PaymentListItem,
  type PaymentView,
  type StoredFees,
} from "./view";

/** A field Stables flagged on the beneficiary, in Stables' snake_case naming. */
export type FieldIssue = { field: string | null; message: string };

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** Extra machine-readable context returned to the browser. */
    readonly extra?: { reason?: string; fields?: FieldIssue[] },
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

type Configured = Extract<StablesConfig, { configured: true }>;

const KYC_LINK_TTL_SECONDS = 1800;
const QUOTE_SAFETY_MARGIN_MS = 15_000;

const SANDBOX_FUNDING_MESSAGE =
  "On-chain funding is disabled with the Stables sandbox: sandbox deposit addresses are not real, and mainnet USDC or USDT sent to one would be lost. In the sandbox an admin simulates the deposit instead; use a production key for the real-money test.";

/** The funding stablecoin of a stored payment (the schema allows only these). */
function currencyOf(payment: PaymentRow): PaymentCurrency {
  if (!isPaymentCurrency(payment.source_currency)) {
    throw new Error(
      `Payment ${payment.id} has unknown source currency ${payment.source_currency}.`,
    );
  }
  return payment.source_currency;
}

const label = (currency: string) => currency.toUpperCase();

function requireStables(): Configured {
  const config = getStablesConfig();
  if (!config.configured) {
    throw new PaymentError(
      `Stables is not configured. ${config.reason}`,
      503,
      "stables_not_configured",
    );
  }
  return config;
}

/**
 * Stables field names arrive as `destination.date_of_birth`, `date_of_birth`
 * or legacy camelCase like `bankCodes.abaCode`; normalize to the snake_case
 * destination names the browser form uses.
 */
export function normalizeStablesField(field: string | null | undefined): string | null {
  if (!field) return null;
  return field
    .replace(/^destination\./, "")
    .replace(/^bankCodes\./, "")
    .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Fields named in a Stables error message, e.g. "…require destination.date_of_birth…". */
function fieldsInMessage(message: string): FieldIssue[] {
  return [...message.matchAll(/destination\.([a-z_]+(?:\.[a-z_]+)?)/g)].map((m) => ({
    field: m[1]!,
    message,
  }));
}

/** A 4xx that means Stables refused the request (not auth, not rate limiting). */
function isRejection(error: StablesError): boolean {
  return error.status >= 400 && error.status < 500 && ![401, 403, 429].includes(error.status);
}

/** Map a Stables failure to a response the browser can act on. */
export function fromStablesError(error: StablesError): PaymentError {
  if (isRejection(error)) {
    const fields: FieldIssue[] = [
      ...error.fields.map((f) => ({ field: normalizeStablesField(f.field), message: f.message })),
      ...fieldsInMessage(error.message),
    ];
    const listed = error.fields.map((f) => `${f.field}: ${f.message}`).join("; ");
    return new PaymentError(
      listed ? `${error.message} (${listed})` : error.message,
      422,
      "stables_rejected",
      fields.length ? { fields } : undefined,
    );
  }
  console.error("[stables] request failed", error.status, error.message);
  return new PaymentError(
    "The payout partner is unavailable. Try again shortly.",
    502,
    "stables_unavailable",
  );
}

function rethrow(e: unknown): never {
  throw e instanceof StablesError ? fromStablesError(e) : e;
}

function destinationLabel(country: string, currency: string): string {
  let name = country;
  try {
    name = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
  } catch {
    // Keep the code.
  }
  return `${currency.toUpperCase()} bank payouts to ${name}`;
}

/** Stables would not price or accept this destination. */
function notSupported(country: string, currency: string, reason: string): PaymentError {
  return new PaymentError(
    `${destinationLabel(country, currency)} are not supported for this payment.`,
    422,
    "destination_not_supported",
    { reason },
  );
}

/**
 * Stables refused because of the amount: its per-customer limits (by
 * verification level, per transaction, daily, monthly), a corridor minimum or
 * maximum. These can surface at the quote or only at transfer creation
 * ("limits are evaluated at execution time"). Its own wording is passed on.
 */
function amountRejected(error: StablesError, amount: string): PaymentError | null {
  if (!isRejection(error)) return null;
  const text = `${error.code ?? ""} ${error.message}`;
  if (!/amount|limit|minimum|maximum|exceed|too (low|high|small|large)/i.test(text)) return null;
  return new PaymentError(
    `Stables can't accept ${amount} for this payment.`,
    422,
    "amount_rejected",
    { reason: error.message },
  );
}

async function viewOf(payment: PaymentRow): Promise<PaymentView> {
  return toPaymentView(payment, await ledger.listPaymentEvents(payment.id));
}

async function ownedPayment(user: AuthenticatedUser, paymentId: string): Promise<PaymentRow> {
  const payment = await ledger.getOwnedPayment(paymentId, user.id);
  if (!payment) throw new PaymentError("Payment not found.", 404);
  return payment;
}

/** Partner-reported amount in minor units, or null for a currency we cannot size. */
function minorOrNull(amount: string | undefined | null, currency: string): number | null {
  if (!amount) return null;
  try {
    return Number(toMinor(amount, currency, "round"));
  } catch {
    console.warn(`[stables] could not convert ${amount} ${currency} to minor units`);
    return null;
  }
}

// ------------------------------------------------------------------- limits

function paymentLimits(currency: PaymentCurrency): PaymentLimits {
  try {
    return getPaymentLimits(currency);
  } catch (e) {
    console.error("[payments] invalid payment limits:", e instanceof Error ? e.message : e);
    throw new PaymentError("Payments are temporarily unavailable.", 503, "limits_misconfigured");
  }
}

function checkLimits(amountMinor: bigint, currency: PaymentCurrency) {
  const limits = paymentLimits(currency);
  if (amountMinor < limits.minMinor || amountMinor > limits.maxMinor) {
    throw new PaymentError(
      `Payments must be between ${groupThousands(limits.min)} and ${groupThousands(limits.max)} ${label(currency)}.`,
      400,
      "amount_out_of_range",
    );
  }
}

// ---------------------------------------------------------------- customers

function isCustomerApproved(row: StablesCustomerRow | null): boolean {
  return row?.verification_status === "approved" && row.base_payout_status === "approved";
}

/** "First Last" as on the Stables customer record, or null when it has no name. */
function customerName(record: {
  first_name?: string | null;
  last_name?: string | null;
}): string | null {
  const name = [record.first_name, record.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || null;
}

function kycStatusOf(row: StablesCustomerRow | null): KycStatus {
  const linkLive = row?.kyc_link_expires_at && Date.parse(row.kyc_link_expires_at) > Date.now();
  return {
    status: (row?.verification_status as KycStatus["status"] | null) ?? "not_started",
    basePayout: row?.base_payout_status ?? null,
    subStatus: row?.verification_sub_status ?? [],
    kycLink: linkLive ? row!.kyc_link : null,
    kycLinkExpiresAt: linkLive ? row!.kyc_link_expires_at : null,
    // Only a name Stables holds on an approved record is offered for payouts.
    verifiedName: row && isCustomerApproved(row) ? customerName(row) : null,
  };
}

/** Persist a fresh Stables customer record and advance payments waiting on KYC. */
async function syncCustomer(
  userId: string,
  row: StablesCustomerRow,
  customer: StablesCustomer,
  source: ledger.EventSource,
): Promise<StablesCustomerRow> {
  const levels = customer.verification_levels ?? [];
  const level = levels.find((l) => l.level === "individual_base") ?? levels[0];
  const updated = await ledger.upsertStablesCustomer({
    user_id: userId,
    stables_customer_id: row.stables_customer_id,
    verification_status: level?.status ?? row.verification_status,
    verification_sub_status: level?.sub_status ?? null,
    base_payout_status:
      customer.entitlements?.find((e) => e.name === "base_payout")?.status ??
      row.base_payout_status,
    // Payout account holders must match this name (Stables' own-account rule).
    first_name: customer.first_name?.trim() || row.first_name,
    last_name: customer.last_name?.trim() || row.last_name,
  });
  await advanceKycPayments(userId, updated, source);
  return updated;
}

async function advanceKycPayments(
  userId: string,
  customer: StablesCustomerRow,
  source: ledger.EventSource,
) {
  const target: PaymentState = isCustomerApproved(customer)
    ? "KYC_APPROVED"
    : customer.verification_status === "rejected"
      ? "KYC_REJECTED"
      : "KYC_PENDING";
  for (const payment of await ledger.listPaymentsAwaitingKyc(userId)) {
    if (payment.status === target) continue;
    await ledger.transitionPayment(payment.id, target, {
      source,
      patch: { stables_customer_id: customer.stables_customer_id },
    });
  }
}

export async function getKycStatus(user: AuthenticatedUser): Promise<KycStatus> {
  let row = await ledger.getStablesCustomerForUser(user.id);
  const config = getStablesConfig();
  const settled = row?.verification_status === "rejected" || isCustomerApproved(row);
  if (row && config.configured && !settled) {
    try {
      row = await syncCustomer(
        user.id,
        row,
        await stables.getCustomer(config, row.stables_customer_id),
        "api",
      );
    } catch (e) {
      if (!(e instanceof StablesError)) throw e;
      // Fall back to the stored status; the webhook will catch up.
    }
  }
  return kycStatusOf(row);
}

/**
 * Creating the customer answered 409: Stables already has one for this user,
 * typically from an earlier attempt whose response was lost after the 24h
 * idempotency window. Find it by external_customer_id and adopt it.
 */
async function recoverCustomer(config: Configured, userId: string): Promise<StablesCustomerRow> {
  const { customers } = await stables.listCustomers(config);
  const match = customers.find((c) => c.external_customer_id === userId);
  if (!match) {
    throw new PaymentError(
      "The payout partner already has a customer with these details (such as this email) that is not linked to this account. Contact support.",
      409,
      "stables_customer_conflict",
    );
  }
  console.warn(`[stables] adopted existing customer ${match.customer_id} for user ${userId}`);
  const row = await ledger.upsertStablesCustomer({
    user_id: userId,
    stables_customer_id: match.customer_id,
  });
  return syncCustomer(userId, row, match, "api");
}

/** Create the Stables customer (first time) or a fresh hosted KYC link. */
export async function startKyc(
  user: AuthenticatedUser,
  input: { firstName?: string; lastName?: string; returnUrl: string },
): Promise<KycStatus> {
  const config = requireStables();
  let existing = await ledger.getStablesCustomerForUser(user.id);
  const rejected = () =>
    new PaymentError(
      "Identity verification was rejected by the payout partner.",
      403,
      "kyc_rejected",
    );
  if (isCustomerApproved(existing)) return kycStatusOf(existing);
  if (existing?.verification_status === "rejected") throw rejected();

  const redirect = { success_url: input.returnUrl, reject_url: input.returnUrl };
  const expiresAt = new Date(Date.now() + KYC_LINK_TTL_SECONDS * 1000).toISOString();

  try {
    let link: StablesVerificationLink | null = null;
    if (!existing) {
      try {
        link = await stables.createCustomerWithVerificationLink(
          config,
          {
            customer_type: "individual",
            external_customer_id: user.id,
            email: user.email ?? undefined,
            first_name: input.firstName || undefined,
            last_name: input.lastName || undefined,
            entitlements: ["base_payout"],
            ttl_in_secs: KYC_LINK_TTL_SECONDS,
            redirect,
          },
          idempotencyKey("lamportpay", "customer", user.id),
        );
      } catch (e) {
        if (!(e instanceof StablesError) || e.status !== 409) throw e;
        existing = await recoverCustomer(config, user.id);
        if (isCustomerApproved(existing)) return kycStatusOf(existing);
        if (existing.verification_status === "rejected") throw rejected();
      }
    }
    link ??= await stables.createVerificationLink(config, existing!.stables_customer_id, {
      ttl_in_secs: KYC_LINK_TTL_SECONDS,
      redirect,
    });

    const row = await ledger.upsertStablesCustomer({
      user_id: user.id,
      stables_customer_id: link.customer_id,
      verification_status: existing?.verification_status ?? "in_progress",
      kyc_link: link.kyc_link,
      kyc_link_expires_at: expiresAt,
    });
    await advanceKycPayments(user.id, row, "api");
    return kycStatusOf(row);
  } catch (e) {
    rethrow(e);
  }
}

// ----------------------------------------------------------------- payments

function quoteRequest(
  source: { amountMinor: bigint; currency: PaymentCurrency },
  country: string,
  currency: string,
  options: { preview: true } | { paymentId: string },
): CreateQuoteRequest {
  return {
    source: {
      currency: source.currency,
      network: "solana",
      amount: toMajor(source.amountMinor, source.currency),
    },
    destination: { currency, country, network: "bank" },
    ...("preview" in options ? { preview: true } : { metadata: { payment_id: options.paymentId } }),
  };
}

function storedFees(fees: StablesFees | null | undefined): StoredFees | null {
  if (!fees) return null;
  const out: StoredFees = {};
  for (const [kind, fee] of Object.entries(fees)) {
    if (!fee) continue;
    const minor = minorOrNull(fee.amount, fee.currency);
    // Unknown fee currency: the raw value stays in the partner snapshot.
    if (minor !== null) out[kind] = { amount_minor: minor, currency: fee.currency.toLowerCase() };
  }
  return out;
}

export async function createPayment(
  user: AuthenticatedUser,
  input: { amount: string; country: string; currency: string; sourceCurrency?: PaymentCurrency },
): Promise<PaymentView> {
  const config = requireStables();
  const country = input.country.trim().toUpperCase();
  const currency = input.currency.trim().toLowerCase();
  const sourceCurrency = input.sourceCurrency ?? "usdc";

  let amountMinor: bigint;
  try {
    amountMinor = toMinor(input.amount, sourceCurrency);
  } catch {
    throw new PaymentError(
      `Enter a ${label(sourceCurrency)} amount with at most 6 decimal places.`,
      400,
    );
  }
  checkLimits(amountMinor, sourceCurrency);
  const amountText = `${groupThousands(toMajor(amountMinor, sourceCurrency))} ${label(sourceCurrency)}`;

  const customer = await ledger.getStablesCustomerForUser(user.id);
  if (customer?.verification_status === "rejected") {
    throw new PaymentError(
      "Identity verification was rejected by the payout partner.",
      403,
      "kyc_rejected",
    );
  }

  // Stables decides what is supported: price the route (a preview quote is not
  // persisted) before creating anything.
  let estimate: StablesQuote;
  try {
    estimate = await stables.createQuote(
      config,
      quoteRequest({ amountMinor, currency: sourceCurrency }, country, currency, { preview: true }),
    );
  } catch (e) {
    if (e instanceof StablesError) {
      const byAmount = amountRejected(e, amountText);
      if (byAmount) throw byAmount;
      if (isRejection(e)) throw notSupported(country, currency, e.message);
    }
    rethrow(e);
  }
  if (estimate.destination.currency.toLowerCase() !== currency) {
    throw notSupported(
      country,
      currency,
      `Stables priced ${estimate.destination.currency.toUpperCase()} instead.`,
    );
  }

  let payment = await ledger.insertPayment({
    user_id: user.id,
    source_currency: sourceCurrency,
    source_amount_minor: Number(amountMinor),
    destination_currency: currency,
    destination_country: country,
    stables_customer_id: customer?.stables_customer_id ?? null,
    // Indicative until the real quote after KYC replaces them.
    destination_amount_minor: minorOrNull(estimate.destination.amount, currency),
    exchange_rate: estimate.exchange_rate,
    fees: storedFees(estimate.fees) as Json,
    quote_snapshot: estimate as unknown as Json,
  });
  await ledger.recordEvent(payment.id, "payment_created", "api", {
    to: "PAYMENT_CREATED",
    detail: { estimate_rate: estimate.exchange_rate },
  });

  if (customer) {
    const next: PaymentState = isCustomerApproved(customer) ? "KYC_APPROVED" : "KYC_PENDING";
    payment = (await ledger.transitionPayment(payment.id, next, { source: "api" })).payment;
  }
  return viewOf(payment);
}

export async function getPaymentView(
  user: AuthenticatedUser,
  paymentId: string,
): Promise<PaymentView> {
  return viewOf(await ownedPayment(user, paymentId));
}

/** The signed-in user's payments, newest first (payment history). */
export async function listPayments(user: AuthenticatedUser): Promise<PaymentListItem[]> {
  return (await ledger.listPaymentsForUser(user.id, 100)).map(toPaymentListItem);
}

// ------------------------------------------------------------------ sandbox

/**
 * SANDBOX ONLY, admins only (the caller checks the role): ask Stables to act as
 * if the deposit for this payment's transfer arrived. Refused outright with a
 * live key or a production URL. Stables then sends the transfer webhooks as for
 * a real deposit. The key is per transfer, so a repeat replays the first result.
 */
export async function simulateSandboxDeposit(
  paymentId: string,
  actor: { id: string; email?: string | null },
): Promise<SimulatedDeposit> {
  const config = requireStables();
  if (config.apiKey.startsWith("sti_live_") || config.environment !== "sandbox") {
    throw new PaymentError(
      "Deposit simulation is sandbox-only; it is refused with a live Stables key.",
      403,
      "sandbox_only",
    );
  }
  const payment = await ledger.getPayment(paymentId);
  if (!payment) throw new PaymentError("Payment not found.", 404);
  if (!payment.transfer_id)
    throw new PaymentError("This payment has no Stables transfer yet.", 409);
  if (!FUNDABLE.includes(ledger.paymentState(payment))) {
    throw new PaymentError(
      `Only a transfer waiting for funds can take a deposit; this one is ${payment.status}.`,
      409,
    );
  }

  let result: SimulatedDeposit;
  try {
    result = await stables.simulateTransferDeposit(
      config,
      payment.transfer_id,
      idempotencyKey("lamportpay", "sandbox-deposit", payment.transfer_id),
    );
  } catch (e) {
    rethrow(e);
  }
  await ledger.recordEvent(payment.id, "sandbox_deposit_simulated", "api", {
    detail: {
      simulation_id: result.simulation_id,
      scenario: result.scenario,
      deposit_status: result.deposit_status,
      admin_id: actor.id,
      admin_email: actor.email ?? null,
    },
  });
  return result;
}

export async function quotePayment(
  user: AuthenticatedUser,
  paymentId: string,
): Promise<PaymentView> {
  const config = requireStables();
  let payment = await ownedPayment(user, paymentId);
  const allowed: PaymentState[] = ["PAYMENT_CREATED", "KYC_PENDING", "KYC_APPROVED", "QUOTED"];
  if (!allowed.includes(ledger.paymentState(payment))) {
    throw new PaymentError(`A quote is not possible while the payment is ${payment.status}.`, 409);
  }
  // Limits may have been lowered since the payment was created.
  const sourceCurrency = currencyOf(payment);
  checkLimits(BigInt(payment.source_amount_minor), sourceCurrency);
  const amountText = `${groupThousands(toMajor(BigInt(payment.source_amount_minor), sourceCurrency))} ${label(sourceCurrency)}`;

  const stored = await ledger.getStablesCustomerForUser(user.id);
  if (!stored)
    throw new PaymentError("Verify your identity with Stables first.", 409, "kyc_required");

  try {
    // Always re-check the live customer: verification or entitlements can be revoked.
    const live = await stables.getCustomer(config, stored.stables_customer_id);
    const customer = await syncCustomer(user.id, stored, live, "api");
    if (live.compliance_lock) {
      throw new PaymentError(
        "The payout partner has placed a compliance hold on this account.",
        403,
      );
    }
    if (!isCustomerApproved(customer)) {
      throw new PaymentError(
        "Identity verification is not complete yet (verified customer with base_payout required).",
        409,
        "kyc_required",
      );
    }

    payment = await ownedPayment(user, paymentId);
    let quote: StablesQuote;
    try {
      quote = await stables.createQuote(
        config,
        quoteRequest(
          { amountMinor: BigInt(payment.source_amount_minor), currency: sourceCurrency },
          payment.destination_country,
          payment.destination_currency,
          { paymentId: payment.id },
        ),
      );
    } catch (e) {
      if (e instanceof StablesError) {
        const byAmount = amountRejected(e, amountText);
        if (byAmount) throw byAmount;
        if (isRejection(e)) {
          throw notSupported(payment.destination_country, payment.destination_currency, e.message);
        }
      }
      throw e;
    }

    if (quote.source.currency.toLowerCase() !== sourceCurrency) {
      throw new PaymentError(
        `The partner quoted ${label(quote.source.currency)} instead of ${label(sourceCurrency)}.`,
        502,
      );
    }
    if (toMinor(quote.source.amount, sourceCurrency) !== BigInt(payment.source_amount_minor)) {
      throw new PaymentError("The partner quoted a different amount than requested.", 502);
    }
    if (quote.destination.currency.toLowerCase() !== payment.destination_currency) {
      throw new PaymentError("The partner quoted a different payout currency than requested.", 502);
    }
    if (!(Date.parse(quote.expires_at) > Date.now())) {
      throw new PaymentError("The partner returned an already expired quote. Try again.", 502);
    }

    const patch = {
      stables_customer_id: customer.stables_customer_id,
      quote_id: quote.quote_id,
      quote_expires_at: quote.expires_at,
      quote_snapshot: quote as unknown as Json,
      exchange_rate: quote.exchange_rate,
      destination_amount_minor: minorOrNull(quote.destination.amount, payment.destination_currency),
      fees: storedFees(quote.fees) as Json,
    };
    const detail = { quote_id: quote.quote_id, expires_at: quote.expires_at };

    if (payment.status === "QUOTED") {
      const updated = await ledger.updatePaymentIfStatus(payment.id, "QUOTED", patch, {
        kind: "quote_refreshed",
        source: "api",
        detail,
      });
      if (!updated)
        throw new PaymentError("The payment changed while quoting. Refresh and try again.", 409);
      return viewOf(updated);
    }
    const result = await ledger.transitionPayment(payment.id, "QUOTED", {
      source: "api",
      patch,
      detail,
    });
    if (!result.applied) throw new PaymentError(result.reason, 409);
    return viewOf(result.payment);
  } catch (e) {
    rethrow(e);
  }
}

/**
 * The user's own bank account. There is no holder name or recipient type: the
 * holder is always the user, named as on their approved Stables record.
 */
export type BeneficiaryInput = {
  bankName: string;
  accountNumber?: string;
  iban?: string;
  /** The user's own date of birth and address, only when Stables asks for them. */
  dateOfBirth?: string;
  address?: { street: string; city: string; state: string; postalCode: string; country: string };
  /** Any further bank fields; Stables says which ones a destination needs. */
  details?: Partial<Record<BankDetailField, string>>;
};

export const OWN_ACCOUNT_MESSAGE = "Payouts can only be sent to a bank account in your own name.";

function mask(value: string | undefined): string | null {
  return value ? `••••${value.replace(/\s+/g, "").slice(-4)}` : null;
}

function toBankBeneficiary(
  payment: PaymentRow,
  input: BeneficiaryInput,
  holderName: string,
): BankBeneficiary {
  // Every Stables bank payout needs one of these; everything else is per destination.
  if (!input.accountNumber && !input.iban) {
    throw new PaymentError("Provide an account number or an IBAN.", 400, "beneficiary_invalid", {
      fields: [{ field: "account_number", message: "Provide an account number or an IBAN." }],
    });
  }
  const details = Object.fromEntries(
    Object.entries(input.details ?? {}).filter(([, v]) => typeof v === "string" && v.trim()),
  );
  return {
    ...details,
    type: "bank",
    recipient_type: "individual",
    account_holder_name: holderName,
    bank_name: input.bankName,
    bank_country: payment.destination_country,
    currency: payment.destination_currency.toUpperCase(),
    ...(input.accountNumber && { account_number: input.accountNumber }),
    ...(input.iban && { iban: input.iban }),
    ...(input.dateOfBirth && { date_of_birth: input.dateOfBirth }),
    ...(input.address && {
      address: {
        street: input.address.street,
        city: input.address.city,
        state: input.address.state,
        postal_code: input.address.postalCode,
        country: input.address.country.toLowerCase(),
      },
    }),
  };
}

/** Turn a negative Stables validation verdict into a response the form can use. */
function beneficiaryRejected(
  payment: PaymentRow,
  errors: NonNullable<ValidatePaymentMethodResponse["errors"]>,
): PaymentError {
  const unsupported = errors.find(
    (e) => e.code === "UNSUPPORTED_CURRENCY" || e.code === "UNSUPPORTED_PAYMENT_METHOD",
  );
  if (unsupported) {
    return notSupported(
      payment.destination_country,
      payment.destination_currency,
      unsupported.message,
    );
  }
  const fields = errors.map((e) => ({
    field: normalizeStablesField(e.field),
    message: e.message,
  }));
  return new PaymentError(
    errors.length
      ? `The payout partner needs different recipient details: ${errors.map((e) => e.message).join("; ")}`
      : "The payout partner rejected the recipient details.",
    422,
    "beneficiary_invalid",
    { fields },
  );
}

type DepositInstructions = { address: string; amountMinor: bigint } | { problem: string };

function readDepositInstructions(
  transfer: StablesTransfer,
  expectedMinor: bigint,
  currency: PaymentCurrency,
): DepositInstructions {
  const instructions = transfer.source_deposit_instructions;
  if (!instructions?.wallet_address) return { problem: "No crypto deposit address was returned." };
  if (
    instructions.currency?.toLowerCase() !== currency ||
    instructions.network?.toLowerCase() !== "solana"
  ) {
    return {
      problem: `Deposit expected in ${instructions.currency} on ${instructions.network}, not ${label(currency)} on Solana.`,
    };
  }
  if (!isValidPublicKey(instructions.wallet_address)) {
    return { problem: "The deposit address is not a valid Solana address." };
  }
  let amountMinor: bigint;
  try {
    amountMinor = toMinor(instructions.amount, currency);
  } catch {
    return { problem: `Unreadable deposit amount ${JSON.stringify(instructions.amount)}.` };
  }
  // The user must never be asked to send more (or less) than they agreed to.
  if (amountMinor !== expectedMinor) {
    return {
      problem: `The deposit asks for ${toMajor(amountMinor, currency)} ${label(currency)}, not the quoted ${toMajor(expectedMinor, currency)} ${label(currency)}.`,
    };
  }
  return { address: instructions.wallet_address, amountMinor };
}

/**
 * Partner transfer snapshot without the recipient's bank details: only the
 * masked summary in `beneficiary_summary` is kept.
 */
function redactTransfer(transfer: StablesTransfer): Json {
  const destination = transfer.destination as Record<string, unknown> | null | undefined;
  return {
    ...transfer,
    destination: destination
      ? {
          amount: destination["amount"],
          currency: destination["currency"],
          network: destination["network"],
        }
      : null,
  } as unknown as Json;
}

export async function createPaymentTransfer(
  user: AuthenticatedUser,
  paymentId: string,
  input: { beneficiary: BeneficiaryInput; purposeCode: PurposeCode },
): Promise<PaymentView> {
  const config = requireStables();
  const payment = await ownedPayment(user, paymentId);
  if (payment.status !== "QUOTED" || !payment.quote_id || !payment.stables_customer_id) {
    throw new PaymentError(
      `A transfer needs a quoted payment; this one is ${payment.status}.`,
      409,
    );
  }
  if (
    !payment.quote_expires_at ||
    Date.parse(payment.quote_expires_at) - QUOTE_SAFETY_MARGIN_MS < Date.now()
  ) {
    throw new PaymentError("The quote has expired. Get a new quote first.", 409, "quote_expired");
  }
  const sourceCurrency = currencyOf(payment);

  // Own account only: Stables requires the account holder name to match its
  // customer record, so the name comes from the live, approved record and
  // never from the browser.
  const stored = await ledger.getStablesCustomerForUser(user.id);
  if (!stored)
    throw new PaymentError("Verify your identity with Stables first.", 409, "kyc_required");
  let holderName: string | null;
  try {
    const live = await stables.getCustomer(config, stored.stables_customer_id);
    const customer = await syncCustomer(user.id, stored, live, "api");
    if (live.compliance_lock) {
      throw new PaymentError(
        "The payout partner has placed a compliance hold on this account.",
        403,
      );
    }
    if (!isCustomerApproved(customer)) {
      throw new PaymentError("Identity verification is not complete.", 409, "kyc_required");
    }
    holderName = customerName(live);
  } catch (e) {
    rethrow(e);
  }
  if (!holderName) {
    throw new PaymentError(
      `Stables has no name on your verified profile yet, so we can't confirm the account is yours. ${OWN_ACCOUNT_MESSAGE} Contact support.`,
      409,
      "verified_name_missing",
    );
  }

  const destination = toBankBeneficiary(payment, input.beneficiary, holderName);

  let transfer: StablesTransfer;
  try {
    // Stables applies the destination's rules here without spending the quote.
    // Some missing fields would otherwise surface late, as a stuck transfer.
    const verdict = await stables.validatePaymentMethod(config, { network: "bank", destination });
    if (!verdict.valid) throw beneficiaryRejected(payment, verdict.errors ?? []);

    const body = {
      quote_id: payment.quote_id,
      customer_id: payment.stables_customer_id,
      destination,
      purpose_code: input.purposeCode,
      metadata: { payment_id: payment.id },
    };
    // The key covers the whole request: a retry or double submit replays the
    // original response instead of creating a second transfer, while corrected
    // bank details after a rejection get a fresh key. Stables marks a quote
    // "used" once a transfer consumes it, and an unfunded transfer only expires.
    transfer = await stables.createTransfer(
      config,
      body,
      idempotencyKey("lamportpay", "transfer", payment.id, JSON.stringify(body)),
    );
  } catch (e) {
    // Stables evaluates its per-customer limits here, even after a good quote.
    if (e instanceof StablesError) {
      const amount = toMajor(BigInt(payment.source_amount_minor), sourceCurrency);
      const byAmount = amountRejected(e, `${groupThousands(amount)} ${label(sourceCurrency)}`);
      if (byAmount) throw byAmount;
    }
    rethrow(e);
  }

  // Stables echoes the metadata sent above; anything else means a mix-up.
  const echoed = transfer.metadata?.["payment_id"];
  if (echoed && echoed !== payment.id) {
    console.error(
      `[payments] transfer ${transfer.id} echoes payment_id ${echoed}, not ${payment.id}`,
    );
  }

  const deposit = readDepositInstructions(
    transfer,
    BigInt(payment.source_amount_minor),
    sourceCurrency,
  );
  const status = normalizeTransferStatus(transfer.status) ?? "CREATED";
  const destinationAmount = minorOrNull(transfer.destination?.amount, payment.destination_currency);
  const fees = storedFees(transfer.fees);

  const result = await ledger.transitionPayment(payment.id, status, {
    source: "api",
    detail: {
      transfer_id: transfer.id,
      ...("problem" in deposit && { deposit_problem: deposit.problem }),
    },
    patch: {
      transfer_id: transfer.id,
      transfer_snapshot: redactTransfer(transfer),
      purpose_code: input.purposeCode,
      beneficiary_summary: {
        recipient_type: "individual",
        own_account: true,
        account_holder_name: holderName,
        bank_name: input.beneficiary.bankName,
        bank_country: payment.destination_country,
        account_kind: input.beneficiary.iban ? "iban" : "account_number",
        account: mask(input.beneficiary.iban ?? input.beneficiary.accountNumber),
      } satisfies BeneficiarySummary,
      ...("address" in deposit
        ? { deposit_address: deposit.address, deposit_amount_minor: Number(deposit.amountMinor) }
        : { failure_reason: deposit.problem }),
      ...(destinationAmount !== null && { destination_amount_minor: destinationAmount }),
      ...(fees && { fees: fees as Json }),
      ...(transfer.exchange_rate != null && { exchange_rate: transfer.exchange_rate }),
    },
  });

  if (!result.applied) {
    // A concurrent request (same idempotency key, so the same transfer) won.
    const current = await ownedPayment(user, paymentId);
    if (current.transfer_id !== transfer.id) throw new PaymentError(result.reason, 409);
    return viewOf(current);
  }

  if ("problem" in deposit) console.error(`[payments] ${payment.id}: ${deposit.problem}`);
  await replayPendingEvents(transfer.id);
  return viewOf((await ledger.getPayment(payment.id)) ?? result.payment);
}

// ------------------------------------------------------------------ funding

const FUNDABLE: PaymentState[] = ["CREATED", "AWAITING_FUNDS_COLLECTION"];

function requireLiveFunding() {
  const config = requireStables();
  if (config.environment !== "production") {
    throw new PaymentError(SANDBOX_FUNDING_MESSAGE, 409, "sandbox_funding_disabled");
  }
  return config;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Unsigned USDC or USDT transfer (the payment's stablecoin) to the deposit
 * address, for the user's wallet to sign and send. The wallet it is built for
 * becomes the payment's payer wallet.
 */
export async function buildFundingTransaction(
  user: AuthenticatedUser,
  paymentId: string,
  payer: string,
) {
  requireLiveFunding();
  const payment = await ownedPayment(user, paymentId);
  if (!FUNDABLE.includes(ledger.paymentState(payment))) {
    throw new PaymentError(`This payment cannot be funded while it is ${payment.status}.`, 409);
  }
  if (!payment.deposit_address || payment.deposit_amount_minor === null) {
    throw new PaymentError("This payment has no usable deposit instructions.", 409);
  }
  if (payment.funding_signature) throw new PaymentError("This payment is already funded.", 409);
  if (!isValidPublicKey(payer)) throw new PaymentError("Invalid wallet address.", 400);

  const currency = currencyOf(payment);
  const amountMinor = BigInt(payment.deposit_amount_minor);
  const built = await buildUsdcTransferTransaction({
    payer,
    recipient: payment.deposit_address,
    amountMinor,
    mint: PAYMENT_CURRENCY_MINTS[currency],
  });
  if (!(await ledger.setPayerWallet(payment.id, payer))) {
    throw new PaymentError("This payment is already funded.", 409);
  }
  await ledger.recordEvent(payment.id, "funding_transaction_built", "api", { detail: { payer } });
  return {
    ...built,
    depositAddress: payment.deposit_address,
    amount: toMajor(amountMinor, currency),
    currency,
  };
}

export type FundingResult = { pending: true } | { pending: false; payment: PaymentView };

/**
 * Verify on-chain that `signature` is a finalized transaction in which the
 * payment's payer wallet sent exactly the deposit amount of USDC to this
 * payment's deposit address, then record it. `payer` declares the sending
 * wallet when no funding transaction was prepared for this payment.
 */
export async function verifyFunding(
  user: AuthenticatedUser,
  paymentId: string,
  signature: string,
  declaredPayer?: string,
): Promise<FundingResult> {
  requireLiveFunding();
  const payment = await ownedPayment(user, paymentId);
  if (!isTransferState(ledger.paymentState(payment)) || !payment.deposit_address) {
    throw new PaymentError("This payment has no deposit address yet.", 409);
  }
  if (payment.deposit_amount_minor === null) throw new PaymentError("Missing deposit amount.", 409);
  if (payment.funding_signature) {
    if (payment.funding_signature === signature)
      return { pending: false, payment: await viewOf(payment) };
    throw new PaymentError("A different transaction already funded this payment.", 409);
  }
  if (!isLikelySignature(signature))
    throw new PaymentError("Provide a valid Solana transaction signature.", 400);

  const currency = currencyOf(payment);
  const payer = payment.payer_wallet ?? declaredPayer;
  if (!payer) {
    throw new PaymentError(
      `Enter the wallet address you sent the ${label(currency)} from.`,
      400,
      "payer_required",
    );
  }
  if (!isValidPublicKey(payer)) throw new PaymentError("Invalid wallet address.", 400);
  if (declaredPayer && declaredPayer !== payer) {
    throw new PaymentError(
      `This payment is set to be paid from ${shortAddress(payer)}; the ${label(currency)} must come from that wallet.`,
      409,
      "payer_mismatch",
    );
  }
  if (await ledger.getPaymentByFundingSignature(signature)) {
    throw new PaymentError("That transaction already funded another payment.", 409);
  }

  const result = await verifyUsdcDeposit({
    signature,
    depositOwner: payment.deposit_address,
    payer,
    expectedMinor: BigInt(payment.deposit_amount_minor),
    mint: PAYMENT_CURRENCY_MINTS[currency],
  });
  if (result.status === "pending") return { pending: true };
  if (result.status === "failed") {
    // `received_minor` > 0: funds reached Stables' deposit address anyway (a
    // wrong amount, or the right amount from another wallet). The payment page
    // then warns the user not to send again; what Stables does with it drives
    // the state (see docs/wrong-amount-deposits.md).
    await ledger.recordEvent(payment.id, "funding_rejected", "api", {
      detail: {
        signature,
        payer,
        reason: result.reason,
        received_minor: result.receivedMinor.toString(),
        expected_minor: String(payment.deposit_amount_minor),
      },
    });
    throw new PaymentError(result.reason, 422, "funding_rejected");
  }

  const write = await ledger.recordFunding(
    payment.id,
    {
      funding_signature: signature,
      funding_payer: result.payer,
      payer_wallet: result.payer,
      funding_verified_at: new Date().toISOString(),
    },
    {
      kind: "funding_verified",
      source: "api",
      detail: {
        signature,
        received_minor: result.receivedMinor.toString(),
        slot: result.slot,
        payer: result.payer,
      },
    },
  );
  if (write.status === "signature_taken") {
    throw new PaymentError("That transaction already funded another payment.", 409);
  }
  if (write.status === "already_funded") {
    const current = await ownedPayment(user, paymentId);
    if (current.funding_signature === signature)
      return { pending: false, payment: await viewOf(current) };
    throw new PaymentError("A different transaction already funded this payment.", 409);
  }
  // A Travel Rule request may name the deposit transaction and have arrived first.
  await replayPendingEvents(signature);
  return {
    pending: false,
    payment: await viewOf((await ledger.getPayment(payment.id)) ?? write.payment),
  };
}

// ------------------------------------------------------------------ payouts

function parsePayout(raw: unknown): { minor: bigint; currency: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const { amount, currency } = raw as { amount?: unknown; currency?: unknown };
  if ((typeof amount !== "string" && typeof amount !== "number") || typeof currency !== "string") {
    return null;
  }
  try {
    return { minor: toMinor(String(amount), currency, "round"), currency: currency.toLowerCase() };
  } catch {
    console.warn("[stables] unreadable actual_payout", raw);
    return null;
  }
}

/**
 * Record the settled payout of a completed payment: from `raw` when the caller
 * has it, otherwise from GET /transfers/:id. A failure leaves it for the
 * reconciliation job.
 */
async function settlePayout(
  payment: PaymentRow,
  raw: unknown,
  source: ledger.EventSource,
): Promise<boolean> {
  if (payment.actual_payout_minor !== null || !payment.transfer_id) return false;
  let payout = raw;
  if (!payout) {
    const config = getStablesConfig();
    if (!config.configured) return false;
    try {
      payout = (await stables.getTransfer(config, payment.transfer_id)).actual_payout;
    } catch (e) {
      if (!(e instanceof StablesError)) throw e;
      console.warn(`[stables] could not load transfer ${payment.transfer_id}: ${e.message}`);
      return false;
    }
  }
  const parsed = parsePayout(payout);
  if (!parsed) return false;
  return ledger.recordActualPayout(payment.id, parsed, {
    source,
    detail: { amount: String((payout as { amount: unknown }).amount), currency: parsed.currency },
  });
}

// ----------------------------------------------------------------- webhooks

const KYC_STATUS: Record<string, string> = {
  VERIFICATION_IN_PROGRESS: "in_progress",
  VERIFICATION_APPROVED: "approved",
  VERIFICATION_REJECTED: "rejected",
  VERIFICATION_REQUIRES_ACTION: "requires_action",
};

type EventOutcome = { processed: boolean; note?: string };

const stringOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

/** When Stables created the event; falls back to now for events without a usable time. */
function eventTime(event: StablesWebhookEvent): string {
  const at = Date.parse(event.event_created_at ?? "");
  return new Date(Number.isFinite(at) ? at : Date.now()).toISOString();
}

function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function isoOrNull(value: unknown): string | null {
  const at = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * travel_rule.wallet_verification_required: Stables holds the transaction
 * until the user proves they own the self-custody wallet it involves. The
 * newest request per payment wins; one that arrives after the transfer has
 * already moved on (deliveries can be processed out of order) is stored as
 * lifted straight away.
 */
async function applyTravelRuleRequest(event: StablesWebhookEvent): Promise<EventOutcome> {
  const object = event.event_object ?? {};
  const reference = stringOrNull(object["transaction_reference_id"]) ?? event.event_object_id;
  if (!reference) return { processed: true, note: "Travel Rule request without a reference." };

  const match = await ledger.getPaymentByTravelRuleReference(reference);
  // Stables does not document which ID this is: log it raw with what it
  // matched, so the first real event answers the question.
  console.info(
    JSON.stringify({
      event: "travel_rule_reference",
      event_id: event.event_id,
      transaction_reference_id: object["transaction_reference_id"] ?? null,
      event_object_id: event.event_object_id ?? null,
      matched_by: match?.matchedBy ?? null,
      payment_id: match?.payment.id ?? null,
    }),
  );
  // Left unprocessed: replayed once a transfer or funding signature with this
  // reference is stored, retried by reconciliation, and listed for admins.
  if (!match) return { processed: false, note: `No payment matches reference ${reference}.` };
  const found = match.payment;

  const url = httpsUrlOrNull(object["verification_url"]);
  const expiresAt = isoOrNull(object["expires_at"]);
  const requestedAt = eventTime(event);

  for (let attempt = 0; attempt < 3; attempt++) {
    const payment = attempt === 0 ? found : await ledger.getPayment(found.id);
    if (!payment) throw new Error(`Payment ${found.id} not found.`);
    const stored = payment.travel_rule_requested_at;
    if (stored && Date.parse(stored) > Date.parse(requestedAt)) {
      return { processed: true, note: "A newer Travel Rule request is already stored." };
    }
    if (
      stored &&
      Date.parse(stored) === Date.parse(requestedAt) &&
      payment.travel_rule_verification_url === url
    ) {
      return { processed: true, note: "Travel Rule request already recorded." };
    }

    const liftedAt = await ledger.lastHoldLiftedAt(payment.id);
    const resolvedAt = liftedAt && Date.parse(liftedAt) > Date.parse(requestedAt) ? liftedAt : null;
    const updated = await ledger.replaceTravelRuleRequest(
      payment.id,
      stored,
      {
        travel_rule_reference: reference,
        travel_rule_verification_url: url,
        travel_rule_expires_at: expiresAt,
        travel_rule_requested_at: requestedAt,
        travel_rule_resolved_at: resolvedAt,
      },
      {
        source: "webhook",
        detail: {
          event_id: event.event_id,
          reference,
          matched_by: match.matchedBy,
          expires_at: expiresAt,
          ...(resolvedAt && { already_lifted_at: resolvedAt }),
          ...(!url && { invalid_verification_url: true }),
        },
      },
    );
    if (!updated) continue;
    if (!url) {
      console.error(`[stables] Travel Rule request for ${payment.id} has no usable https URL.`);
      return { processed: true, note: "verification_url missing or not https." };
    }
    return { processed: true };
  }
  throw new Error(`Payment ${found.id} kept changing concurrently.`);
}

/**
 * The payment a transfer event belongs to. Our own `metadata.payment_id` (sent
 * at creation, echoed by Stables on the transfer resource) is tried first, then
 * the transfer ID. A metadata match only counts once the payment has stored
 * this transfer: an event that beats our own create response waits for replay,
 * so it cannot move the payment before its deposit instructions are saved.
 */
async function paymentForTransferEvent(
  object: Record<string, unknown>,
  transferId: string | undefined,
): Promise<PaymentRow | null> {
  const metadata = object["metadata"];
  const paymentId =
    metadata && typeof metadata === "object"
      ? stringOrNull((metadata as Record<string, unknown>)["payment_id"])
      : null;
  if (paymentId && UUID.test(paymentId)) {
    const payment = await ledger.getPayment(paymentId);
    if (payment && transferId && payment.transfer_id === transferId) return payment;
    if (payment?.transfer_id && payment.transfer_id !== transferId) {
      console.error(
        `[stables] event for transfer ${transferId} names payment ${paymentId}, which has transfer ${payment.transfer_id}`,
      );
    }
  }
  return transferId ? ledger.getPaymentByTransferId(transferId) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The transfer reached `payment.status` at `at`; lift an earlier Travel Rule hold if that moves it on. */
async function liftTravelRuleHold(payment: PaymentRow, at: string, source: ledger.EventSource) {
  const requestedAt = payment.travel_rule_requested_at;
  if (!requestedAt || payment.travel_rule_resolved_at) return;
  if (!liftsTravelRuleHold(ledger.paymentState(payment))) return;
  if (!(Date.parse(at) > Date.parse(requestedAt))) return;
  await ledger.resolveTravelRule(payment.id, requestedAt, at, {
    source,
    detail: { status: payment.status, lifted_at: at },
  });
}

/**
 * Apply one verified webhook event. Returns `processed: false` when the event
 * refers to something we cannot match yet; it stays stored for replay.
 */
export async function handleStablesEvent(event: StablesWebhookEvent): Promise<EventOutcome> {
  const object = event.event_object ?? {};

  if (event.event_type === "customer.created" || event.event_type === "customer.updated") {
    const customerId = stringOrNull(object["customer_id"]) ?? event.event_object_id;
    const row = customerId ? await ledger.getStablesCustomerById(customerId) : null;
    // LamportPay stores its customers when it creates them (startKyc) and
    // syncs them there, so one it does not know is not one it needs.
    if (!row) return { processed: true, note: "Not a LamportPay customer." };

    const config = getStablesConfig();
    if (!config.configured) return { processed: false, note: "Stables is not configured." };
    // The event carries no verification or entitlement status (an entitlement
    // such as base_payout is often granted after KYC approval): read the record.
    await syncCustomer(
      row.user_id,
      row,
      await stables.getCustomer(config, row.stables_customer_id),
      "webhook",
    );
    return { processed: true };
  }

  if (event.event_type === "travel_rule.wallet_verification_required") {
    return applyTravelRuleRequest(event);
  }

  if (event.event_type === "kyc_link.updated.status_transitioned") {
    const customerId = typeof object["customer_id"] === "string" ? object["customer_id"] : null;
    const row = customerId ? await ledger.getStablesCustomerById(customerId) : null;
    if (!row) return { processed: false, note: "Unknown customer." };

    const rawStatus = String(object["status"] ?? event.event_object_status ?? "");
    const verification = KYC_STATUS[rawStatus.toUpperCase()];
    if (!verification) return { processed: true, note: `Unrecognized KYC status ${rawStatus}.` };

    const config = getStablesConfig();
    if (verification === "approved" && config.configured) {
      try {
        // The event carries no entitlement status; fetch it before advancing.
        await syncCustomer(
          row.user_id,
          row,
          await stables.getCustomer(config, row.stables_customer_id),
          "webhook",
        );
        return { processed: true };
      } catch (e) {
        if (!(e instanceof StablesError)) throw e;
      }
    }
    const updated = await ledger.upsertStablesCustomer({
      user_id: row.user_id,
      stables_customer_id: row.stables_customer_id,
      verification_status: verification,
    });
    await advanceKycPayments(row.user_id, updated, "webhook");
    return { processed: true };
  }

  if (
    event.event_type === "transfer.created" ||
    event.event_type === "transfer.updated.status_transitioned"
  ) {
    const transferId =
      typeof object["transfer_id"] === "string" ? object["transfer_id"] : event.event_object_id;
    const payment = await paymentForTransferEvent(object, transferId);
    if (!payment) return { processed: false, note: "No payment for this transfer yet." };

    // event_object.status is the authoritative current state.
    const status = normalizeTransferStatus(object["status"] ?? event.event_object_status);
    if (!status) return { processed: true, note: "Event carries no transfer state." };

    const stablesAt = eventTime(event);
    const result = await ledger.transitionPayment(payment.id, status, {
      source: "webhook",
      detail: { event_id: event.event_id, event_type: event.event_type, stables_at: stablesAt },
    });
    if (result.applied) await liftTravelRuleHold(result.payment, stablesAt, "webhook");
    if (ledger.paymentState(result.payment) === "COMPLETED") {
      await settlePayout(result.payment, object["actual_payout"], "webhook");
    }
    return { processed: true, ...(!result.applied && { note: result.reason }) };
  }

  return { processed: true, note: `Ignored ${event.event_type}.` };
}

/** Apply a stored delivery and record the outcome. Never throws. */
export async function processWebhookEvent(
  event: StablesWebhookEvent,
): Promise<{ processed: boolean }> {
  try {
    const outcome = await handleStablesEvent(event);
    await ledger.finishWebhookEvent(event.event_id, outcome);
    console.info(
      JSON.stringify({
        event: "stables_webhook",
        event_id: event.event_id,
        event_type: event.event_type,
        processed: outcome.processed,
        note: outcome.note ?? null,
      }),
    );
    return { processed: outcome.processed };
  } catch (error) {
    console.error(`[stables-webhook] failed to process ${event.event_id}`, error);
    await ledger.finishWebhookEvent(event.event_id, {
      processed: false,
      note: error instanceof Error ? error.message : "Processing failed.",
    });
    return { processed: false };
  }
}

/**
 * Apply events that arrived before a payment could be matched to them: transfer
 * events before the transfer id was stored, Travel Rule requests naming a
 * transfer or deposit transaction we did not know yet.
 */
async function replayPendingEvents(objectId: string) {
  for (const stored of await ledger.listUnprocessedEventsFor(objectId)) {
    await processWebhookEvent(stored.payload as unknown as StablesWebhookEvent);
  }
}

// ----------------------------------------------------------- reconciliation

/** Transfers created longer ago than this are left alone. */
const RECONCILE_WINDOW_MS = 14 * 24 * 3600_000;
const RECONCILE_BATCH = 25;
/** Fresh deliveries are still being processed in the background. */
const EVENT_RETRY_DELAY_MS = 2 * 60_000;
const EVENT_RETRY_WINDOW_MS = 3 * 24 * 3600_000;
const EVENT_RETRY_BATCH = 50;

export type ReconcileReport = {
  events: { retried: number; processed: number };
  transfers: { checked: number; advanced: number; settled: number; failed: number };
  stoppedEarly: boolean;
};

/** Compare one payment with its Stables transfer and catch up. */
async function reconcileTransfer(
  config: Configured,
  payment: PaymentRow,
): Promise<{ advanced: boolean; settled: boolean; snapshot: Json }> {
  const transfer = await stables.getTransfer(config, payment.transfer_id!);
  const echoed = transfer.metadata?.["payment_id"];
  if (echoed && echoed !== payment.id) {
    console.error(
      `[reconcile] transfer ${transfer.id} echoes payment_id ${echoed}, not ${payment.id}`,
    );
  }
  const status = normalizeTransferStatus(transfer.status);
  let current = payment;
  let advanced = false;

  const from = ledger.paymentState(payment);
  // Only move forward: a stale read must not add rejected transitions each run.
  if (status && checkTransition(from, status, payment.pre_hold_status as TransferState | null).ok) {
    // When Stables last changed the transfer, not when we noticed: a state it
    // reached before a Travel Rule request must not count as lifting it.
    const stablesAt = isoOrNull(transfer.updated_at) ?? new Date().toISOString();
    const result = await ledger.transitionPayment(payment.id, status, {
      source: "reconcile",
      detail: { transfer_status: transfer.status, stables_at: stablesAt },
    });
    advanced = result.applied;
    current = result.payment;
    if (result.applied) await liftTravelRuleHold(current, stablesAt, "reconcile");
  }

  const settled =
    ledger.paymentState(current) === "COMPLETED" &&
    (await settlePayout(current, transfer.actual_payout ?? null, "reconcile"));
  return { advanced, settled, snapshot: redactTransfer(transfer) };
}

/**
 * Catch up on anything webhooks missed: retry stored deliveries that were never
 * processed, then poll Stables for every transfer that can still change (and
 * completed ones missing their settled payout). Stops starting new work after
 * `deadline` (epoch ms) so a scheduled run finishes inside its time limit.
 */
export async function reconcilePayments(options: { deadline: number }): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    events: { retried: 0, processed: 0 },
    transfers: { checked: 0, advanced: 0, settled: 0, failed: 0 },
    stoppedEarly: false,
  };
  const now = Date.now();
  const outOfTime = () => {
    if (Date.now() < options.deadline) return false;
    report.stoppedEarly = true;
    return true;
  };

  const events = await ledger.listUnprocessedWebhookEvents(
    new Date(now - EVENT_RETRY_WINDOW_MS),
    new Date(now - EVENT_RETRY_DELAY_MS),
    EVENT_RETRY_BATCH,
  );
  for (const stored of events) {
    if (outOfTime()) return report;
    report.events.retried++;
    const outcome = await processWebhookEvent(stored.payload as unknown as StablesWebhookEvent);
    if (outcome.processed) report.events.processed++;
  }

  const config = getStablesConfig();
  if (!config.configured) return report;

  const payments = await ledger.listPaymentsToReconcile(
    RECONCILE_BATCH,
    new Date(now - RECONCILE_WINDOW_MS),
  );
  for (const payment of payments) {
    if (outOfTime()) break;
    report.transfers.checked++;
    let snapshot: Json | undefined;
    try {
      const outcome = await reconcileTransfer(config, payment);
      snapshot = outcome.snapshot;
      if (outcome.advanced) report.transfers.advanced++;
      if (outcome.settled) report.transfers.settled++;
    } catch (e) {
      report.transfers.failed++;
      console.error(`[reconcile] ${payment.id} (transfer ${payment.transfer_id}) failed`, e);
    } finally {
      // Rotate even on failure so one bad transfer cannot starve the rest.
      await ledger
        .touchPayment(payment.id, {
          reconciled_at: new Date().toISOString(),
          ...(snapshot !== undefined && { transfer_snapshot: snapshot }),
        })
        .catch((e) => console.error(`[reconcile] could not mark ${payment.id}`, e));
    }
  }
  return report;
}
