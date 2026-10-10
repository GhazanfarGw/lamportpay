/**
 * Payment service against a mocked Stables client, a mocked Solana RPC and an
 * in-memory database. No network access and no funds involved.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_ENV, MODE_ENV_KEYS } from "./support/app-mode";

// Real-funds logic is tested as LIVE MODE would run it: lock mocked open, full
// live config in beforeEach. The app itself keeps the lock closed.
vi.mock("@/lib/app-mode-lock", () => ({ LIVE_MODE_CODE_UNLOCKED: true }));
vi.mock("@/integrations/supabase/client.server", async () => {
  const { createFakeSupabase } = await import("./support/fake-supabase");
  return { supabaseAdmin: createFakeSupabase() };
});
vi.mock("@/lib/stables/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stables/client.server")>();
  return {
    ...actual,
    createCustomerWithVerificationLink: vi.fn(),
    createVerificationLink: vi.fn(),
    getCustomer: vi.fn(),
    listCustomers: vi.fn(),
    createQuote: vi.fn(),
    validatePaymentMethod: vi.fn(),
    createTransfer: vi.fn(),
    getTransfer: vi.fn(),
    simulateTransferDeposit: vi.fn(),
  };
});
vi.mock("@/lib/solana-rpc.server", () => ({ rpc: vi.fn() }));
// Wallet balances are read from mainnet; tests set them explicitly.
vi.mock("@/lib/solana-balances.server", () => ({
  readWalletHoldings: vi.fn(),
  solReserveLamports: vi.fn(),
  tokenAccountRentLamports: vi.fn(),
  accountExists: vi.fn(),
  solFeeReserveMarginLamports: vi.fn(),
}));

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { clearBusinessSettingsCache, updateBusinessSettings } from "@/lib/business-settings.server";
import * as balances from "@/lib/solana-balances.server";
import * as ledger from "@/lib/payments/ledger.server";
import * as service from "@/lib/payments/service.server";
import { rpc } from "@/lib/solana-rpc.server";
import * as stables from "@/lib/stables/client.server";
import { StablesError } from "@/lib/stables/client.server";
import { SUBSCRIBED_WEBHOOK_EVENTS, type StablesCustomer } from "@/lib/stables/types";
import { USDC_MINT } from "@/lib/tokens";
import { Route as WebhookRoute } from "@/routes/api/public/stables-webhook";
import type { FakeSupabase } from "./support/fake-supabase";
import {
  WEBHOOK_SECRET,
  customer,
  customerEvent,
  fakeSignature,
  kycEvent,
  newWallet,
  quote,
  signedWebhook,
  transfer,
  transferEvent,
  travelRuleEvent,
  usdcTransferTx,
} from "./support/payment-fixtures";

const db = supabaseAdmin as unknown as FakeSupabase;
const api = vi.mocked(stables);
const rpcMock = vi.mocked(rpc);
const wallets = vi.mocked(balances);

/** Real-looking balances for `owner`: plenty of both coins and SOL unless told otherwise. */
function holdings(
  owner: string,
  tokens: { usdc?: bigint; usdt?: bigint } = {},
  solLamports = 1_000_000_000n,
): balances.WalletHoldings {
  return {
    status: "ok",
    owner,
    slot: 1,
    readAt: new Date().toISOString(),
    solLamports,
    tokens: { usdc: tokens.usdc ?? 1_000_000_000_000n, usdt: tokens.usdt ?? 1_000_000_000_000n },
  };
}

const ENV_KEYS = [
  "STABLES_API_KEY",
  "STABLES_API_URL",
  "STABLES_WEBHOOK_SECRET",
  "PAYMENT_MIN_USDC",
  "PAYMENT_MAX_USDC",
  "PAYMENT_MIN_USDT",
  "PAYMENT_MAX_USDT",
] as const;
const savedEnv = Object.fromEntries(
  [...ENV_KEYS, ...MODE_ENV_KEYS].map((k) => [k, process.env[k]]),
);

const RETURN_URL = "https://lamportpay.test/pay?kyc=returned";
const ID_NAME = { firstName: "Ada", lastName: "Lovelace" };
let user: { id: string; email: string };

beforeEach(() => {
  db.reset();
  clearBusinessSettingsCache();
  vi.resetAllMocks();
  Object.assign(process.env, {
    ...LIVE_ENV,
    STABLES_API_KEY: "sti_live_fixture",
    STABLES_API_URL: "https://api.stables.money",
    STABLES_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // Small test limits; the "payment limits" tests clear them to check the defaults.
    PAYMENT_MIN_USDC: "50",
    PAYMENT_MAX_USDC: "100",
    PAYMENT_MIN_USDT: "50",
    PAYMENT_MAX_USDT: "100",
  });
  user = { id: randomUUID(), email: "user@example.com" };
  // A preview a test didn't set up gets Stables' real "no route" answer, as
  // USDT did for most payouts in the sandbox: tests read as single-coin.
  api.createQuote.mockRejectedValue(
    new StablesError(
      "No route is currently available for this transfer.",
      422,
      [],
      "ROUTING_ROUTE_NOT_CONFIGURED",
    ),
  );
  // The live transfer check before funding: still waiting for the deposit.
  api.getTransfer.mockImplementation(async (_config, id) =>
    transfer(id, newWallet(), "0", "awaiting_funds_collection"),
  );
  wallets.readWalletHoldings.mockImplementation(async (owner) => holdings(owner));
  wallets.solReserveLamports.mockResolvedValue(5_000_000n);
  wallets.tokenAccountRentLamports.mockResolvedValue(2_039_280n);
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ------------------------------------------------------------------ helpers

type Handler = (ctx: { request: Request }) => Promise<Response>;
const postWebhook = (request: Request) =>
  (
    WebhookRoute.options as unknown as { server: { handlers: { POST: Handler } } }
  ).server.handlers.POST({ request });

/** Deliver a signed event and wait for the processing scheduled after the response. */
async function deliver(event: unknown): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const request = Object.assign(signedWebhook(event), {
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
  });
  const response = await postWebhook(request);
  await Promise.all(pending);
  return response;
}

function paymentRow(id: string) {
  const row = db.table("payments").find((p) => p["id"] === id);
  if (!row) throw new Error(`payment ${id} not stored`);
  return row;
}

/** The wallet the test user connects; it holds plenty unless a test says otherwise. */
let userWallet = newWallet();

async function createPayment(amount = "75") {
  api.createQuote.mockResolvedValueOnce(quote(amount, "inr", "6232.5"));
  userWallet = newWallet();
  return service.createPayment(user, {
    amount,
    country: "in",
    currency: "INR",
    wallet: userWallet,
  });
}

/** Payment with a Stables customer whose KYC is still running. */
async function paymentAwaitingKyc(amount = "75") {
  const payment = await createPayment(amount);
  api.createCustomerWithVerificationLink.mockResolvedValueOnce({
    customer_id: "cus_1",
    kyc_link: "https://kyc.example/1",
  });
  await service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL });
  return payment;
}

async function quotedPayment(amount = "75") {
  const payment = await paymentAwaitingKyc(amount);
  api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
  api.createQuote.mockResolvedValueOnce(quote(amount, "inr", "6232.5"));
  return service.quotePayment(user, payment.id);
}

const BENEFICIARY = {
  bankName: "State Bank",
  accountNumber: "123456789012",
  details: { ifsc_code: "SBIN0000001" },
};

/** Payment whose transfer exists and waits for the user's USDC. */
async function paymentAwaitingFunds(amount = "75") {
  const payment = await quotedPayment(amount);
  const deposit = newWallet();
  api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
  api.createTransfer.mockResolvedValueOnce(transfer("tr_1", deposit, amount));
  await service.createPaymentTransfer(user, payment.id, {
    purposeCode: "FAMILY_MAINTENANCE",
    beneficiary: BENEFICIARY,
  });
  return { id: payment.id, deposit };
}

function mockBlockhash() {
  rpcMock.mockResolvedValueOnce({
    ok: true,
    result: { value: { blockhash: newWallet(), lastValidBlockHeight: 100 } },
  });
}

async function seedTransferPayment(status: string, overrides: Record<string, unknown> = {}) {
  const { data } = await db
    .from("payments")
    .insert({
      user_id: user.id,
      status,
      source_amount_minor: 60_000_000,
      destination_currency: "inr",
      destination_country: "IN",
      transfer_id: `tr_${randomUUID()}`,
      deposit_address: newWallet(),
      deposit_amount_minor: 60_000_000,
      ...overrides,
    })
    .select("*")
    .single();
  return data as Record<string, unknown> & { id: string; transfer_id: string };
}

// --------------------------------------------------------------- happy path

describe("happy path", () => {
  it("creates, verifies, quotes, transfers, funds and completes a payment", async () => {
    // Stables prices the destination before anything is stored.
    const created = await createPayment("75");
    expect(created.status).toBe("PAYMENT_CREATED");
    expect(created.destination).toMatchObject({ country: "IN", currency: "inr", amount: "6232.5" });
    // Every coin is priced; USDC answered, so USDC pays.
    expect(api.createQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        preview: true,
        source: { currency: "usdc", network: "solana", amount: "75" },
        destination: { currency: "inr", country: "IN", network: "bank" },
      }),
    );

    // Hosted KYC.
    api.createCustomerWithVerificationLink.mockResolvedValueOnce({
      customer_id: "cus_1",
      kyc_link: "https://kyc.example/1",
    });
    const kyc = await service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL });
    expect(kyc).toMatchObject({ status: "in_progress", kycLink: "https://kyc.example/1" });
    expect(paymentRow(created.id)["status"]).toBe("KYC_PENDING");

    // KYC approval arrives by webhook.
    api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
    expect((await deliver(kycEvent("cus_1", "VERIFICATION_APPROVED"))).status).toBe(200);
    expect(paymentRow(created.id)["status"]).toBe("KYC_APPROVED");

    // Real quote.
    const q = quote("75", "inr", "6232.5");
    api.createQuote.mockResolvedValueOnce(q);
    const quoted = await service.quotePayment(user, created.id);
    expect(quoted).toMatchObject({ status: "QUOTED", quote: { id: q.quote_id } });
    expect(api.createQuote).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ metadata: { payment_id: created.id } }),
    );
    expect(api.createQuote.mock.lastCall![1]).not.toHaveProperty("preview");

    // Beneficiary checked by Stables, then the transfer.
    const deposit = newWallet();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", deposit, "75"));
    const transferred = await service.createPaymentTransfer(user, created.id, {
      purposeCode: "FAMILY_MAINTENANCE",
      beneficiary: BENEFICIARY,
    });
    expect(transferred.status).toBe("AWAITING_FUNDS_COLLECTION");
    expect(transferred.deposit).toMatchObject({ address: deposit, amount: "75" });
    expect(api.validatePaymentMethod).toHaveBeenCalledWith(expect.anything(), {
      network: "bank",
      destination: expect.objectContaining({
        bank_country: "IN",
        currency: "INR",
        account_number: "123456789012",
        ifsc_code: "SBIN0000001",
      }),
    });
    // Full bank details go to Stables only.
    expect(JSON.stringify(paymentRow(created.id))).not.toContain("123456789012");

    // The user's wallet funds the deposit address.
    const payer = newWallet();
    mockBlockhash();
    const built = await service.buildFundingTransaction(user, created.id, payer);
    expect(built).toMatchObject({ depositAddress: deposit, amount: "75" });
    const signature = fakeSignature();
    rpcMock.mockResolvedValueOnce({
      ok: true,
      result: usdcTransferTx({ from: payer, to: deposit, amount: 75_000_000n }),
    });
    const funded = await service.verifyFunding(user, created.id, signature);
    expect(funded).toMatchObject({ pending: false, payment: { funding: { signature, payer } } });

    // Stables drives the rest; the settled payout is read from the transfer.
    for (const status of [
      "FUNDS_COLLECTED",
      "IN_PROGRESS",
      "PAYMENT_SUBMITTED",
      "PAYMENT_PROCESSED",
    ]) {
      expect((await deliver(transferEvent("tr_1", status))).status).toBe(200);
    }
    api.getTransfer.mockResolvedValueOnce(
      transfer("tr_1", deposit, "75", "completed", {
        actual_payout: { amount: "6230.10", amount_minor: 623010, currency: "INR" },
      }),
    );
    await deliver(transferEvent("tr_1", "COMPLETED"));

    const done = await service.getPaymentView(user, created.id);
    expect(done).toMatchObject({ status: "COMPLETED", terminal: true });
    expect(done.actualPayout).toEqual({ currency: "inr", amountMinor: "623010", amount: "6230.1" });
    expect(done.events.filter((e) => e.kind === "transition").map((e) => e.to)).toEqual([
      "KYC_PENDING",
      "KYC_APPROVED",
      "QUOTED",
      "AWAITING_FUNDS_COLLECTION",
      "FUNDS_COLLECTED",
      "IN_PROGRESS",
      "PAYMENT_SUBMITTED",
      "PAYMENT_PROCESSED",
      "COMPLETED",
    ]);
    expect(done.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["funding_verified", "payout_settled"]),
    );
    expect(done.events.some((e) => e.kind === "transition_rejected")).toBe(false);
  });
});

// ------------------------------------------------------------- destinations

describe("destination support is decided by Stables", () => {
  it("shows a clean message when Stables will not price the destination", async () => {
    api.createQuote.mockRejectedValueOnce(
      new StablesError("Unsupported destination currency: PKR", 422),
    );
    await expect(
      service.createPayment(user, { amount: "60", country: "pk", currency: "PKR" }),
    ).rejects.toMatchObject({
      status: 422,
      code: "destination_not_supported",
      message: "PKR bank payouts to Pakistan are not supported for this payment.",
      extra: { reason: "Unsupported destination currency: PKR" },
    });
    expect(db.table("payments")).toHaveLength(0);
  });

  it("does not call a route unsupported when Stables only failed to price it", async () => {
    const message = "This transfer could not be priced right now. Please try again shortly.";
    api.createQuote.mockRejectedValueOnce(
      new StablesError(message, 422, [], "ROUTING_QUOTE_FAILED"),
    );
    await expect(
      service.createPayment(user, { amount: "100", country: "in", currency: "INR" }),
    ).rejects.toMatchObject({ status: 503, code: "quote_unavailable", extra: { reason: message } });

    api.createQuote.mockRejectedValueOnce(
      new StablesError("No route is currently available.", 422, [], "ROUTING_ROUTE_DISABLED"),
    );
    await expect(
      service.createPayment(user, { amount: "100", country: "de", currency: "EUR" }),
    ).rejects.toMatchObject({ code: "destination_not_supported" });
    expect(db.table("payments")).toHaveLength(0);
  });

  it("does not call an outage 'not supported'", async () => {
    api.createQuote.mockRejectedValueOnce(new StablesError("Service unavailable", 503));
    await expect(
      service.createPayment(user, { amount: "60", country: "IN", currency: "inr" }),
    ).rejects.toMatchObject({ status: 502, code: "stables_unavailable" });
  });

  it("passes any country and currency through to Stables", async () => {
    api.createQuote.mockResolvedValueOnce(quote("60", "jpy", "9000"));
    const payment = await service.createPayment(user, {
      amount: "60",
      country: "jp",
      currency: "JPY",
    });
    expect(payment.destination).toMatchObject({ country: "JP", currency: "jpy", amount: "9000" });
  });
});

// ------------------------------------------------------------------- limits

describe("payment limits", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS.filter((k) => k.startsWith("PAYMENT_"))) process.env[key] = "";
  });

  it.each(["14.999999", "1000000.000001", "0"])(
    "rejects %s USDC before calling Stables (defaults 15 to 1,000,000)",
    async (amount) => {
      await expect(
        service.createPayment(user, { amount, country: "IN", currency: "inr" }),
      ).rejects.toMatchObject({
        status: 400,
        code: "amount_out_of_range",
        message: "Payments must be between 15 and 1,000,000 USDC.",
      });
      expect(api.createQuote).not.toHaveBeenCalled();
    },
  );

  it("accepts both default bounds", async () => {
    await expect(createPayment("15")).resolves.toMatchObject({ status: "PAYMENT_CREATED" });
    await expect(createPayment("1000000")).resolves.toMatchObject({ status: "PAYMENT_CREATED" });
  });

  it("reads each stablecoin's limits from the environment", async () => {
    process.env["PAYMENT_MIN_USDC"] = "10";
    process.env["PAYMENT_MAX_USDC"] = "20";
    process.env["PAYMENT_MIN_USDT"] = "30";
    process.env["PAYMENT_MAX_USDT"] = "40";
    await expect(createPayment("15")).resolves.toMatchObject({ status: "PAYMENT_CREATED" });
    await expect(
      service.createPayment(user, { amount: "25", country: "IN", currency: "inr" }),
    ).rejects.toMatchObject({ message: "Payments must be between 10 and 20 USDC." });
    await expect(
      service.createPayment(user, {
        amount: "15",
        country: "IN",
        currency: "inr",
        sourceCurrency: "usdt",
      }),
    ).rejects.toMatchObject({ message: "Payments must be between 30 and 40 USDT." });
  });

  it("uses limits an admin set, over .env, for new payments and quotes (C07)", async () => {
    await updateBusinessSettings(
      { paymentLimits: { usdc: { min_minor: 60_000_000, max_minor: 80_000_000 } } },
      "00000000-0000-4000-8000-000000000001",
    );
    await expect(
      service.createPayment(user, { amount: "55", country: "IN", currency: "inr" }),
    ).rejects.toMatchObject({
      code: "amount_out_of_range",
      message: "Payments must be between 60 and 80 USDC.",
    });
    await expect(createPayment("70")).resolves.toMatchObject({ status: "PAYMENT_CREATED" });
  });

  it("refuses to take payments with an inverted configuration", async () => {
    process.env["PAYMENT_MIN_USDC"] = "200";
    process.env["PAYMENT_MAX_USDC"] = "150";
    await expect(
      service.createPayment(user, { amount: "150", country: "IN", currency: "inr" }),
    ).rejects.toMatchObject({ status: 503, code: "limits_misconfigured" });
  });
});

describe("Stables refusing the amount", () => {
  it("shows Stables' reason when it refuses the amount at the preview quote", async () => {
    api.createQuote.mockRejectedValueOnce(
      new StablesError("Amount exceeds the per-transaction limit for this customer", 400),
    );
    await expect(
      service.createPayment(user, { amount: "75", country: "IN", currency: "inr" }),
    ).rejects.toMatchObject({
      status: 422,
      code: "amount_rejected",
      message: "Stables can't accept 75 USDC for this payment.",
      extra: { reason: "Amount exceeds the per-transaction limit for this customer" },
    });
  });

  it("recognises Stables' limit error codes too", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockRejectedValueOnce(
      new StablesError("Transfer rejected", 400, [], "amount_limit_exceeded"),
    );
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
        beneficiary: BENEFICIARY,
      }),
    ).rejects.toMatchObject({ code: "amount_rejected", extra: { reason: "Transfer rejected" } });
  });
});

// ---------------------------------------------------------------- customers

describe("starting KYC", () => {
  it("asks for both names before creating a Stables customer", async () => {
    await expect(
      service.startKyc(user, { firstName: "Ada", returnUrl: RETURN_URL }),
    ).rejects.toMatchObject({ status: 400, code: "name_required" });
    expect(api.createCustomerWithVerificationLink).not.toHaveBeenCalled();
  });

  it("sends the return URL only when it is https", async () => {
    api.createCustomerWithVerificationLink.mockResolvedValue({
      customer_id: "cus_1",
      kyc_link: "https://kyc.example/1",
    });
    await service.startKyc(user, { ...ID_NAME, returnUrl: "http://localhost:8080/pay" });
    expect(api.createCustomerWithVerificationLink.mock.lastCall![1]).not.toHaveProperty("redirect");

    db.reset();
    await service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL });
    expect(api.createCustomerWithVerificationLink.mock.lastCall![1]).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      redirect: { success_url: RETURN_URL, reject_url: RETURN_URL },
    });
  });

  it("asks a wallet-only account (no email) for an email once, and passes it to Stables", async () => {
    const walletUser = { ...user, email: undefined };
    await expect(
      service.startKyc(walletUser, { ...ID_NAME, returnUrl: RETURN_URL }),
    ).rejects.toMatchObject({ status: 400, code: "email_required" });
    expect(api.createCustomerWithVerificationLink).not.toHaveBeenCalled();

    api.createCustomerWithVerificationLink.mockResolvedValue({
      customer_id: "cus_1",
      kyc_link: "https://kyc.example/1",
    });
    await service.startKyc(walletUser, {
      ...ID_NAME,
      email: "ada@example.com",
      returnUrl: RETURN_URL,
    });
    expect(api.createCustomerWithVerificationLink.mock.lastCall![1]).toMatchObject({
      email: "ada@example.com",
    });
    // The email is not stored by LamportPay.
    expect(JSON.stringify(db.table("stables_customers"))).not.toContain("ada@example.com");
  });

  it("prefers the account email over a typed one", async () => {
    api.createCustomerWithVerificationLink.mockResolvedValue({
      customer_id: "cus_1",
      kyc_link: "https://kyc.example/1",
    });
    await service.startKyc(user, { ...ID_NAME, email: "other@example.com", returnUrl: RETURN_URL });
    expect(api.createCustomerWithVerificationLink.mock.lastCall![1]).toMatchObject({
      email: user.email,
    });
  });
});

describe("wallet-first identity", () => {
  it("refuses a payment from a wallet other than the one the account signed in with", async () => {
    const signedInWith = newWallet();
    const walletUser = { ...user, email: null, wallets: [signedInWith] };
    await expect(
      service.createPayment(walletUser, {
        amount: "75",
        country: "in",
        currency: "INR",
        wallet: newWallet(),
      }),
    ).rejects.toMatchObject({ status: 403, code: "wallet_not_linked" });
    expect(api.createQuote).not.toHaveBeenCalled();
    expect(db.table("payments")).toHaveLength(0);
  });

  it("accepts the linked wallet, and any wallet for an email account", async () => {
    const linked = newWallet();
    api.createQuote.mockResolvedValue(quote("75", "inr", "6232.5"));
    await service.createPayment(
      { ...user, wallets: [linked] },
      { amount: "75", country: "in", currency: "INR", wallet: linked },
    );
    await service.createPayment(
      { ...user, wallets: [] },
      { amount: "75", country: "in", currency: "INR", wallet: newWallet() },
    );
    expect(db.table("payments")).toHaveLength(2);
  });

  it("answers a verified returning customer from our record, without asking Stables", async () => {
    await quotedPayment();
    // The first status check reads Stables once and stores "approved"...
    await service.getKycStatus(user);
    api.getCustomer.mockClear();
    // ...after which the customer is answered from LamportPay's record.
    const kyc = await service.getKycStatus(user);
    expect(kyc).toMatchObject({ state: "kyc_verified", providerUnavailable: false });
    expect(api.getCustomer).not.toHaveBeenCalled();
  });

  it("never upgrades an open verification when Stables is unreachable", async () => {
    await paymentAwaitingKyc();
    api.getCustomer.mockRejectedValue(new StablesError("Service unavailable", 503));
    const kyc = await service.getKycStatus(user);
    expect(kyc).toMatchObject({ state: "kyc_pending", providerUnavailable: true });
    expect(kyc.verifiedAt).toBeNull();
  });

  it("reports not_registered before any Stables customer exists", async () => {
    expect(await service.getKycStatus(user)).toMatchObject({
      state: "not_registered",
      status: "not_started",
    });
  });
});

describe("customer creation conflict (409) recovery", () => {
  it("adopts the Stables customer that carries this user's id", async () => {
    api.createCustomerWithVerificationLink.mockRejectedValueOnce(
      new StablesError("Customer already exists", 409),
    );
    api.listCustomers.mockResolvedValueOnce({
      customers: [
        customer("cus_other", "approved", randomUUID()),
        customer("cus_9", "in_progress", user.id),
      ],
    });
    api.createVerificationLink.mockResolvedValueOnce({
      customer_id: "cus_9",
      kyc_link: "https://kyc.example/9",
    });

    const kyc = await service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL });
    expect(kyc).toMatchObject({ status: "in_progress", kycLink: "https://kyc.example/9" });
    expect(api.createVerificationLink).toHaveBeenCalledWith(
      expect.anything(),
      "cus_9",
      expect.objectContaining({ ttl_in_secs: 1800 }),
    );
    expect(db.table("stables_customers")).toEqual([
      expect.objectContaining({ user_id: user.id, stables_customer_id: "cus_9" }),
    ]);
  });

  it("needs no new link when the adopted customer is already verified", async () => {
    const payment = await createPayment();
    api.createCustomerWithVerificationLink.mockRejectedValueOnce(new StablesError("Conflict", 409));
    api.listCustomers.mockResolvedValueOnce({
      customers: [customer("cus_9", "approved", user.id)],
    });

    const kyc = await service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL });
    expect(kyc).toMatchObject({ status: "approved", basePayout: "approved", kycLink: null });
    expect(api.createVerificationLink).not.toHaveBeenCalled();
    expect(paymentRow(payment.id)["status"]).toBe("KYC_APPROVED");
  });

  it("reports a conflict it cannot resolve", async () => {
    api.createCustomerWithVerificationLink.mockRejectedValueOnce(new StablesError("Conflict", 409));
    api.listCustomers.mockResolvedValueOnce({
      customers: [customer("cus_x", "approved", "someone")],
    });
    await expect(
      service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL }),
    ).rejects.toMatchObject({
      status: 409,
      code: "stables_customer_conflict",
    });
    expect(db.table("stables_customers")).toHaveLength(0);
  });
});

// -------------------------------------------------------------- beneficiary

describe("beneficiary requirements come from Stables", () => {
  it("returns the fields Stables asks for without spending the quote", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({
      valid: false,
      errors: [
        {
          field: "destination.date_of_birth",
          message: "Date of birth is required",
          code: "INVALID_FIELDS",
        },
        { field: "bankCodes.abaCode", message: "ABA code is required", code: "INVALID_FIELDS" },
      ],
    });
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "PERSONAL_REMITTANCE",
        beneficiary: BENEFICIARY,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "beneficiary_invalid",
      extra: {
        fields: [
          { field: "date_of_birth", message: "Date of birth is required" },
          { field: "aba_code", message: "ABA code is required" },
        ],
      },
    });
    expect(api.createTransfer).not.toHaveBeenCalled();
    expect(paymentRow(payment.id)["status"]).toBe("QUOTED");
  });

  it("reports a currency Stables cannot pay out as not supported", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({
      valid: false,
      errors: [{ message: "Currency not supported for bank", code: "UNSUPPORTED_CURRENCY" }],
    });
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "PERSONAL_REMITTANCE",
        beneficiary: BENEFICIARY,
      }),
    ).rejects.toMatchObject({ code: "destination_not_supported" });
  });

  it("never shows deposit instructions for a different amount than quoted", async () => {
    const payment = await quotedPayment("75");
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "80"));
    const view = await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "PERSONAL_REMITTANCE",
      beneficiary: BENEFICIARY,
    });
    expect(view.deposit).toBeNull();
    expect(view.failureReason).toMatch(/80 USDC, not the quoted 75 USDC/);
  });
});

// ------------------------------------------------------------------ funding

describe("deposit verification", () => {
  async function fund(options: Parameters<typeof usdcTransferTx>[0] | null, payer?: string) {
    rpcMock.mockResolvedValueOnce({ ok: true, result: options ? usdcTransferTx(options) : null });
    return { signature: fakeSignature(), payer };
  }

  async function prepared() {
    const { id, deposit } = await paymentAwaitingFunds("75");
    const payer = newWallet();
    mockBlockhash();
    await service.buildFundingTransaction(user, id, payer);
    return { id, deposit, payer };
  }

  it("asks for a finalized transaction and waits until it is", async () => {
    const { id } = await prepared();
    const { signature } = await fund(null);
    await expect(service.verifyFunding(user, id, signature)).resolves.toEqual({ pending: true });
    expect(rpcMock).toHaveBeenLastCalledWith("mainnet-beta", "getTransaction", [
      signature,
      expect.objectContaining({ commitment: "finalized" }),
    ]);
  });

  const rejected = (reason: RegExp) =>
    expect.objectContaining({
      status: 422,
      code: "funding_rejected",
      message: expect.stringMatching(reason),
    });

  it("requires exactly the deposit amount", async () => {
    const { id, deposit, payer } = await prepared();
    for (const [amount, shown] of [
      [74_999_999n, "74.999999"],
      [75_000_001n, "75.000001"],
    ] as const) {
      const { signature } = await fund({ from: payer, to: deposit, amount });
      await expect(service.verifyFunding(user, id, signature)).rejects.toEqual(
        rejected(new RegExp(`deposit address received ${shown} USDC .* exactly 75 USDC`)),
      );
    }
    expect(paymentRow(id)["funding_signature"]).toBeNull();
  });

  it("warns not to send again once a wrong amount reached the deposit address", async () => {
    const { id, deposit, payer } = await prepared();
    const { signature } = await fund({ from: payer, to: deposit, amount: 75_500_000n });
    await expect(service.verifyFunding(user, id, signature)).rejects.toMatchObject({
      code: "funding_rejected",
    });
    const view = await service.getPaymentView(user, id);
    expect(view.status).toBe("AWAITING_FUNDS_COLLECTION");
    expect(view.depositIssue).toMatchObject({ received: "75.5", expected: "75" });
  });

  it("only counts USDC, by mint", async () => {
    const { id, deposit, payer } = await prepared();
    const usdt = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
    expect(usdt).not.toBe(USDC_MINT);
    const { signature } = await fund({ from: payer, to: deposit, amount: 75_000_000n, mint: usdt });
    await expect(service.verifyFunding(user, id, signature)).rejects.toEqual(
      rejected(/received 0 USDC/),
    );
  });

  it("only counts this payment's deposit address", async () => {
    const { id, payer } = await prepared();
    const { signature } = await fund({ from: payer, to: newWallet(), amount: 75_000_000n });
    await expect(service.verifyFunding(user, id, signature)).rejects.toEqual(
      rejected(/deposit address received 0/),
    );
  });

  it("requires the payer wallet to sign and to be the one debited", async () => {
    const { id, deposit, payer } = await prepared();
    const stranger = newWallet();

    let tx = await fund({ from: stranger, to: deposit, amount: 75_000_000n });
    await expect(service.verifyFunding(user, id, tx.signature)).rejects.toEqual(
      rejected(/not signed by your wallet/),
    );

    tx = await fund({ from: stranger, to: deposit, amount: 75_000_000n, signer: payer });
    await expect(service.verifyFunding(user, id, tx.signature)).rejects.toEqual(
      rejected(/Your wallet sent 0/),
    );
  });

  it("rejects a transaction that failed on-chain", async () => {
    const { id, deposit, payer } = await prepared();
    const { signature } = await fund({
      from: payer,
      to: deposit,
      amount: 75_000_000n,
      err: { InstructionError: [0, "Custom"] },
    });
    await expect(service.verifyFunding(user, id, signature)).rejects.toEqual(
      rejected(/failed on-chain/),
    );
  });

  it("needs the sending wallet when no funding transaction was prepared", async () => {
    const { id, deposit } = await paymentAwaitingFunds("75");
    const payer = newWallet();
    await expect(service.verifyFunding(user, id, fakeSignature())).rejects.toMatchObject({
      status: 400,
      code: "payer_required",
    });

    const { signature } = await fund({ from: payer, to: deposit, amount: 75_000_000n });
    const result = await service.verifyFunding(user, id, signature, payer);
    expect(result).toMatchObject({ pending: false, payment: { payerWallet: payer } });
  });

  it("refuses a different wallet than the one prepared", async () => {
    const { id } = await prepared();
    await expect(
      service.verifyFunding(user, id, fakeSignature(), newWallet()),
    ).rejects.toMatchObject({ status: 409, code: "payer_mismatch" });
  });

  it("lets one transaction fund one payment only, enforced by the database too", async () => {
    const first = await prepared();
    const { signature } = await fund({ from: first.payer, to: first.deposit, amount: 75_000_000n });
    await service.verifyFunding(user, first.id, signature);
    // Verifying again is idempotent.
    await expect(service.verifyFunding(user, first.id, signature)).resolves.toMatchObject({
      pending: false,
    });

    const other = await seedTransferPayment("AWAITING_FUNDS_COLLECTION");
    await expect(
      service.verifyFunding(user, other.id, signature, newWallet()),
    ).rejects.toMatchObject({
      status: 409,
      message: "That transaction already funded another payment.",
    });

    // A concurrent request that slipped past the lookup hits the unique constraint.
    await expect(
      ledger.recordFunding(
        other.id,
        { funding_signature: signature },
        { kind: "funding_verified", source: "api" },
      ),
    ).resolves.toEqual({ status: "signature_taken" });
  });

  it("is disabled against the Stables sandbox", async () => {
    const { id } = await paymentAwaitingFunds("75");
    process.env["STABLES_API_KEY"] = "sti_test_fixture";
    process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
    process.env["LAMPORTPAY_MODE"] = "test";
    // TEST MODE (sandbox): moving real funds is impossible, refused before anything else.
    await expect(service.verifyFunding(user, id, fakeSignature())).rejects.toMatchObject({
      code: "test_mode_no_real_funds",
    });
  });
});

// ----------------------------------------------------------------- webhooks

describe("webhook endpoint", () => {
  it("acknowledges a delivery before applying it", async () => {
    const payment = await paymentAwaitingKyc();
    let release!: (c: StablesCustomer) => void;
    api.getCustomer.mockReturnValueOnce(new Promise<StablesCustomer>((r) => (release = r)));

    const pending: Promise<unknown>[] = [];
    const request = Object.assign(signedWebhook(kycEvent("cus_1", "VERIFICATION_APPROVED")), {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
    });
    const response = await postWebhook(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(pending).toHaveLength(1);
    expect(paymentRow(payment.id)["status"]).toBe("KYC_PENDING");
    expect(db.table("stables_webhook_events")[0]).toMatchObject({ processed_at: null });

    release(customer("cus_1", "approved", user.id));
    await Promise.all(pending);
    expect(paymentRow(payment.id)["status"]).toBe("KYC_APPROVED");
    expect(db.table("stables_webhook_events")[0]!["processed_at"]).not.toBeNull();
  });

  it("acknowledges a duplicate delivery without applying it twice", async () => {
    await paymentAwaitingKyc();
    api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
    const event = kycEvent("cus_1", "VERIFICATION_APPROVED");
    await deliver(event);
    const again = await deliver(event);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(api.getCustomer).toHaveBeenCalledTimes(1);
  });

  it("refuses unsigned, forged and X-Webhook-Signature deliveries without storing them", async () => {
    const body = transferEvent("tr_1", "COMPLETED");
    const forged = signedWebhook(body, Buffer.from("not-the-endpoint-secret-at-all!!"));
    const hmacOnly = new Request("http://localhost/api/public/stables-webhook", {
      method: "POST",
      headers: { "X-Webhook-Signature": "deadbeef" },
      body: JSON.stringify(body),
    });
    const unsigned = new Request("http://localhost/api/public/stables-webhook", {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const request of [forged, hmacOnly, unsigned]) {
      expect((await postWebhook(request)).status).toBe(401);
    }
    expect(db.table("stables_webhook_events")).toHaveLength(0);
  });

  it("answers 401 to unsigned requests even before a secret is configured, 503 to signed ones", async () => {
    process.env["STABLES_WEBHOOK_SECRET"] = "";
    const unsigned = new Request("http://localhost/api/public/stables-webhook", {
      method: "POST",
      body: "{}",
    });
    expect((await postWebhook(unsigned)).status).toBe(401);
    expect((await postWebhook(signedWebhook(transferEvent("tr_1", "COMPLETED")))).status).toBe(503);
    expect(db.table("stables_webhook_events")).toHaveLength(0);
  });

  it("accepts every subscribed event type, and ignores unknown ones with 200", async () => {
    await paymentAwaitingFunds();
    api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
    const events = [
      customerEvent("customer.created", "cus_1", user.id),
      customerEvent("customer.updated", "cus_1", user.id),
      kycEvent("cus_1", "VERIFICATION_APPROVED"),
      transferEvent("tr_1", "AWAITING_FUNDS_COLLECTION"),
      travelRuleEvent("tr_1"),
    ];
    expect(events.map((e) => e.event_type).sort()).toEqual([...SUBSCRIBED_WEBHOOK_EVENTS].sort());

    const unknown = {
      api_version: "v1",
      event_id: "evt_unknown",
      event_category: "virtual_account",
      event_type: "virtual_account.created",
      event_object_id: "va_1",
      event_object: ["not", "an", "object"],
      event_created_at: new Date().toISOString(),
    };
    for (const event of [...events, unknown]) {
      const response = await deliver(event);
      expect(response.status, event.event_type).toBe(200);
      expect(await response.json()).toEqual({ received: true });
    }

    const stored = db.table("stables_webhook_events");
    expect(stored).toHaveLength(events.length + 1);
    for (const row of stored) {
      expect(row["processed_at"], String(row["event_type"])).not.toBeNull();
    }
    expect(stored.find((e) => e["event_id"] === "evt_unknown")).toMatchObject({
      process_error: "Ignored virtual_account.created.",
    });
  });
});

// ----------------------------------------------------------- KYC link events

describe("KYC link events", () => {
  /** A verified customer with a payment still waiting on KYC. */
  async function approvedCustomerWithPayment() {
    const payment = await paymentAwaitingKyc();
    api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
    await deliver(kycEvent("cus_1", "VERIFICATION_APPROVED", "INDIVIDUAL_BASE"));
    expect(paymentRow(payment.id)["status"]).toBe("KYC_APPROVED");
    return payment;
  }

  it("does not reject a verified customer when a step-up level is rejected", async () => {
    const payment = await approvedCustomerWithPayment();
    await deliver(kycEvent("cus_1", "VERIFICATION_REJECTED", "INDIVIDUAL_PASSPORT"));
    expect(db.table("stables_customers")[0]).toMatchObject({ verification_status: "approved" });
    expect(paymentRow(payment.id)["status"]).toBe("KYC_APPROVED");
    expect(await service.getKycStatus(user)).toMatchObject({ status: "approved" });
  });

  it("does not downgrade a verified customer when an older event is replayed", async () => {
    await approvedCustomerWithPayment();
    await deliver(kycEvent("cus_1", "VERIFICATION_IN_PROGRESS", "INDIVIDUAL_BASE"));
    expect(db.table("stables_customers")[0]).toMatchObject({ verification_status: "approved" });
  });

  it("leaves a step-up event for a retry when Stables cannot be read", async () => {
    await approvedCustomerWithPayment();
    api.getCustomer.mockRejectedValue(new StablesError("Service unavailable", 503));
    await deliver(kycEvent("cus_1", "VERIFICATION_REJECTED", "INDIVIDUAL_PASSPORT"));
    expect(db.table("stables_customers")[0]).toMatchObject({ verification_status: "approved" });
    expect(db.table("stables_webhook_events").at(-1)).toMatchObject({ processed_at: null });
  });

  it("applies a base-level rejection read back from Stables", async () => {
    const payment = await paymentAwaitingKyc();
    api.getCustomer.mockResolvedValue(customer("cus_1", "rejected", user.id));
    await deliver(kycEvent("cus_1", "VERIFICATION_REJECTED", "INDIVIDUAL_BASE"));
    expect(db.table("stables_customers")[0]).toMatchObject({ verification_status: "rejected" });
    expect(paymentRow(payment.id)["status"]).toBe("KYC_REJECTED");
  });
});

// ----------------------------------------------------------- customer events

describe("customer events", () => {
  it("customer.updated syncs an entitlement granted after KYC approval", async () => {
    const payment = await paymentAwaitingKyc();
    // Verified, but base_payout still pending: not enough to pay out.
    api.getCustomer.mockResolvedValueOnce({
      ...customer("cus_1", "approved", user.id),
      entitlements: [{ name: "base_payout", status: "in_progress" }],
    });
    await deliver(kycEvent("cus_1", "VERIFICATION_APPROVED"));
    expect(paymentRow(payment.id)["status"]).toBe("KYC_PENDING");

    api.getCustomer.mockResolvedValueOnce(customer("cus_1", "approved", user.id));
    await deliver(customerEvent("customer.updated", "cus_1", user.id));
    expect(paymentRow(payment.id)["status"]).toBe("KYC_APPROVED");
    expect(db.table("stables_customers")[0]).toMatchObject({ base_payout_status: "approved" });
  });

  it("ignores customers LamportPay did not create", async () => {
    await deliver(customerEvent("customer.created", "cus_other", "cust-1042"));
    expect(api.getCustomer).not.toHaveBeenCalled();
    expect(db.table("stables_customers")).toHaveLength(0);
    expect(db.table("stables_webhook_events")[0]).toMatchObject({
      process_error: "Not a LamportPay customer.",
    });
    expect(db.table("stables_webhook_events")[0]!["processed_at"]).not.toBeNull();
  });

  it("leaves the event for a retry when Stables cannot be reached", async () => {
    await paymentAwaitingKyc();
    api.getCustomer.mockRejectedValueOnce(new StablesError("Internal error", 500));
    await deliver(customerEvent("customer.updated", "cus_1", user.id));
    expect(db.table("stables_webhook_events")[0]).toMatchObject({ processed_at: null });
  });
});

// ------------------------------------------------------------- travel rule

describe("Travel Rule wallet verification", () => {
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const openRequests = () =>
    db.table("payment_events").filter((e) => e["kind"] === "travel_rule_verification_required");

  it("shows the verification step, then clears it once the transfer moves on", async () => {
    const { id } = await paymentAwaitingFunds();
    const expiresAt = at(24 * 3600_000);
    expect((await deliver(travelRuleEvent("tr_1", { expiresAt }))).status).toBe(200);

    expect(paymentRow(id)).toMatchObject({
      status: "AWAITING_FUNDS_COLLECTION",
      travel_rule_reference: "tr_1",
      travel_rule_verification_url:
        "https://verify.example.com/payment-sources/confirm?token=abc123",
      travel_rule_expires_at: expiresAt,
      travel_rule_resolved_at: null,
    });
    const held = await service.getPaymentView(user, id);
    expect(held.travelRule).toMatchObject({
      status: "required",
      verificationUrl: "https://verify.example.com/payment-sources/confirm?token=abc123",
      expiresAt,
    });
    // Not a payment state: the transfer state is still Stables'.
    expect(held.status).toBe("AWAITING_FUNDS_COLLECTION");

    // A later hold does not lift it; the transfer moving on does.
    await deliver({ ...transferEvent("tr_1", "COMPLIANCE_HOLD"), event_created_at: at(1000) });
    expect((await service.getPaymentView(user, id)).travelRule?.status).toBe("required");
    await deliver({ ...transferEvent("tr_1", "FUNDS_COLLECTED"), event_created_at: at(2000) });

    const released = await service.getPaymentView(user, id);
    expect(released.status).toBe("FUNDS_COLLECTED");
    expect(released.travelRule).toMatchObject({ status: "resolved", verificationUrl: null });
    expect(released.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["travel_rule_verification_required", "travel_rule_cleared"]),
    );
  });

  it("matches a request that names the deposit transaction", async () => {
    const payment = await seedTransferPayment("AWAITING_FUNDS_COLLECTION", {
      funding_signature: "5igSig",
    });
    await deliver(travelRuleEvent("5igSig"));
    expect(paymentRow(payment.id)["travel_rule_reference"]).toBe("5igSig");
  });

  it("keeps an unmatched request and applies it once the transfer is known", async () => {
    const payment = await quotedPayment();
    await deliver(travelRuleEvent("tr_1"));
    expect(db.table("stables_webhook_events")[0]).toMatchObject({
      processed_at: null,
      process_error: "No payment matches reference tr_1.",
    });

    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75"));
    const created = await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "FAMILY_MAINTENANCE",
      beneficiary: BENEFICIARY,
    });

    expect(created.travelRule?.status).toBe("required");
    expect(db.table("stables_webhook_events")[0]!["processed_at"]).not.toBeNull();
  });

  it("stores a request that arrives after the transfer already moved on as lifted", async () => {
    const { id } = await paymentAwaitingFunds();
    const requestedAt = at(-60_000);
    const collectedAt = at(-30_000);
    // Stables: request at T-60s, funds collected at T-30s. We process them in reverse.
    await deliver({ ...transferEvent("tr_1", "FUNDS_COLLECTED"), event_created_at: collectedAt });
    await deliver(travelRuleEvent("tr_1", { createdAt: requestedAt }));

    expect(paymentRow(id)).toMatchObject({
      travel_rule_requested_at: requestedAt,
      travel_rule_resolved_at: collectedAt,
    });
    expect((await service.getPaymentView(user, id)).travelRule?.status).toBe("resolved");
  });

  it("keeps the newest request and ignores an older one delivered late", async () => {
    const { id } = await paymentAwaitingFunds();
    await deliver(
      travelRuleEvent("tr_1", { url: "https://verify.example.com/new", createdAt: at(-1000) }),
    );
    await deliver(
      travelRuleEvent("tr_1", { url: "https://verify.example.com/old", createdAt: at(-5000) }),
    );
    expect(paymentRow(id)["travel_rule_verification_url"]).toBe("https://verify.example.com/new");
    expect(openRequests()).toHaveLength(1);
  });

  it("re-opens the step when Stables issues a new request after a lifted one", async () => {
    const { id } = await paymentAwaitingFunds();
    await deliver(travelRuleEvent("tr_1", { createdAt: at(-5000) }));
    await deliver({ ...transferEvent("tr_1", "FUNDS_COLLECTED"), event_created_at: at(-4000) });
    expect((await service.getPaymentView(user, id)).travelRule?.status).toBe("resolved");

    await deliver(travelRuleEvent("tr_1", { url: "https://verify.example.com/again" }));
    expect((await service.getPaymentView(user, id)).travelRule).toMatchObject({
      status: "required",
      verificationUrl: "https://verify.example.com/again",
    });
  });

  it("never hands out a link that is not https", async () => {
    const { id } = await paymentAwaitingFunds();
    await deliver(travelRuleEvent("tr_1", { url: "javascript:alert(1)" }));
    expect(paymentRow(id)["travel_rule_verification_url"]).toBeNull();
    expect((await service.getPaymentView(user, id)).travelRule).toMatchObject({
      status: "required",
      verificationUrl: null,
    });
  });

  it("reports an expired link, and a payment that ended with the hold open", async () => {
    const { id } = await paymentAwaitingFunds();
    await deliver(travelRuleEvent("tr_1", { createdAt: at(-7200_000), expiresAt: at(-60_000) }));
    expect((await service.getPaymentView(user, id)).travelRule).toMatchObject({
      status: "expired",
      verificationUrl: null,
    });

    await deliver(transferEvent("tr_1", "FAILED"));
    expect((await service.getPaymentView(user, id)).travelRule?.status).toBe("closed");
    expect(paymentRow(id)["travel_rule_resolved_at"]).toBeNull();
  });

  it("reconciliation lifts the hold only for a Stables change made after the request", async () => {
    const payment = await seedTransferPayment("AWAITING_FUNDS_COLLECTION", {
      travel_rule_reference: "ref_1",
      travel_rule_verification_url: "https://verify.example.com/x",
      travel_rule_expires_at: at(3600_000),
      travel_rule_requested_at: at(-60_000),
    });
    // Our record lags: Stables reached FUNDS_COLLECTED before the request, so it is no release.
    api.getTransfer.mockResolvedValueOnce(
      transfer(payment.transfer_id, newWallet(), "60", "funds_collected", {
        updated_at: at(-120_000),
      }),
    );
    await service.reconcilePayments({ deadline: Date.now() + 10_000 });
    expect(paymentRow(payment.id)).toMatchObject({
      status: "FUNDS_COLLECTED",
      travel_rule_resolved_at: null,
    });

    api.getTransfer.mockResolvedValueOnce(
      transfer(payment.transfer_id, newWallet(), "60", "in_progress", { updated_at: at(-1000) }),
    );
    await service.reconcilePayments({ deadline: Date.now() + 10_000 });
    expect(paymentRow(payment.id)["travel_rule_resolved_at"]).not.toBeNull();
  });
});

// ----------------------------------------------------------- reconciliation

describe("reconciliation job", () => {
  const run = () => service.reconcilePayments({ deadline: Date.now() + 10_000 });

  it("catches up a transfer whose webhooks never arrived and records the payout", async () => {
    const payment = await seedTransferPayment("AWAITING_FUNDS_COLLECTION");
    api.getTransfer.mockResolvedValueOnce(
      transfer(payment.transfer_id, payment["deposit_address"] as string, "60", "completed", {
        actual_payout: { amount: "4980", currency: "INR" },
      }),
    );

    const report = await run();
    expect(api.getTransfer).toHaveBeenCalledWith(expect.anything(), payment.transfer_id);
    expect(report.transfers).toEqual({ checked: 1, advanced: 1, settled: 1, failed: 0 });

    const row = paymentRow(payment.id);
    expect(row).toMatchObject({
      status: "COMPLETED",
      actual_payout_minor: 498000,
      actual_payout_currency: "inr",
    });
    expect(row["reconciled_at"]).not.toBeNull();
    expect(JSON.stringify(row["transfer_snapshot"])).not.toContain("123456789012");
    const sources = db
      .table("payment_events")
      .filter((e) => e["payment_id"] === payment.id)
      .map((e) => e["source"]);
    expect(sources).toEqual(["reconcile", "reconcile"]);
  });

  it("ignores stale reads instead of logging rejected transitions", async () => {
    const payment = await seedTransferPayment("PAYMENT_SUBMITTED");
    api.getTransfer.mockResolvedValueOnce(
      transfer(payment.transfer_id, newWallet(), "60", "in_progress"),
    );
    const report = await run();
    expect(report.transfers).toMatchObject({ checked: 1, advanced: 0 });
    expect(paymentRow(payment.id)["status"]).toBe("PAYMENT_SUBMITTED");
    expect(db.table("payment_events")).toHaveLength(0);
  });

  it("backfills the payout of a completed payment", async () => {
    const payment = await seedTransferPayment("COMPLETED");
    api.getTransfer.mockResolvedValueOnce(
      transfer(payment.transfer_id, newWallet(), "60", "completed", {
        actual_payout: { amount: "4980.25", currency: "inr" },
      }),
    );
    expect((await run()).transfers).toMatchObject({ settled: 1, advanced: 0 });
    expect(paymentRow(payment.id)["actual_payout_minor"]).toBe(498025);

    // Once settled it is no longer polled.
    expect((await run()).transfers.checked).toBe(0);
  });

  it("keeps going when one transfer cannot be read", async () => {
    const a = await seedTransferPayment("IN_PROGRESS");
    const b = await seedTransferPayment("IN_PROGRESS");
    api.getTransfer
      .mockRejectedValueOnce(new StablesError("Internal error", 500))
      .mockResolvedValueOnce(transfer("tr_b", newWallet(), "60", "payment_submitted"));
    const report = await run();
    expect(report.transfers).toMatchObject({ checked: 2, failed: 1, advanced: 1 });
    expect(paymentRow(a.id)["reconciled_at"]).not.toBeNull();
    expect(paymentRow(b.id)["reconciled_at"]).not.toBeNull();
  });

  it("retries stored deliveries that were never processed, but not fresh ones", async () => {
    const payment = await seedTransferPayment("AWAITING_FUNDS_COLLECTION");
    const old = transferEvent(payment.transfer_id, "FUNDS_COLLECTED");
    const fresh = transferEvent(payment.transfer_id, "IN_PROGRESS");
    await db.from("stables_webhook_events").insert([
      {
        event_id: old.event_id,
        event_type: old.event_type,
        event_object_id: payment.transfer_id,
        payload: old,
        received_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
      { event_id: fresh.event_id, event_type: fresh.event_type, payload: fresh },
    ]);
    api.getTransfer.mockResolvedValue(
      transfer(payment.transfer_id, newWallet(), "60", "funds_collected"),
    );

    const report = await run();
    expect(report.events).toEqual({ retried: 1, processed: 1 });
    expect(paymentRow(payment.id)["status"]).toBe("FUNDS_COLLECTED");
    const stored = db.table("stables_webhook_events");
    expect(stored.find((e) => e["event_id"] === old.event_id)!["processed_at"]).not.toBeNull();
    expect(stored.find((e) => e["event_id"] === fresh.event_id)!["processed_at"]).toBeNull();
  });

  it("stops starting new work at the deadline", async () => {
    await seedTransferPayment("IN_PROGRESS");
    const report = await service.reconcilePayments({ deadline: Date.now() - 1 });
    expect(report).toMatchObject({ stoppedEarly: true, transfers: { checked: 0 } });
  });
});

// ------------------------------------------------------- own-account payouts (default)

describe("payouts to the user's own account", () => {
  it("names the account holder from the approved Stables record, never the browser", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75"));
    await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
      beneficiary: BENEFICIARY,
    });

    const sent = api.createTransfer.mock.lastCall![1];
    expect(sent.destination).toMatchObject({
      account_holder_name: "Asha Rao",
      recipient_type: "individual",
    });
    expect(paymentRow(payment.id)["beneficiary_summary"]).toEqual({
      recipient_type: "individual",
      own_account: true,
      account_holder_name: "Asha Rao",
      bank_name: "State Bank",
      bank_country: "IN",
      account_kind: "account_number",
      account: "••••9012",
    });
    expect((await service.getKycStatus(user)).verifiedName).toBe("Asha Rao");
  });

  it("refuses when Stables holds no name for the customer", async () => {
    const payment = await quotedPayment();
    api.getCustomer.mockResolvedValue({
      ...customer("cus_1", "approved", user.id),
      first_name: null,
      last_name: null,
    });
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
        beneficiary: BENEFICIARY,
      }),
    ).rejects.toMatchObject({ status: 409, code: "verified_name_missing" });
    expect(api.createTransfer).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------- USDT

describe("USDT payments", () => {
  async function usdtQuoted() {
    // Previews run per coin, USDC first: no USDC route here, USDT is priced.
    api.createQuote
      .mockRejectedValueOnce(
        new StablesError(
          "No route is currently available for this transfer.",
          422,
          [],
          "ROUTING_ROUTE_NOT_CONFIGURED",
        ),
      )
      .mockResolvedValueOnce(
        quote("75", "inr", "6232.5", {
          source: { currency: "USDT", network: "solana", amount: "75" },
        }),
      );
    const created = await service.createPayment(user, {
      amount: "75",
      country: "IN",
      currency: "inr",
      sourceCurrency: "usdt",
      wallet: newWallet(),
    });
    api.createCustomerWithVerificationLink.mockResolvedValueOnce({
      customer_id: "cus_1",
      kyc_link: "https://kyc.example/1",
    });
    await service.startKyc(user, { ...ID_NAME, returnUrl: RETURN_URL });
    api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
    api.createQuote.mockResolvedValueOnce(
      quote("75", "inr", "6232.5", {
        source: { currency: "USDT", network: "solana", amount: "75" },
      }),
    );
    return service.quotePayment(user, created.id);
  }

  it("quotes, transfers and expects the deposit in USDT", async () => {
    const quoted = await usdtQuoted();
    expect(quoted.source).toMatchObject({ currency: "usdt", amount: "75" });
    expect(api.createQuote.mock.lastCall![1].source).toEqual({
      currency: "usdt",
      network: "solana",
      amount: "75",
    });

    const deposit = newWallet();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(
      transfer("tr_1", deposit, "75", "awaiting_funds_collection", {
        source_deposit_instructions: {
          wallet_address: deposit,
          currency: "usdt",
          network: "solana",
          amount: "75",
        },
      }),
    );
    const transferred = await service.createPaymentTransfer(user, quoted.id, {
      purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
      beneficiary: BENEFICIARY,
    });
    expect(transferred.deposit).toMatchObject({ address: deposit, currency: "usdt", amount: "75" });
  });

  it("stops a USDT payment whose deposit instructions ask for USDC", async () => {
    const quoted = await usdtQuoted();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75"));
    const transferred = await service.createPaymentTransfer(user, quoted.id, {
      purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
      beneficiary: BENEFICIARY,
    });
    expect(transferred.deposit).toBeNull();
    expect(transferred.failureReason).toMatch(/not USDT on Solana/);
  });
});

// ------------------------------------------------------------------ sandbox

describe("sandbox deposit simulation", () => {
  const admin = { id: "admin-1", email: "ops@example.com" };

  it("is refused with a live key", async () => {
    const { id } = await paymentAwaitingFunds();
    await expect(service.simulateSandboxDeposit(id, admin)).rejects.toMatchObject({
      status: 403,
      code: "sandbox_only",
    });
    expect(api.simulateTransferDeposit).not.toHaveBeenCalled();
  });

  it("simulates the deposit of a transfer waiting for funds, once per transfer key", async () => {
    const { id } = await paymentAwaitingFunds();
    process.env["STABLES_API_KEY"] = "sti_test_fixture";
    process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
    process.env["LAMPORTPAY_MODE"] = "test";
    api.simulateTransferDeposit.mockResolvedValue({
      transfer_id: "tr_1",
      simulation_id: "sim_1",
      scenario: "success",
      deposit_status: "received",
    });

    await expect(service.simulateSandboxDeposit(id, admin)).resolves.toMatchObject({
      simulation_id: "sim_1",
    });
    await service.simulateSandboxDeposit(id, admin);
    const [first, second] = api.simulateTransferDeposit.mock.calls;
    expect(first![1]).toBe("tr_1");
    expect(second![2]).toBe(first![2]); // same idempotency key: Stables replays, no second deposit
    expect((await service.getPaymentView(user, id)).simulatedDeposit).toBe(true);
  });

  it("only applies to a transfer still waiting for funds", async () => {
    const payment = await seedTransferPayment("IN_PROGRESS");
    process.env["STABLES_API_KEY"] = "sti_test_fixture";
    process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
    process.env["LAMPORTPAY_MODE"] = "test";
    await expect(service.simulateSandboxDeposit(payment.id, admin)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("sandbox deposit instructions", () => {
  // What the Stables sandbox returns instead of a Solana address (2026-09-27).
  const PLACEHOLDER = "sandbox:solana:45d790d05dc156bfb0e095e5a52f528c";

  // TEST MODE (the sandbox) allows 15–5,000 USDC per payment; LIVE uses this file's 50–100.
  async function transferWith(depositAddress: string, amount = "75") {
    const payment = await quotedPayment(amount);
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", depositAddress, amount));
    return service.createPaymentTransfer(user, payment.id, {
      purposeCode: "FAMILY_MAINTENANCE",
      beneficiary: BENEFICIARY,
    });
  }

  it("records the sandbox placeholder as a reference, not as an address or a failure", async () => {
    process.env["STABLES_API_KEY"] = "sti_test_fixture";
    process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
    process.env["LAMPORTPAY_MODE"] = "test";
    const view = await transferWith(PLACEHOLDER, "19");

    expect(view).toMatchObject({ status: "AWAITING_FUNDS_COLLECTION", failureReason: null });
    expect(view.deposit).toBeNull();
    expect(paymentRow(view.id)["deposit_address"]).toBeNull();
    const event = db
      .table("payment_events")
      .find((e) => e["to_status"] === "AWAITING_FUNDS_COLLECTION");
    expect(event?.["detail"]).toMatchObject({ sandbox_deposit_reference: PLACEHOLDER });
  });

  it("still checks the placeholder's amount against the quote", async () => {
    process.env["STABLES_API_KEY"] = "sti_test_fixture";
    process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
    process.env["LAMPORTPAY_MODE"] = "test";
    const payment = await quotedPayment("19");
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_1", PLACEHOLDER, "19.5"));
    const view = await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "FAMILY_MAINTENANCE",
      beneficiary: BENEFICIARY,
    });
    expect(view.failureReason).toMatch(/asks for 19.5 USDC, not the quoted 19 USDC/);
  });

  it("refuses the placeholder outside the sandbox", async () => {
    const view = await transferWith(PLACEHOLDER);
    expect(view.failureReason).toBe("The deposit address is not a valid Solana address.");
    expect(view.deposit).toBeNull();
  });
});

// ---------------------------------------------------- history and receipts

describe("history and receipts", () => {
  it("answers 404, not a database error, for a malformed payment ID", async () => {
    await expect(service.getPaymentView(user, "undefined")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("dates the receipt when Stables completed the transfer, not when we noticed", async () => {
    const { id, deposit } = await paymentAwaitingFunds();
    const completedAt = new Date(Date.now() - 3 * 3600_000).toISOString();
    api.getTransfer.mockResolvedValueOnce(transfer("tr_1", deposit, "75", "completed"));
    await deliver({ ...transferEvent("tr_1", "COMPLETED"), event_created_at: completedAt });
    expect((await service.getPaymentView(user, id)).completedAt).toBe(completedAt);
  });

  it("lists the user's payments and records the completion time for the receipt", async () => {
    const { id, deposit } = await paymentAwaitingFunds();
    api.getTransfer.mockResolvedValueOnce(
      transfer("tr_1", deposit, "75", "completed", {
        actual_payout: { amount: "6230.10", currency: "INR" },
      }),
    );
    await deliver(transferEvent("tr_1", "COMPLETED"));

    const [item] = await service.listPayments(user);
    expect(item).toMatchObject({
      id,
      status: "COMPLETED",
      accountHolder: "Asha Rao",
      actualPayout: { currency: "inr", amount: "6230.1" },
    });
    const receipt = await service.getPaymentView(user, id);
    expect(receipt.completedAt).not.toBeNull();
    expect(receipt.transferId).toBe("tr_1");
    expect(receipt.beneficiary?.account).toBe("••••9012");
  });

  it("matches a Travel Rule reference that is our own payment ID", async () => {
    const { id } = await paymentAwaitingFunds();
    await deliver(travelRuleEvent(id));
    expect(paymentRow(id)["travel_rule_reference"]).toBe(id);
    const event = db
      .table("payment_events")
      .find((e) => e["kind"] === "travel_rule_verification_required");
    expect(event?.["detail"]).toMatchObject({ matched_by: "payment_id" });
  });
});

// ------------------------------------------------------ LamportPay's own fee

describe("LamportPay fee (non-custodial split)", () => {
  const REVENUE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const ADMIN = "00000000-0000-4000-8000-000000000001";

  beforeEach(async () => {
    await updateBusinessSettings({ conversionFeeBps: 200, revenueWallet: REVENUE }, ADMIN);
  });

  it("snapshots the fee with the quote and shows the total, never the wallet", async () => {
    const quoted = await quotedPayment("75");
    expect(quoted.platformFee).toEqual({
      bps: 200,
      rule: "percentage",
      amountMinor: "1530613",
      amount: "1.530613",
      currency: "usdc",
      settled: null,
    });
    expect(quoted.totalToPay).toMatchObject({ amount: "76.530613", currency: "usdc" });
    expect(JSON.stringify(quoted)).not.toContain(REVENUE);
    expect(paymentRow(quoted.id)).toMatchObject({
      platform_fee_bps: 200,
      platform_fee_minor: 1_530_613,
      platform_fee_wallet: REVENUE,
    });

    // A later change applies to new quotes only, never to this payment's transfer.
    await updateBusinessSettings({ conversionFeeBps: 100 }, ADMIN);
    expect(paymentRow(quoted.id)["platform_fee_minor"]).toBe(1_530_613);
  });

  it("applies a configured minimum fee and records the rule with the payment (C05)", async () => {
    await updateBusinessSettings({ feeMinMinor: 3_000_000 }, ADMIN);
    const quoted = await quotedPayment("75");
    // 2% of the total is 1.53, below the 3 minimum: the fee is 3, still one fee.
    expect(quoted.platformFee).toMatchObject({ bps: 200, rule: "minimum", amount: "3" });
    expect(quoted.totalToPay).toMatchObject({ amount: "78", currency: "usdc" });
    expect(paymentRow(quoted.id)).toMatchObject({
      platform_fee_minor: 3_000_000,
      platform_fee_min_minor: 3_000_000,
      platform_fee_max_minor: null,
      platform_fee_rule: "minimum",
    });
  });

  it("needs the amount plus the fee in the wallet before paying", async () => {
    const { id } = await paymentAwaitingFunds("75");
    const payer = newWallet();
    wallets.readWalletHoldings.mockResolvedValueOnce(holdings(payer, { usdc: 75_000_000n }));
    await expect(service.buildFundingTransaction(user, id, payer)).rejects.toMatchObject({
      code: "insufficient_balance",
      message: expect.stringMatching(/needs 76\.530613 USDC including the LamportPay fee/),
    });
  });

  it("builds one transaction: exact deposit to Stables plus the fee to the revenue wallet", async () => {
    const { id, deposit } = await paymentAwaitingFunds("75");
    const payer = newWallet();
    mockBlockhash();
    const built = await service.buildFundingTransaction(user, id, payer);
    expect(built).toMatchObject({ amount: "75", platformFee: "1.530613", total: "76.530613" });
    expect(wallets.solReserveLamports).toHaveBeenLastCalledWith(
      expect.objectContaining({ depositOwner: deposit, feeOwner: REVENUE }),
    );

    const { Transaction } = await import("@solana/web3.js");
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    const transfers = tx.instructions.filter((i) => i.data[0] === 12 && i.data.length === 10);
    expect(transfers.map((i) => i.data.readBigUInt64LE(1))).toEqual([75_000_000n, 1_530_613n]);
    // Every transfer is signed by the user's own wallet; the server signs nothing.
    expect(tx.signatures.every((s) => s.signature === null)).toBe(true);
    expect(tx.feePayer?.toBase58()).toBe(payer);
  });

  it("verifies the deposit and records the fee received", async () => {
    const { id, deposit } = await paymentAwaitingFunds("75");
    const payer = newWallet();
    mockBlockhash();
    await service.buildFundingTransaction(user, id, payer);
    rpcMock.mockResolvedValueOnce({
      ok: true,
      result: usdcTransferTx({
        from: payer,
        to: deposit,
        amount: 75_000_000n,
        fee: { to: REVENUE, amount: 1_530_613n },
      }),
    });
    const signature = fakeSignature();
    const funded = await service.verifyFunding(user, id, signature);
    expect(funded).toMatchObject({ pending: false });
    expect(paymentRow(id)["platform_fee_received_minor"]).toBe(1_530_613);
    const kinds = db.table("payment_events").map((e) => e["kind"]);
    expect(kinds).not.toContain("platform_fee_mismatch");
  });

  it("fixes the price at transfer creation and keeps an append-only fee ledger", async () => {
    const { id, deposit } = await paymentAwaitingFunds("75");
    const row = paymentRow(id);
    expect(row["pricing_snapshot"]).toMatchObject({
      lamportpay_fee: {
        bps: 200,
        amount_minor: "1530613",
        currency: "usdc",
        revenue_wallet_set: true,
      },
      deposit_minor: "75000000",
      total_minor: "76530613",
    });
    // The snapshot never carries the revenue wallet address itself.
    expect(JSON.stringify(row["pricing_snapshot"])).not.toContain(REVENUE);
    const expected = db.table("payment_fee_ledger").filter((e) => e["payment_id"] === id);
    expect(expected).toContainEqual(
      expect.objectContaining({
        category: "lamportpay_fee",
        entry_type: "expected",
        amount_minor: 1_530_613,
        currency: "usdc",
        bps: 200,
      }),
    );
    // Stables' own fee, as Stables quoted it, in its own currency.
    expect(expected).toContainEqual(
      expect.objectContaining({ category: "partner_fee", component: "total_fee", currency: "usd" }),
    );

    const payer = newWallet();
    mockBlockhash();
    await service.buildFundingTransaction(user, id, payer);
    const signature = fakeSignature();
    rpcMock.mockResolvedValueOnce({
      ok: true,
      result: usdcTransferTx({
        from: payer,
        to: deposit,
        amount: 75_000_000n,
        fee: { to: REVENUE, amount: 1_530_613n },
      }),
    });
    await service.verifyFunding(user, id, signature);
    const received = db
      .table("payment_fee_ledger")
      .filter((e) => e["payment_id"] === id && e["entry_type"] === "received");
    expect(received).toEqual([
      expect.objectContaining({
        category: "lamportpay_fee",
        amount_minor: 1_530_613,
        reference: signature,
      }),
    ]);
  });

  it("never blocks a deposit that reached Stables without the fee; flags it instead", async () => {
    const { id, deposit } = await paymentAwaitingFunds("75");
    const payer = newWallet();
    mockBlockhash();
    await service.buildFundingTransaction(user, id, payer);
    rpcMock.mockResolvedValueOnce({
      ok: true,
      result: usdcTransferTx({ from: payer, to: deposit, amount: 75_000_000n }),
    });
    const funded = await service.verifyFunding(user, id, fakeSignature());
    expect(funded).toMatchObject({ pending: false });
    expect(paymentRow(id)["platform_fee_received_minor"]).toBe(0);
    const mismatch = db.table("payment_events").find((e) => e["kind"] === "platform_fee_mismatch");
    expect(mismatch?.["detail"]).toMatchObject({ expected_minor: "1530613", received_minor: "0" });
  });
});

describe("payment coins turned off", () => {
  it("refuses USDT when only USDC is on, and prices USDC only", async () => {
    await updateBusinessSettings(
      { enabledCurrencies: ["usdc"] },
      "00000000-0000-4000-8000-000000000001",
    );
    await expect(
      service.createPayment(user, {
        amount: "75",
        country: "IN",
        currency: "inr",
        preferredCurrency: "usdt",
        wallet: newWallet(),
      }),
    ).rejects.toMatchObject({ status: 400, code: "currency_disabled" });

    await createPayment("75");
    const previews = api.createQuote.mock.calls.map(
      (c) => (c[1] as { source: { currency: string } }).source.currency,
    );
    expect(previews).toEqual(["usdc"]);
  });
});

// ------------------------------------------------ live calculator (no wallet)

describe("live estimate for the /pay calculator", () => {
  it("prices with a Stables preview and adds the one LamportPay fee, creating nothing", async () => {
    const { liveEstimate } = await import("@/lib/payments/live-estimate.server");
    await updateBusinessSettings(
      { conversionFeeBps: 200, revenueWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
      "00000000-0000-4000-8000-000000000001",
    );
    api.createQuote.mockResolvedValueOnce(quote("73.5", "inr", "6100"));
    const est = await liveEstimate({
      amount: "75",
      country: "in",
      currency: "INR",
      coin: "usdc",
      withSol: false,
    });
    expect(api.createQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: true }),
    );
    // The user sends 75: 2% (1.50) comes out, 73.50 goes to the payout partner.
    expect(api.createQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: expect.objectContaining({ amount: "73.5" }) }),
    );
    expect(est).toMatchObject({
      amount: "75",
      converted: "73.5",
      payout: {
        status: "priced",
        country: "IN",
        currency: "inr",
        receives: "6100",
        partnerFees: [{ kind: "total_fee", amount: "0.75", currency: "usd" }],
      },
      lamportpayFee: { bps: 200, amount: "1.5", rule: "percentage" },
      totalFromWallet: "75",
      sol: null,
    });
    expect(db.table("payments")).toHaveLength(0);
  });

  it("applies the minimum to what the user sends, fee included (owner decision 2 Oct)", async () => {
    const { liveEstimate } = await import("@/lib/payments/live-estimate.server");
    await updateBusinessSettings(
      { conversionFeeBps: 200, revenueWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
      "00000000-0000-4000-8000-000000000001",
    );
    // Test limits are 50–100 USDC. Sending exactly 50: 1.00 fee, 49.00 converted, allowed.
    api.createQuote.mockResolvedValueOnce(quote("49", "inr", "4070"));
    const atMin = await liveEstimate({
      amount: "50",
      country: "in",
      currency: "INR",
      coin: "usdc",
      withSol: false,
    });
    expect(atMin).toMatchObject({ converted: "49", payout: { status: "priced" } });

    // Below the minimum (49.99 sent) is refused without asking Stables.
    api.createQuote.mockClear();
    const below = await liveEstimate({
      amount: "49.99",
      country: "in",
      currency: "INR",
      coin: "usdc",
      withSol: false,
    });
    expect(below.payout.status).toBe("refused");
    expect(api.createQuote).not.toHaveBeenCalled();

    // A payment created from that 50 (49 converted) passes the limits too.
    api.createQuote.mockResolvedValue(quote("49", "inr", "4070"));
    await service.createPayment(user, {
      amount: "49",
      country: "in",
      currency: "INR",
      wallet: newWallet(),
    });
    expect(db.table("payments")).toHaveLength(1);
  });

  it("returns Stables' refusal instead of a number", async () => {
    const { liveEstimate } = await import("@/lib/payments/live-estimate.server");
    const est = await liveEstimate({
      amount: "75",
      country: "zz",
      currency: "xyz",
      coin: "usdc",
      withSol: false,
    });
    expect(est.payout.status).toBe("refused");
  });
});

describe("quote before verification (NEXT FLOW)", () => {
  it("quotes a new user who has no payout-partner customer yet", async () => {
    const payment = await createPayment("75");
    api.createQuote.mockResolvedValueOnce(quote("75", "inr", "6232.5"));
    const view = await service.quotePayment(user, payment.id);
    expect(view.status).toBe("QUOTED");
    expect(api.getCustomer).not.toHaveBeenCalled();
  });

  it("still refuses to create the transfer until the customer is verified", async () => {
    const payment = await createPayment("75");
    api.createQuote.mockResolvedValueOnce(quote("75", "inr", "6232.5"));
    await service.quotePayment(user, payment.id);
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "FAMILY_MAINTENANCE",
        beneficiary: BENEFICIARY,
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    expect(api.createTransfer).not.toHaveBeenCalled();
  });
});

// --------------------------------------------- beneficiary (third-party) payouts

describe("payouts to a beneficiary's account (owner decision 2026-10-11)", () => {
  const TO_SOMEONE = {
    ...BENEFICIARY,
    holderName: "  Ravi   Kumar ",
    recipientType: "individual" as const,
  };

  it("sends the beneficiary's name to Stables and records it as not the user's own", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_b1", newWallet(), "75"));
    await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "FAMILY_MAINTENANCE",
      beneficiary: TO_SOMEONE,
    });
    const sent = api.createTransfer.mock.lastCall![1];
    expect(sent.destination).toMatchObject({
      account_holder_name: "Ravi Kumar",
      recipient_type: "individual",
    });
    expect(paymentRow(payment.id)["beneficiary_summary"]).toMatchObject({
      own_account: false,
      account_holder_name: "Ravi Kumar",
    });
  });

  it("sends a business beneficiary as a business recipient", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_b2", newWallet(), "75"));
    await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "VENDOR_CONTRACTOR_PAYOUTS",
      beneficiary: { ...TO_SOMEONE, holderName: "Acme Supplies Ltd", recipientType: "business" },
    });
    expect(api.createTransfer.mock.lastCall![1].destination).toMatchObject({
      account_holder_name: "Acme Supplies Ltd",
      recipient_type: "business",
    });
  });

  it("refuses a beneficiary payout labelled as a transfer to the user's own account", async () => {
    const payment = await quotedPayment();
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
        beneficiary: TO_SOMEONE,
      }),
    ).rejects.toMatchObject({ status: 400, code: "purpose_required" });
    expect(api.createTransfer).not.toHaveBeenCalled();
  });

  it("treats the user's own verified name as their own account", async () => {
    const payment = await quotedPayment();
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockResolvedValueOnce(transfer("tr_b3", newWallet(), "75"));
    await service.createPaymentTransfer(user, payment.id, {
      purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
      beneficiary: { ...BENEFICIARY, holderName: "asha  rao" },
    });
    expect(paymentRow(payment.id)["beneficiary_summary"]).toMatchObject({ own_account: true });
  });

  it("still requires the sender to be verified before a beneficiary payout", async () => {
    const payment = await createPayment("75");
    await expect(
      service.createPaymentTransfer(user, payment.id, {
        purposeCode: "FAMILY_MAINTENANCE",
        beneficiary: TO_SOMEONE,
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    expect(api.createTransfer).not.toHaveBeenCalled();
  });

  it("checks a beneficiary's details under the beneficiary's name", async () => {
    const payment = await quotedPayment();
    await service.getKycStatus(user);
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    const result = await service.checkPayoutDetails(user, payment.id, { beneficiary: TO_SOMEONE });
    expect(result).toEqual({ valid: true, holderName: "Ravi Kumar", holderSource: "beneficiary" });
    expect(JSON.stringify(api.validatePaymentMethod.mock.calls[0]![1])).toContain("Ravi Kumar");
  });
});

describe("payout details check", () => {
  it("validates the bank details with Stables using the entered name for a new user", async () => {
    const payment = await createPayment("75");
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    const result = await service.checkPayoutDetails(user, payment.id, {
      beneficiary: BENEFICIARY,
      holderName: "  Ada   Lovelace ",
    });
    expect(result).toEqual({ valid: true, holderName: "Ada Lovelace", holderSource: "entered" });
    const [, body] = api.validatePaymentMethod.mock.calls[0]!;
    expect(JSON.stringify(body)).toContain("Ada Lovelace");
    const events = await ledger.listPaymentEvents(payment.id);
    const checked = events.find((e) => e.kind === "payout_details_checked");
    expect(JSON.stringify(checked?.detail)).not.toContain(BENEFICIARY.accountNumber);
  });

  it("uses the verified name for a returning customer, ignoring a typed one", async () => {
    const payment = await quotedPayment();
    await service.getKycStatus(user); // stores "approved" with Stables' name
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    const result = await service.checkPayoutDetails(user, payment.id, {
      beneficiary: BENEFICIARY,
      holderName: "Someone Else",
    });
    expect(result).toMatchObject({ holderName: "Asha Rao", holderSource: "verified_record" });
  });

  it("asks for a name when there is no verified record", async () => {
    const payment = await createPayment("75");
    await expect(
      service.checkPayoutDetails(user, payment.id, { beneficiary: BENEFICIARY }),
    ).rejects.toMatchObject({ status: 400, code: "name_required" });
    expect(api.validatePaymentMethod).not.toHaveBeenCalled();
  });

  it("reports Stables' field errors instead of accepting invalid details", async () => {
    const payment = await createPayment("75");
    api.validatePaymentMethod.mockResolvedValueOnce({
      valid: false,
      errors: [{ field: "ifsc_code", message: "Invalid IFSC" }],
    } as never);
    await expect(
      service.checkPayoutDetails(user, payment.id, {
        beneficiary: BENEFICIARY,
        holderName: "Ada Lovelace",
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
  });
});

describe("TEST MODE Pay Now (devnet memo transaction)", () => {
  const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

  function memoTx(signer: string, memo: string, err: unknown = null) {
    return {
      ok: true as const,
      result: {
        blockTime: Math.floor(Date.now() / 1000),
        meta: { err },
        transaction: {
          message: {
            accountKeys: [{ pubkey: signer, signer: true }],
            instructions: [{ programId: MEMO, program: "spl-memo", parsed: memo }],
          },
        },
      },
    };
  }

  async function awaitingTestPayment() {
    const { id } = await paymentAwaitingFunds("75");
    Object.assign(process.env, {
      LAMPORTPAY_MODE: "test",
      STABLES_API_KEY: "sti_test_fixture",
      STABLES_API_URL: "https://api.sandbox.stables.money",
    });
    api.simulateTransferDeposit.mockResolvedValue({
      transfer_id: "tr_1",
      simulation_id: "sim_1",
      scenario: "success",
      deposit_status: "received",
    });
    const wallet = newWallet();
    wallets.readWalletHoldings.mockResolvedValue(holdings(wallet));
    return { id, wallet, payer: { ...user, wallets: [wallet] } };
  }

  // Lazy import: the module reads the mode at call time.
  const confirm = async (
    ...args: Parameters<typeof import("@/lib/payments/test-payment.server").confirmTestPayment>
  ) => (await import("@/lib/payments/test-payment.server")).confirmTestPayment(...args);

  it("detects the signed devnet transaction, then simulates the sandbox deposit once", async () => {
    const { id, wallet, payer } = await awaitingTestPayment();
    const sig = fakeSignature();
    rpcMock.mockResolvedValue(memoTx(wallet, `LamportPay TEST payment ${id}`) as never);
    const view = await confirm(payer, id, sig);
    expect(rpcMock.mock.calls[0]![0]).toBe("devnet");
    expect(view.testPayment).toMatchObject({ signature: sig, wallet });
    expect(view.testPayment?.explorerUrl).toContain("cluster=devnet");
    expect(api.simulateTransferDeposit).toHaveBeenCalledTimes(1);
    // Nothing marks the payment complete here: Stables drives the rest.
    expect(view.status).not.toBe("COMPLETED");

    // Same signature again: answered, no second simulation.
    await confirm(payer, id, sig);
    expect(api.simulateTransferDeposit).toHaveBeenCalledTimes(1);
    // A different transaction for an already-paid payment is refused.
    await expect(confirm(payer, id, fakeSignature())).rejects.toMatchObject({
      status: 409,
      code: "already_paid",
    });
  });

  it("refuses a transaction for another payment, from another wallet, failed or unconfirmed", async () => {
    const { id, wallet, payer } = await awaitingTestPayment();
    rpcMock.mockResolvedValueOnce(memoTx(wallet, "LamportPay TEST payment other") as never);
    await expect(confirm(payer, id, fakeSignature())).rejects.toMatchObject({
      code: "memo_mismatch",
    });
    rpcMock.mockResolvedValueOnce(memoTx(newWallet(), `LamportPay TEST payment ${id}`) as never);
    await expect(confirm(payer, id, fakeSignature())).rejects.toMatchObject({
      code: "wrong_wallet",
    });
    rpcMock.mockResolvedValueOnce(
      memoTx(wallet, `LamportPay TEST payment ${id}`, { InstructionError: [0, "x"] }) as never,
    );
    await expect(confirm(payer, id, fakeSignature())).rejects.toMatchObject({
      code: "transaction_failed",
    });
    rpcMock.mockResolvedValueOnce({ ok: true, result: null } as never);
    await expect(confirm(payer, id, fakeSignature())).rejects.toMatchObject({
      code: "not_confirmed",
    });
    expect(api.simulateTransferDeposit).not.toHaveBeenCalled();
  });

  it("uses a valid Solana address for the Memo program (client and server agree)", async () => {
    const { PublicKey } = await import("@solana/web3.js");
    const { MEMO_PROGRAM_ID } = await import("@/lib/payments/test-payment.server");
    expect(MEMO_PROGRAM_ID).toBe(MEMO);
    expect(new PublicKey(MEMO_PROGRAM_ID).toBase58()).toBe(MEMO);
  });

  it("refuses when the approving wallet doesn't hold the devnet USDC the payment needs", async () => {
    const { id, wallet, payer } = await awaitingTestPayment();
    wallets.readWalletHoldings.mockResolvedValue(holdings(wallet, { usdc: 1_000_000n })); // 1 USDC
    rpcMock.mockResolvedValueOnce(memoTx(wallet, `LamportPay TEST payment ${id}`) as never);
    await expect(confirm(payer, id, fakeSignature())).rejects.toMatchObject({
      status: 409,
      code: "insufficient_funds",
    });
    expect(api.simulateTransferDeposit).not.toHaveBeenCalled();
  });

  it("is refused in LIVE MODE", async () => {
    const { id } = await paymentAwaitingFunds("75");
    await expect(confirm(user, id, fakeSignature())).rejects.toMatchObject({
      code: "test_mode_only",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("live status sync (no webhook, no reconcile command)", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const age = (id: string) => {
    const row = db.table("payments").find((p) => p["id"] === id)!;
    row["reconciled_at"] = minutesAgo(5);
  };

  it("moves the payment screen to COMPLETED as soon as Stables reports completed", async () => {
    const { id } = await paymentAwaitingFunds();
    age(id);
    api.getTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75", "completed"));
    const view = await service.getPaymentView(user, id);
    expect(view.status).toBe("COMPLETED");
    const moved = (await ledger.listPaymentEvents(id)).find((e) => e.to_status === "COMPLETED");
    expect(moved?.source).toBe("reconcile");
    expect(moved?.detail).toMatchObject({ trigger: "live_sync", transfer_status: "completed" });
  });

  it("mirrors IN_PROGRESS while Stables is still processing; never invents COMPLETED", async () => {
    const { id } = await paymentAwaitingFunds();
    age(id);
    api.getTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75", "in_progress"));
    expect((await service.getPaymentView(user, id)).status).toBe("IN_PROGRESS");
  });

  it("asks Stables at most once per interval, however often the screen polls", async () => {
    const { id } = await paymentAwaitingFunds();
    age(id);
    api.getTransfer.mockClear();
    await service.getPaymentView(user, id);
    await service.getPaymentView(user, id);
    await service.getPaymentView(user, id);
    expect(api.getTransfer).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored state when Stables cannot be reached", async () => {
    const { id } = await paymentAwaitingFunds();
    age(id);
    const before = (await ledger.getPayment(id))!.status;
    api.getTransfer.mockRejectedValueOnce(new StablesError("Bad gateway", 502));
    const view = await service.getPaymentView(user, id);
    expect(view.status).toBe(before);
  });

  it("does not move a finished payment backwards or call Stables for it", async () => {
    const payment = await seedTransferPayment("COMPLETED");
    api.getTransfer.mockClear();
    api.getTransfer.mockResolvedValue(transfer("tr_x", newWallet(), "75", "in_progress"));
    expect((await service.getPaymentView(user, payment.id)).status).toBe("COMPLETED");
    expect(api.getTransfer).not.toHaveBeenCalled();
  });

  it("applies Stables' status right after a simulated sandbox deposit", async () => {
    const { id } = await paymentAwaitingFunds();
    Object.assign(process.env, {
      LAMPORTPAY_MODE: "test",
      STABLES_API_KEY: "sti_test_fixture",
      STABLES_API_URL: "https://api.sandbox.stables.money",
    });
    api.simulateTransferDeposit.mockResolvedValue({
      transfer_id: "tr_1",
      simulation_id: "sim_1",
      scenario: "completed",
      deposit_status: "completed",
    });
    api.getTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75", "completed"));
    await service.simulateSandboxDeposit(id, { id: "admin-1" });
    expect((await ledger.getPayment(id))?.status).toBe("COMPLETED");
  });
});

describe("emergency controls (server-enforced)", () => {
  const OPS = "00000000-0000-4000-8000-0000000000aa";
  const setControls = (controls: unknown) =>
    updateBusinessSettings({ paymentControls: { mode: "live", controls } }, OPS);

  it("a global pause refuses new payments with 503 and creates nothing", async () => {
    await setControls({ paused: true, reason: "incident" });
    await expect(createPayment()).rejects.toMatchObject({ status: 503, code: "payments_paused" });
    expect(db.table("payments")).toHaveLength(0);
  });

  it("a global pause also refuses the quote of an existing payment", async () => {
    const payment = await paymentAwaitingKyc();
    await setControls({ paused: true, reason: "incident" });
    await expect(service.quotePayment(user, payment.id)).rejects.toMatchObject({
      code: "payments_paused",
    });
  });

  it("pausing one payout currency refuses only that currency", async () => {
    await setControls({ paused: false, corridors: { INR: { paused: true, reason: "partner" } } });
    await expect(createPayment()).rejects.toMatchObject({ status: 503, code: "corridor_paused" });
    await setControls({ paused: false, corridors: { GBP: { paused: true, reason: "partner" } } });
    await expect(createPayment()).resolves.toMatchObject({ status: expect.any(String) });
  });

  it("a corridor limit narrows the coin limits on the server", async () => {
    // Coin limits in this file: 50–100. INR max 60 → 75 is refused before Stables is asked.
    await setControls({ paused: false, corridors: { INR: { max_minor: 60_000_000 } } });
    api.createQuote.mockClear();
    await expect(createPayment("75")).rejects.toMatchObject({ code: "amount_out_of_range" });
  });

  it("a pause never touches payments already sent: Stables' status still applies", async () => {
    const { id } = await paymentAwaitingFunds();
    await setControls({ paused: true, reason: "incident" });
    const row = db.table("payments").find((p) => p["id"] === id)!;
    row["reconciled_at"] = new Date(Date.now() - 5 * 60_000).toISOString();
    api.getTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "75", "completed"));
    expect((await service.getPaymentView(user, id)).status).toBe("COMPLETED");
  });

  it("refuses a pause without a reason", async () => {
    await expect(setControls({ paused: true })).rejects.toThrow(/reason/);
  });
});
