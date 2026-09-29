/**
 * Settlement choice, funding guards and payment-bound swaps, against mocked
 * Stables, Jupiter, Solana RPC and wallet balances, and an in-memory database.
 * No network and no funds. Transactions are real Solana v0 transactions built
 * and signed in the test with throwaway keys.
 */
import { randomUUID } from "node:crypto";
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/solana-balances.server", () => ({
  readWalletHoldings: vi.fn(),
  solReserveLamports: vi.fn(),
  tokenAccountRentLamports: vi.fn(),
  accountExists: vi.fn(),
  solFeeReserveMarginLamports: vi.fn(),
}));
// Real message hashing and signature checks; only the network calls are mocked.
vi.mock("@/lib/jupiter/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jupiter/client.server")>();
  return { ...actual, getOrder: vi.fn(), executeOrder: vi.fn(), isJupiterConfigured: vi.fn() };
});

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as jupiter from "@/lib/jupiter/client.server";
import type { JupiterOrder } from "@/lib/jupiter/client.server";
import * as service from "@/lib/payments/service.server";
import * as swaps from "@/lib/payments/swaps.server";
import * as balances from "@/lib/solana-balances.server";
import { rpc } from "@/lib/solana-rpc.server";
import * as stables from "@/lib/stables/client.server";
import { StablesError } from "@/lib/stables/client.server";
import type { StablesQuote } from "@/lib/stables/types";
import { SOL_MINT, USDC_MINT } from "@/lib/tokens";
import type { FakeSupabase } from "./support/fake-supabase";
import { customer, newWallet, quote, transfer } from "./support/payment-fixtures";

const db = supabaseAdmin as unknown as FakeSupabase;
const api = vi.mocked(stables);
const jup = vi.mocked(jupiter);
const rpcMock = vi.mocked(rpc);
const wallets = vi.mocked(balances);

const ENV_KEYS = [
  "STABLES_API_KEY",
  "STABLES_API_URL",
  "PAYMENT_MIN_USDC",
  "PAYMENT_MAX_USDC",
  "PAYMENT_MIN_USDT",
  "PAYMENT_MAX_USDT",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => {
  for (const k of ENV_KEYS) process.env[k] = savedEnv[k] ?? "";
});

const USDC = (major: string) => BigInt(Math.round(Number(major) * 1e6));
const SOL = 1_000_000_000n;

let user: { id: string; email: string };
/** The user's own wallet: a real key, so swap transactions can be signed. */
let wallet: Keypair;

function sandbox() {
  process.env["STABLES_API_KEY"] = "sti_test_fixture";
  process.env["STABLES_API_URL"] = "https://api.sandbox.stables.money";
}

function holds(tokens: { usdc?: string; usdt?: string }, sol = 10n * SOL) {
  wallets.readWalletHoldings.mockImplementation(async (owner) => ({
    status: "ok",
    owner,
    slot: 1,
    readAt: new Date().toISOString(),
    solLamports: sol,
    tokens: { usdc: USDC(tokens.usdc ?? "0"), usdt: USDC(tokens.usdt ?? "0") },
  }));
}

const NO_ROUTE = () =>
  new StablesError(
    "No route is currently available for this transfer.",
    422,
    [],
    "ROUTING_ROUTE_NOT_CONFIGURED",
  );

/** Stables' answers per coin, previews and firm quotes alike (the 2026-09-27 matrix). */
function stablesPrices(dest: string, payouts: { usdc?: string; usdt?: string }) {
  api.createQuote.mockImplementation(async (_config, body) => {
    const coin = body.source.currency as "usdc" | "usdt";
    const payout = payouts[coin];
    if (!payout) throw NO_ROUTE();
    const q: StablesQuote = quote(body.source.amount!, dest, payout, {
      source: { currency: coin, network: "solana", amount: body.source.amount! },
    });
    return body.preview
      ? { ...q, status: "preview" }
      : { ...q, quote_id: `firm_${coin}_${randomUUID()}` };
  });
}

beforeEach(() => {
  db.reset();
  vi.resetAllMocks();
  Object.assign(process.env, {
    STABLES_API_KEY: "sti_live_fixture",
    STABLES_API_URL: "https://api.stables.money",
    PAYMENT_MIN_USDC: "100",
    PAYMENT_MAX_USDC: "1000",
    PAYMENT_MIN_USDT: "100",
    PAYMENT_MAX_USDT: "1000",
  });
  user = { id: randomUUID(), email: "user@example.com" };
  wallet = Keypair.generate();
  wallets.solReserveLamports.mockResolvedValue(5_000_000n);
  wallets.tokenAccountRentLamports.mockResolvedValue(2_039_280n);
  api.getTransfer.mockImplementation(async (_config, id) =>
    transfer(id, newWallet(), "0", "awaiting_funds_collection"),
  );
  jup.isJupiterConfigured.mockReturnValue(true);
  rpcMock.mockImplementation(async (_cluster, method) => {
    if (method === "getBlockHeight") return { ok: true, result: 100 };
    if (method === "getTransaction") return { ok: true, result: null };
    return { ok: false, error: `unexpected ${method}`, status: 500 };
  });
});

/** A verified customer, as after hosted KYC. */
async function verified() {
  await db.from("stables_customers").insert({
    user_id: user.id,
    stables_customer_id: "cus_1",
    verification_status: "approved",
    base_payout_status: "approved",
    first_name: "Asha",
    last_name: "Rao",
  });
  api.getCustomer.mockResolvedValue(customer("cus_1", "approved", user.id));
}

function create(
  extra: { wallet?: string | null; preferredCurrency?: "auto" | "usdc" | "usdt" } = {},
) {
  return service.createPayment(user, {
    amount: "150",
    country: "GB",
    currency: "gbp",
    wallet: extra.wallet === undefined ? wallet.publicKey.toBase58() : extra.wallet,
    preferredCurrency: extra.preferredCurrency,
  });
}

/** Make the last settlement check old enough to re-check. */
function ageEvents() {
  for (const e of db.table("payment_events")) e["created_at"] = "2020-01-01T00:00:00.000Z";
}

const events = (paymentId: string) =>
  db.table("payment_events").filter((e) => e["payment_id"] === paymentId);

// ------------------------------------------------------------- the choice

describe("settlement at payment creation", () => {
  it("pays with the coin the wallet already holds, with no swap", async () => {
    stablesPrices("gbp", { usdc: "111.66", usdt: "112.04" });
    holds({ usdt: "200" });
    const p = await create();
    expect(p.source.currency).toBe("usdt");
    expect(p.settlement).toMatchObject({ kind: "funds_ready", coin: "usdt" });
    expect(p.settlement?.holdings).toMatchObject({ status: "ok", tokens: { usdt: "200" } });
    expect(p.latestSwap).toBeNull();
    expect(jup.getOrder).not.toHaveBeenCalled();
  });

  it("takes the better payout when both coins are held", async () => {
    stablesPrices("gbp", { usdc: "111.66", usdt: "112.04" });
    holds({ usdc: "200", usdt: "200" });
    expect((await create()).source.currency).toBe("usdt");
  });

  it("lets a preference choose among held coins", async () => {
    stablesPrices("gbp", { usdc: "111.66", usdt: "112.04" });
    holds({ usdc: "200", usdt: "200" });
    expect((await create({ preferredCurrency: "usdc" })).source.currency).toBe("usdc");
  });

  it("chooses the coin Stables can pay out, and says a swap is needed (USD, wallet holds USDT)", async () => {
    stablesPrices("usd", { usdc: "142.13" });
    holds({ usdt: "500" });
    const p = await service.createPayment(user, {
      amount: "150",
      country: "US",
      currency: "usd",
      wallet: wallet.publicKey.toBase58(),
    });
    expect(p.source.currency).toBe("usdc");
    expect(p.settlement).toMatchObject({ kind: "swap_required", coin: "usdc", shortfall: "150" });
    expect(p.settlement?.swapInputs.map((i) => i.asset)).toEqual(["sol", "usdt"]);
    expect(p.settlement?.reason).toMatch(/USDT can't pay out USD/);
  });

  it("records a failed balance read as unavailable, never as zero", async () => {
    stablesPrices("gbp", { usdc: "111.66" });
    wallets.readWalletHoldings.mockResolvedValue({
      status: "unavailable",
      owner: wallet.publicKey.toBase58(),
      reason: "RPC down",
    });
    const p = await create();
    expect(p.settlement).toMatchObject({ kind: "tentative", holdings: { status: "unavailable" } });
    expect(p.settlement?.reason).toMatch(/couldn't read your wallet/);
  });

  it("refuses an invalid wallet address", async () => {
    stablesPrices("gbp", { usdc: "111.66" });
    await expect(create({ wallet: "not-a-wallet" })).rejects.toMatchObject({
      status: 400,
      code: "invalid_wallet",
    });
  });
});

// ---------------------------------------------------------- the quote gate

describe("readiness before a firm quote", () => {
  it("won't quote a tentative choice in production", async () => {
    await verified();
    stablesPrices("gbp", { usdc: "111.66" });
    const p = await create({ wallet: null });
    expect(p).toMatchObject({ status: "KYC_APPROVED", settlement: { kind: "tentative" } });
    await expect(service.quotePayment(user, p.id)).rejects.toMatchObject({
      status: 409,
      code: "settlement_not_ready",
    });
  });

  it("quotes once the wallet holds the coin", async () => {
    await verified();
    stablesPrices("gbp", { usdc: "111.66" });
    holds({ usdc: "200" });
    const q = await service.quotePayment(user, (await create()).id);
    expect(q.status).toBe("QUOTED");
  });

  it("quotes a tentative choice in the sandbox, and records that the check was skipped", async () => {
    sandbox();
    await verified();
    stablesPrices("gbp", { usdc: "111.66" });
    const p = await create({ wallet: null });
    const q = await service.quotePayment(user, p.id);
    expect(q.status).toBe("QUOTED");
    const quoted = events(p.id).find((e) => e["to_status"] === "QUOTED");
    expect(quoted?.["detail"]).toMatchObject({
      settlement: "tentative",
      readiness_enforced: false,
    });
  });
});

// --------------------------------------------------------------- re-checks

describe("re-checking the settlement", () => {
  it("switches to the coin the wallet now holds, before the quote", async () => {
    stablesPrices("gbp", { usdc: "111.66", usdt: "112.04" });
    holds({});
    const p = await create();
    expect(p.settlement?.kind).toBe("swap_required");

    holds({ usdc: "150" });
    ageEvents();
    const again = await service.recheckSettlement(user, p.id, {});
    expect(again.source.currency).toBe("usdc");
    expect(again.settlement).toMatchObject({ kind: "funds_ready", coin: "usdc" });
    expect(events(p.id).map((e) => e["kind"])).toContain("settlement_changed");
  });

  it("throttles re-checks", async () => {
    stablesPrices("gbp", { usdc: "111.66" });
    holds({ usdc: "200" });
    const p = await create();
    await expect(service.recheckSettlement(user, p.id, {})).rejects.toMatchObject({
      status: 429,
      code: "recheck_too_soon",
    });
  });

  it("is locked once a firm quote exists", async () => {
    await verified();
    stablesPrices("gbp", { usdc: "111.66" });
    holds({ usdc: "200" });
    const q = await service.quotePayment(user, (await create()).id);
    ageEvents();
    await expect(service.recheckSettlement(user, q.id, {})).rejects.toMatchObject({
      status: 409,
      code: "settlement_locked",
    });
  });
});

// ----------------------------------------------------------- the transfer

async function awaitingFunds() {
  await verified();
  stablesPrices("gbp", { usdc: "111.66" });
  holds({ usdc: "200" });
  const q = await service.quotePayment(user, (await create()).id);
  const deposit = newWallet();
  api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
  api.createTransfer.mockResolvedValueOnce(transfer("tr_1", deposit, "150"));
  const t = await service.createPaymentTransfer(user, q.id, {
    purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
    beneficiary: {
      bankName: "Barclays",
      accountNumber: "31926819",
      details: { sort_code: "231470" },
    },
  });
  return { payment: t, deposit };
}

describe("transfer creation", () => {
  it("records the deposit coin and network Stables named", async () => {
    const { payment } = await awaitingFunds();
    expect(payment.deposit).toMatchObject({ currency: "usdc", network: "solana", amount: "150" });
    const row = db.table("payments").find((r) => r["id"] === payment.id)!;
    expect(row).toMatchObject({ deposit_currency: "usdc", deposit_network: "solana" });
  });

  it("keeps Stables' answer and correlation id when creation fails", async () => {
    await verified();
    stablesPrices("gbp", { usdc: "111.66" });
    holds({ usdc: "200" });
    const q = await service.quotePayment(user, (await create()).id);
    api.validatePaymentMethod.mockResolvedValueOnce({ valid: true });
    api.createTransfer.mockRejectedValueOnce(
      new StablesError(
        "Something went wrong while creating the transfer.",
        500,
        [],
        undefined,
        "d39b1358-e405-4f83-83ca-0749b04d7f31",
      ),
    );
    await expect(
      service.createPaymentTransfer(user, q.id, {
        purposeCode: "TRANSFER_TO_OWN_ACCOUNT",
        beneficiary: { bankName: "Barclays", accountNumber: "31926819" },
      }),
    ).rejects.toMatchObject({ status: 502, code: "stables_unavailable" });
    const failed = events(q.id).find((e) => e["kind"] === "transfer_create_failed");
    expect(failed?.["detail"]).toMatchObject({
      status: 500,
      correlation_id: "d39b1358-e405-4f83-83ca-0749b04d7f31",
    });
  });
});

// --------------------------------------------------------------- funding

describe("funding guards", () => {
  function mockBlockhash() {
    rpcMock.mockImplementation(async (_cluster, method) =>
      method === "getLatestBlockhash"
        ? { ok: true, result: { value: { blockhash: newWallet(), lastValidBlockHeight: 100 } } }
        : { ok: false, error: `unexpected ${method}`, status: 500 },
    );
  }

  it("builds the exact deposit when balances cover it", async () => {
    const { payment, deposit } = await awaitingFunds();
    mockBlockhash();
    const built = await service.buildFundingTransaction(
      user,
      payment.id,
      wallet.publicKey.toBase58(),
    );
    expect(built).toMatchObject({ depositAddress: deposit, amount: "150", currency: "usdc" });
  });

  it("refuses when the wallet no longer holds the deposit amount", async () => {
    const { payment } = await awaitingFunds();
    holds({ usdc: "149.999999" });
    await expect(
      service.buildFundingTransaction(user, payment.id, wallet.publicKey.toBase58()),
    ).rejects.toMatchObject({
      status: 409,
      code: "insufficient_balance",
      extra: { held: "149999999", needed: "150000000" },
    });
    expect(events(payment.id).map((e) => e["kind"])).toContain("funding_blocked");
  });

  it("refuses when SOL can't cover the network fees", async () => {
    const { payment } = await awaitingFunds();
    holds({ usdc: "200" }, 1_000_000n);
    await expect(
      service.buildFundingTransaction(user, payment.id, wallet.publicKey.toBase58()),
    ).rejects.toMatchObject({
      status: 409,
      code: "insufficient_sol",
      extra: { solNeeded: "4000000" },
    });
  });

  it("refuses on a failed balance read instead of guessing", async () => {
    const { payment } = await awaitingFunds();
    wallets.readWalletHoldings.mockResolvedValue({
      status: "unavailable",
      owner: "x",
      reason: "down",
    });
    await expect(
      service.buildFundingTransaction(user, payment.id, wallet.publicKey.toBase58()),
    ).rejects.toMatchObject({ status: 503, code: "balance_unavailable" });
  });

  it("sends nothing to a transfer Stables has closed, and catches up", async () => {
    const { payment } = await awaitingFunds();
    api.getTransfer.mockResolvedValueOnce(transfer("tr_1", newWallet(), "150", "expired"));
    await expect(
      service.buildFundingTransaction(user, payment.id, wallet.publicKey.toBase58()),
    ).rejects.toMatchObject({ status: 409, code: "transfer_not_open" });
    expect((await service.getPaymentView(user, payment.id)).status).toBe("EXPIRED");
  });

  it("pays only from the wallet that swapped", async () => {
    const { payment } = await awaitingFunds();
    await db.from("payment_swaps").insert({
      payment_id: payment.id,
      attempt: 1,
      status: "landed",
      taker: newWallet(),
      input_mint: SOL_MINT,
      output_mint: USDC_MINT,
      swap_mode: "ExactIn",
      shortfall_minor: 1,
      in_amount_minor: 1,
      min_out_minor: 1,
      jupiter_request_id: "r1",
      order_transaction: "AA==",
      order_message_sha256: "x",
    });
    await expect(
      service.buildFundingTransaction(user, payment.id, wallet.publicKey.toBase58()),
    ).rejects.toMatchObject({ status: 409, code: "payer_mismatch" });
  });
});

// ------------------------------------------------------------------ swaps

/** A real unsigned v0 transaction with `payer` as fee payer and only signer. */
function orderTransaction(payer: Keypair): string {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

function signed(transaction: string, key: Keypair): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(transaction, "base64"));
  tx.sign([key]);
  return Buffer.from(tx.serialize()).toString("base64");
}

function jupiterOrder(overrides: Partial<JupiterOrder> = {}): JupiterOrder {
  return {
    requestId: `req_${randomUUID()}`,
    inputMint: SOL_MINT,
    outputMint: USDC_MINT,
    swapMode: "ExactIn",
    inAmount: 820_000_000n,
    outAmount: 100_400_000n,
    otherAmountThreshold: 100_100_000n,
    slippageBps: 28,
    priceImpactPct: -0.0005,
    feeBps: 2,
    feeMint: SOL_MINT,
    gasless: false,
    taker: wallet.publicKey.toBase58(),
    transaction: orderTransaction(wallet),
    lastValidBlockHeight: 1_000n,
    router: "metis",
    mode: "ultra",
    routeLabels: ["BisonFi"],
    ...overrides,
  };
}

/** Verified, GBP priced in USDC only, wallet short of 100 USDC but rich in SOL. */
async function needsSwap() {
  await verified();
  stablesPrices("gbp", { usdc: "111.66" });
  holds({ usdc: "50" });
  const p = await create();
  expect(p.settlement).toMatchObject({ kind: "swap_required", coin: "usdc", shortfall: "100" });
  return p;
}

function mockOrders(order = jupiterOrder()) {
  // First the read-only ExactOut sizing quote, then the real order for the taker.
  jup.getOrder
    .mockResolvedValueOnce(
      jupiterOrder({
        swapMode: "ExactOut",
        inAmount: 816_000_000n,
        transaction: null,
        taker: null,
      }),
    )
    .mockResolvedValueOnce(order);
  return order;
}

describe("swaps", () => {
  it("are refused with the Stables sandbox", async () => {
    sandbox();
    const p = await needsSwap();
    await expect(swaps.orderSwap(user, p.id)).rejects.toMatchObject({
      status: 409,
      code: "sandbox_swap_disabled",
    });
  });

  it("order only the shortfall, from the user's own wallet, sized from Stables and the chain", async () => {
    const p = await needsSwap();
    const order = mockOrders();
    const result = await swaps.orderSwap(user, p.id);

    expect(result.transaction).toBe(order.transaction);
    expect(result.swap).toMatchObject({
      status: "ordered",
      inputAsset: "sol",
      outputAsset: "usdc",
    });
    const [sizing, real] = jup.getOrder.mock.calls.map((c) => c[0]);
    expect(sizing).toMatchObject({
      outputMint: USDC_MINT,
      amount: 100_000_000n,
      swapMode: "ExactOut",
    });
    expect(sizing).not.toHaveProperty("taker");
    // 816,000,000 lamports needed, plus the 0.5% buffer, rounded up.
    expect(real).toMatchObject({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: 820_080_000n,
      swapMode: "ExactIn",
      taker: wallet.publicKey.toBase58(),
    });
    const row = db.table("payment_swaps")[0]!;
    expect(row).toMatchObject({ taker: wallet.publicKey.toBase58(), shortfall_minor: 100_000_000 });
    expect(Number(row["min_out_minor"])).toBeGreaterThanOrEqual(100_000_000);
    expect(events(p.id).map((e) => e["kind"])).toContain("swap_ordered");
  });

  it("refuse an order that doesn't guarantee the shortfall", async () => {
    const p = await needsSwap();
    mockOrders(jupiterOrder({ otherAmountThreshold: 99_999_999n }));
    await expect(swaps.orderSwap(user, p.id)).rejects.toMatchObject({
      status: 422,
      code: "swap_not_covered",
    });
    expect(db.table("payment_swaps")).toHaveLength(0);
  });

  it("refuse a gasless order (its transaction id would be unknown until relayed)", async () => {
    const p = await needsSwap();
    mockOrders(jupiterOrder({ gasless: true }));
    await expect(swaps.orderSwap(user, p.id)).rejects.toMatchObject({ code: "needs_sol" });
  });

  it("are not needed once the wallet holds enough", async () => {
    const p = await needsSwap();
    holds({ usdc: "150" });
    await expect(swaps.orderSwap(user, p.id)).rejects.toMatchObject({
      status: 409,
      code: "swap_not_needed",
    });
  });

  it("relay only the exact order the user signed, and only once", async () => {
    const p = await needsSwap();
    const order = mockOrders();
    const { swap } = await swaps.orderSwap(user, p.id);

    // A transaction that isn't the order is never relayed.
    const other = signed(orderTransaction(wallet), wallet);
    await expect(swaps.executeSwap(user, p.id, swap.id, other)).rejects.toMatchObject({
      code: "swap_signature_rejected",
    });
    expect(events(p.id).map((e) => e["kind"])).toContain("wallet_modified_transaction");
    expect(jup.executeOrder).not.toHaveBeenCalled();

    jup.executeOrder.mockResolvedValue({
      status: "Success",
      signature: null,
      code: 0,
      error: null,
      inputAmountResult: null,
      outputAmountResult: null,
    });
    const tx = signed(order.transaction!, wallet);
    const first = await swaps.executeSwap(user, p.id, swap.id, tx);
    expect(first).toMatchObject({ pending: true, swap: { status: "submitted" } });
    const again = await swaps.executeSwap(user, p.id, swap.id, tx);
    expect(again.swap.status).toBe("submitted");
    expect(jup.executeOrder).toHaveBeenCalledTimes(1);

    // And no second swap while this one is in flight.
    await expect(swaps.orderSwap(user, p.id)).rejects.toMatchObject({ code: "swap_in_flight" });
  });

  async function submitted() {
    const p = await needsSwap();
    const order = mockOrders();
    const { swap } = await swaps.orderSwap(user, p.id);
    jup.executeOrder.mockResolvedValue({
      status: "Success",
      signature: null,
      code: 0,
      error: null,
      inputAmountResult: null,
      outputAmountResult: null,
    });
    await swaps.executeSwap(user, p.id, swap.id, signed(order.transaction!, wallet));
    return { p, swap };
  }

  function finalizedSwap(outMinor: bigint) {
    const taker = wallet.publicKey.toBase58();
    return {
      slot: 5,
      blockTime: 1,
      meta: {
        err: null,
        fee: 5_000,
        preBalances: [10 * 1e9],
        postBalances: [10 * 1e9 - 820_085_000],
        preTokenBalances: [
          {
            accountIndex: 1,
            mint: USDC_MINT,
            owner: taker,
            uiTokenAmount: { amount: "50000000", decimals: 6, uiAmount: 50 },
          },
        ],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint: USDC_MINT,
            owner: taker,
            uiTokenAmount: { amount: String(50_000_000n + outMinor), decimals: 6, uiAmount: null },
          },
        ],
      },
      transaction: { message: { accountKeys: [taker], header: { numRequiredSignatures: 1 } } },
    };
  }

  it("land only when the chain shows the guaranteed output, then re-check the payment", async () => {
    const { p, swap } = await submitted();
    rpcMock.mockImplementation(async (_c, method) =>
      method === "getTransaction"
        ? { ok: true, result: finalizedSwap(100_300_000n) }
        : { ok: true, result: 100 },
    );
    holds({ usdc: "150.3" });
    const done = await swaps.confirmSwap(user, p.id, swap.id);
    expect(done).toMatchObject({ pending: false, swap: { status: "landed", actualOut: "100.3" } });
    expect(done.payment.settlement).toMatchObject({ kind: "funds_ready", coin: "usdc" });
  });

  it("fail when less than the guaranteed output arrived", async () => {
    const { p, swap } = await submitted();
    rpcMock.mockImplementation(async (_c, method) =>
      method === "getTransaction"
        ? { ok: true, result: finalizedSwap(90_000_000n) }
        : { ok: true, result: 100 },
    );
    const done = await swaps.confirmSwap(user, p.id, swap.id);
    expect(done.swap).toMatchObject({ status: "failed", actualOut: "90" });
  });

  it("expire only once their blockhash can no longer land", async () => {
    const { p, swap } = await submitted();
    // Still within the blockhash's life: unknown, not failed.
    expect((await swaps.confirmSwap(user, p.id, swap.id)).pending).toBe(true);
    rpcMock.mockImplementation(async (_c, method) =>
      method === "getTransaction" ? { ok: true, result: null } : { ok: true, result: 1_001 },
    );
    const done = await swaps.confirmSwap(user, p.id, swap.id);
    expect(done.swap.status).toBe("expired");
  });
});
