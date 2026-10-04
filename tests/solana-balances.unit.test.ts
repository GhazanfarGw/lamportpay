/**
 * Wallet holdings reader against a mocked mainnet RPC. No network access: every
 * account is a fixture, and a failed read must come back "unavailable", never 0.
 */
import { PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";

vi.mock("@/lib/solana-rpc.server", () => ({
  rpc: vi.fn(),
  // Mirrors the real one: the cluster follows the server's mode.
  activeCluster: () => (process.env["LAMPORTPAY_MODE"] === "live" ? "mainnet-beta" : "devnet"),
}));

import type { rpc as rpcFn } from "@/lib/solana-rpc.server";
import { associatedTokenAddress } from "@/lib/solana-usdc.server";
import { USDC_MINT, USDT_MINT } from "@/lib/tokens";

type Balances = typeof import("@/lib/solana-balances.server");
type RpcAnswer = { ok: true; result: unknown } | { ok: false; error: string; status: number };
type Chain = {
  balance: RpcAnswer;
  /** Accounts by address; a missing entry reads as "no account". */
  accounts: Map<string, unknown>;
  /** Addresses whose getAccountInfo fails. */
  failing: Set<string>;
  rent: RpcAnswer;
};

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const SLOT = 312_004_217;
const RENT = 2_039_280n;
const MARGIN = 2_000_000n;
/** 5,000 per signature (one signer) + 50,000 priority allowance. */
const FUNDING_FEES = 55_000n;
const SWAP_FEES = 50_000n;

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
const OWNER = key(7);
const DEPOSIT_OWNER = key(9);
const STRANGER = key(11);
const ata = (owner: string, mint: string) =>
  associatedTokenAddress(new PublicKey(owner), new PublicKey(mint)).toBase58();

const rpcError = (error = "429 Too Many Requests"): RpcAnswer => ({
  ok: false,
  error,
  status: 502,
});

function tokenAccount(opts: {
  mint: string;
  owner: string;
  amount: string;
  state?: string;
  program?: string;
}) {
  return {
    executable: false,
    lamports: Number(RENT),
    owner: opts.program ?? TOKEN_PROGRAM,
    rentEpoch: 0,
    space: 165,
    data: {
      program: "spl-token",
      space: 165,
      parsed: {
        type: "account",
        info: {
          isNative: false,
          mint: opts.mint,
          owner: opts.owner,
          state: opts.state ?? "initialized",
          // Deliberately wrong float: only the integer `amount` string may be used.
          tokenAmount: {
            amount: opts.amount,
            decimals: 6,
            uiAmount: 999.5,
            uiAmountString: "999.5",
          },
        },
      },
    },
  };
}

const systemAccount = (lamports: number) => ({
  executable: false,
  lamports,
  owner: SYSTEM_PROGRAM,
  rentEpoch: 0,
  space: 0,
  data: ["", "base64"],
});

function newChain(): Chain {
  return {
    balance: { ok: true, result: { context: { slot: SLOT }, value: 1_500_000_000 } },
    accounts: new Map<string, unknown>([
      [ata(OWNER, USDC_MINT), tokenAccount({ mint: USDC_MINT, owner: OWNER, amount: "250000000" })],
      [ata(OWNER, USDT_MINT), tokenAccount({ mint: USDT_MINT, owner: OWNER, amount: "7000000" })],
    ]),
    failing: new Set<string>(),
    rent: { ok: true, result: Number(RENT) },
  };
}

function fakeRpc(chain: Chain) {
  return async (cluster: string, method: string, params: unknown[]): Promise<RpcAnswer> => {
    if (cluster !== "mainnet-beta") throw new Error(`unexpected cluster ${cluster}`);
    if (method === "getBalance") return chain.balance;
    if (method === "getAccountInfo") {
      const address = String(params[0]);
      if (chain.failing.has(address)) return rpcError();
      const value = chain.accounts.get(address) ?? null;
      return { ok: true, result: { context: { slot: SLOT + 1 }, value } };
    }
    if (method === "getMinimumBalanceForRentExemption") return chain.rent;
    throw new Error(`unexpected RPC method ${method}`);
  };
}

let balances: Balances;
let rpcMock: MockedFunction<typeof rpcFn>;
let chain: Chain;
const savedMargin = process.env["SOLANA_FEE_RESERVE_LAMPORTS"];

beforeEach(async () => {
  // These fixtures are mainnet coins: read them as LIVE MODE would.
  vi.stubEnv("LAMPORTPAY_MODE", "live");
  // Fresh modules per test, so the per-process rent cache starts empty.
  vi.resetModules();
  rpcMock = vi.mocked((await import("@/lib/solana-rpc.server")).rpc);
  // resetModules re-imports the code under test but keeps the mock: clear its history.
  rpcMock.mockReset();
  balances = await import("@/lib/solana-balances.server");
  chain = newChain();
  rpcMock.mockImplementation(fakeRpc(chain) as unknown as typeof rpcFn);
  delete process.env["SOLANA_FEE_RESERVE_LAMPORTS"];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  if (savedMargin === undefined) delete process.env["SOLANA_FEE_RESERVE_LAMPORTS"];
  else process.env["SOLANA_FEE_RESERVE_LAMPORTS"] = savedMargin;
});

const methodsCalled = () => rpcMock.mock.calls.map(([, method]) => method);

describe("associatedTokenAddress", () => {
  it("is the standard ATA derivation under the classic Token program", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [
        new PublicKey(OWNER).toBuffer(),
        new PublicKey(TOKEN_PROGRAM).toBuffer(),
        new PublicKey(USDT_MINT).toBuffer(),
      ],
      new PublicKey(ATA_PROGRAM),
    );
    expect(ata(OWNER, USDT_MINT)).toBe(expected.toBase58());
    expect(ata(OWNER, USDC_MINT)).not.toBe(ata(OWNER, USDT_MINT));
  });
});

describe("readWalletHoldings", () => {
  it("reads SOL and both associated token accounts from mainnet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T10:15:00.000Z"));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toEqual({
      status: "ok",
      owner: OWNER,
      slot: SLOT,
      readAt: "2026-09-28T10:15:00.000Z",
      solLamports: 1_500_000_000n,
      tokens: { usdc: 250_000_000n, usdt: 7_000_000n },
    });
    expect(rpcMock).toHaveBeenCalledWith("mainnet-beta", "getBalance", [
      OWNER,
      { commitment: "confirmed" },
    ]);
    for (const mint of [USDC_MINT, USDT_MINT]) {
      expect(rpcMock).toHaveBeenCalledWith("mainnet-beta", "getAccountInfo", [
        ata(OWNER, mint),
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
    }
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it("counts a missing token account as a real zero", async () => {
    chain.accounts.delete(ata(OWNER, USDT_MINT));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toMatchObject({
      status: "ok",
      tokens: { usdc: 250_000_000n, usdt: 0n },
    });
  });

  it("keeps amounts beyond Number precision exact", async () => {
    chain.accounts.set(
      ata(OWNER, USDC_MINT),
      tokenAccount({ mint: USDC_MINT, owner: OWNER, amount: "18446744073709551615" }),
    );

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings.status === "ok" && holdings.tokens.usdc).toBe(18_446_744_073_709_551_615n);
  });

  it.each([
    ["the wrong mint", { mint: USDT_MINT, owner: OWNER }],
    ["another owner", { mint: USDC_MINT, owner: STRANGER }],
    ["a frozen account", { mint: USDC_MINT, owner: OWNER, state: "frozen" }],
    ["an uninitialized account", { mint: USDC_MINT, owner: OWNER, state: "uninitialized" }],
    ["another token program", { mint: USDC_MINT, owner: OWNER, program: TOKEN_2022_PROGRAM }],
  ])("gives 0 for a USDC account with %s (it cannot be spent)", async (_label, fields) => {
    chain.accounts.set(ata(OWNER, USDC_MINT), tokenAccount({ amount: "500000000", ...fields }));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toMatchObject({ status: "ok", tokens: { usdc: 0n, usdt: 7_000_000n } });
  });

  it("gives 0 when the address holds only lamports, not a token account", async () => {
    chain.accounts.set(ata(OWNER, USDC_MINT), systemAccount(1_000_000));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toMatchObject({ status: "ok", tokens: { usdc: 0n } });
  });

  it("is unavailable, not zero, when the SOL read fails", async () => {
    chain.balance = rpcError("RPC request failed (503).");

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toEqual({
      status: "unavailable",
      owner: OWNER,
      reason: "SOL balance read failed: RPC request failed (503).",
    });
    expect(holdings).not.toHaveProperty("tokens");
  });

  it("is unavailable when any token read fails, never a partial result", async () => {
    chain.failing.add(ata(OWNER, USDT_MINT));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toEqual({
      status: "unavailable",
      owner: OWNER,
      reason: "USDT balance read failed: 429 Too Many Requests",
    });
  });

  it("lists every failed read in the reason", async () => {
    chain.balance = rpcError("timeout");
    chain.failing.add(ata(OWNER, USDC_MINT));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings.status).toBe("unavailable");
    expect(holdings.status === "unavailable" && holdings.reason).toBe(
      "SOL balance read failed: timeout; USDC balance read failed: 429 Too Many Requests",
    );
  });

  it.each([
    ["a string lamport count", { context: { slot: SLOT }, value: "1500000000" }],
    ["a negative lamport count", { context: { slot: SLOT }, value: -1 }],
    ["a fractional lamport count", { context: { slot: SLOT }, value: 1.5 }],
    ["no value", { context: { slot: SLOT } }],
    ["a null result", null],
  ])("is unavailable when getBalance returns %s", async (_label, result) => {
    chain.balance = { ok: true, result };

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toEqual({
      status: "unavailable",
      owner: OWNER,
      reason: "SOL balance read returned a malformed result.",
    });
  });

  it.each([
    ["a decimal amount", "1.5"],
    ["an empty amount", ""],
    ["a negative amount", "-5"],
  ])("is unavailable when a token account has %s", async (_label, amount) => {
    chain.accounts.set(
      ata(OWNER, USDC_MINT),
      tokenAccount({ mint: USDC_MINT, owner: OWNER, amount }),
    );

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toEqual({
      status: "unavailable",
      owner: OWNER,
      reason: "USDC balance read returned a malformed result.",
    });
  });

  it("is unavailable when getAccountInfo answers without a value field", async () => {
    rpcMock.mockImplementation((async (cluster: string, method: string, params: unknown[]) =>
      method === "getAccountInfo"
        ? { ok: true, result: { context: { slot: SLOT } } }
        : fakeRpc(chain)(cluster, method, params)) as unknown as typeof rpcFn);

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings.status).toBe("unavailable");
  });

  it("is unavailable when the RPC helper throws", async () => {
    rpcMock.mockRejectedValue(new Error("socket hang up"));

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toMatchObject({ status: "unavailable", owner: OWNER });
    expect(holdings.status === "unavailable" && holdings.reason).toContain("socket hang up");
  });

  it.each(["", "not-a-wallet", "0OIl0OIl", `${OWNER}x`, "abc"])(
    "refuses the invalid address %j without calling the RPC",
    async (owner) => {
      const holdings = await balances.readWalletHoldings(owner);

      expect(holdings).toEqual({ status: "unavailable", owner, reason: "invalid address" });
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("captures the slot of the SOL read", async () => {
    chain.balance = { ok: true, result: { context: { slot: 400_000_123 }, value: 0 } };

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toMatchObject({ status: "ok", slot: 400_000_123, solLamports: 0n });
  });

  it("reports a null slot when the RPC gives no context", async () => {
    chain.balance = { ok: true, result: { value: 42 } };

    const holdings = await balances.readWalletHoldings(OWNER);

    expect(holdings).toMatchObject({ status: "ok", slot: null, solLamports: 42n });
  });
});

describe("accountExists", () => {
  it("is true for an existing account and false for none", async () => {
    chain.accounts.set(DEPOSIT_OWNER, systemAccount(5_000));

    expect(await balances.accountExists(DEPOSIT_OWNER)).toBe(true);
    expect(await balances.accountExists(STRANGER)).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("mainnet-beta", "getAccountInfo", [
      DEPOSIT_OWNER,
      { encoding: "base64", dataSlice: { offset: 0, length: 0 }, commitment: "confirmed" },
    ]);
  });

  it("is 'unavailable' when the read fails or the address is invalid", async () => {
    chain.failing.add(DEPOSIT_OWNER);

    expect(await balances.accountExists(DEPOSIT_OWNER)).toBe("unavailable");
    expect(await balances.accountExists("nope")).toBe("unavailable");
  });
});

describe("tokenAccountRentLamports", () => {
  it("reads the 165-byte rent minimum once per process", async () => {
    expect(await balances.tokenAccountRentLamports()).toBe(RENT);
    expect(await balances.tokenAccountRentLamports()).toBe(RENT);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("mainnet-beta", "getMinimumBalanceForRentExemption", [
      165,
      { commitment: "confirmed" },
    ]);
  });

  it("returns null on a failed read and does not cache the failure", async () => {
    chain.rent = rpcError();
    expect(await balances.tokenAccountRentLamports()).toBeNull();

    chain.rent = { ok: true, result: Number(RENT) };
    expect(await balances.tokenAccountRentLamports()).toBe(RENT);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["zero", 0],
    ["a string", "2039280"],
    ["null", null],
  ])("returns null when the RPC answers %s", async (_label, result) => {
    chain.rent = { ok: true, result };

    expect(await balances.tokenAccountRentLamports()).toBeNull();
  });
});

describe("solReserveLamports", () => {
  it("covers the funding fee and the margin when nothing needs rent", async () => {
    expect(await balances.solReserveLamports({ payer: OWNER })).toBe(FUNDING_FEES + MARGIN);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("adds no rent when the deposit token account already exists", async () => {
    chain.accounts.set(
      ata(DEPOSIT_OWNER, USDC_MINT),
      tokenAccount({ mint: USDC_MINT, owner: DEPOSIT_OWNER, amount: "0" }),
    );

    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      depositOwner: DEPOSIT_OWNER,
      mint: USDC_MINT,
    });

    expect(reserve).toBe(FUNDING_FEES + MARGIN);
    expect(methodsCalled()).toEqual(["getAccountInfo"]);
    expect(rpcMock.mock.calls[0]![2]![0]).toBe(ata(DEPOSIT_OWNER, USDC_MINT));
  });

  it("adds rent when the deposit token account is missing", async () => {
    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      depositOwner: DEPOSIT_OWNER,
      mint: USDT_MINT,
    });

    expect(reserve).toBe(FUNDING_FEES + RENT + MARGIN);
  });

  it("adds rent when the deposit address only holds pre-sent lamports", async () => {
    chain.accounts.set(ata(DEPOSIT_OWNER, USDC_MINT), systemAccount(890_880));

    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      depositOwner: DEPOSIT_OWNER,
      mint: USDC_MINT,
    });

    expect(reserve).toBe(FUNDING_FEES + RENT + MARGIN);
  });

  it("ignores a deposit owner given without a mint", async () => {
    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      depositOwner: DEPOSIT_OWNER,
      mint: null,
    });

    expect(reserve).toBe(FUNDING_FEES + MARGIN);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("adds swap fees, output-account rent and wrapped-SOL rent for a SOL swap", async () => {
    chain.accounts.delete(ata(OWNER, USDC_MINT));

    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      depositOwner: DEPOSIT_OWNER,
      mint: USDC_MINT,
      swap: { outputMint: USDC_MINT, inputIsSol: true },
    });

    // Deposit account, payer's USDC account and the temporary wSOL account.
    expect(reserve).toBe(FUNDING_FEES + SWAP_FEES + 3n * RENT + MARGIN);
  });

  it("adds only wrapped-SOL rent when the payer's output account exists", async () => {
    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      swap: { outputMint: USDC_MINT, inputIsSol: true },
    });

    expect(reserve).toBe(FUNDING_FEES + SWAP_FEES + RENT + MARGIN);
    expect(rpcMock.mock.calls[0]![2]![0]).toBe(ata(OWNER, USDC_MINT));
  });

  it("adds no rent for a stablecoin swap into an existing account", async () => {
    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      swap: { outputMint: USDT_MINT, inputIsSol: false },
    });

    expect(reserve).toBe(FUNDING_FEES + SWAP_FEES + MARGIN);
    expect(methodsCalled()).toEqual(["getAccountInfo"]);
  });

  it("is 'unavailable' when the deposit account read fails", async () => {
    chain.failing.add(ata(DEPOSIT_OWNER, USDC_MINT));

    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      depositOwner: DEPOSIT_OWNER,
      mint: USDC_MINT,
    });

    expect(reserve).toBe("unavailable");
  });

  it("is 'unavailable' when needed rent cannot be read", async () => {
    chain.rent = rpcError();

    const reserve = await balances.solReserveLamports({
      payer: OWNER,
      swap: { outputMint: USDC_MINT, inputIsSol: true },
    });

    expect(reserve).toBe("unavailable");
  });

  it("is 'unavailable' for an invalid payer, deposit owner or output mint", async () => {
    expect(await balances.solReserveLamports({ payer: "bad" })).toBe("unavailable");
    expect(
      await balances.solReserveLamports({ payer: OWNER, depositOwner: "bad", mint: USDC_MINT }),
    ).toBe("unavailable");
    expect(
      await balances.solReserveLamports({
        payer: OWNER,
        swap: { outputMint: "bad", inputIsSol: false },
      }),
    ).toBe("unavailable");
  });

  it("uses the configured margin", async () => {
    process.env["SOLANA_FEE_RESERVE_LAMPORTS"] = "5000000";

    expect(await balances.solReserveLamports({ payer: OWNER })).toBe(FUNDING_FEES + 5_000_000n);
  });

  it("throws on an invalid margin before reading the chain", async () => {
    process.env["SOLANA_FEE_RESERVE_LAMPORTS"] = "0.002";

    await expect(
      balances.solReserveLamports({ payer: OWNER, depositOwner: DEPOSIT_OWNER, mint: USDC_MINT }),
    ).rejects.toThrow(/SOLANA_FEE_RESERVE_LAMPORTS/);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("solFeeReserveMarginLamports", () => {
  it("defaults to 0.002 SOL when unset or blank", () => {
    expect(balances.solFeeReserveMarginLamports()).toBe(MARGIN);
    process.env["SOLANA_FEE_RESERVE_LAMPORTS"] = "  ";
    expect(balances.solFeeReserveMarginLamports()).toBe(MARGIN);
  });

  it.each([
    ["5000000", 5_000_000n],
    [" 3000000 ", 3_000_000n],
    ["0", 0n],
  ])("reads %j as lamports", (raw, expected) => {
    process.env["SOLANA_FEE_RESERVE_LAMPORTS"] = raw;

    expect(balances.solFeeReserveMarginLamports()).toBe(expected);
  });

  it.each(["0.002", "-1", "2e6", "abc", "1_000", "2000000 lamports"])(
    "throws a clear error for %j",
    (raw) => {
      process.env["SOLANA_FEE_RESERVE_LAMPORTS"] = raw;

      expect(() => balances.solFeeReserveMarginLamports()).toThrow(
        `SOLANA_FEE_RESERVE_LAMPORTS must be a whole number of lamports (2000000 is 0.002 SOL), not ${JSON.stringify(raw)}.`,
      );
    },
  );
});

describe("TEST MODE holdings", () => {
  it("reads devnet test USDC on devnet, never mainnet coins, and has no devnet USDT", async () => {
    vi.stubEnv("LAMPORTPAY_MODE", "test");
    const { DEVNET_USDC_MINT } = await import("@/lib/app-mode");
    const seen: string[] = [];
    rpcMock.mockImplementation((async (cluster: string, method: string, params: unknown[]) => {
      seen.push(cluster);
      if (method === "getBalance") return chain.balance;
      const address = String(params[0]);
      if (address === ata(OWNER, DEVNET_USDC_MINT)) {
        return {
          ok: true,
          result: {
            context: { slot: SLOT },
            value: tokenAccount({ mint: DEVNET_USDC_MINT, owner: OWNER, amount: "5000000" }),
          },
        };
      }
      if (address === ata(OWNER, USDC_MINT) || address === ata(OWNER, USDT_MINT)) {
        throw new Error("mainnet coin read in TEST MODE");
      }
      return { ok: true, result: { context: { slot: SLOT }, value: null } };
    }) as unknown as typeof rpcFn);

    const holdings = await balances.readWalletHoldings(OWNER);
    expect(holdings).toMatchObject({ status: "ok", tokens: { usdc: 5_000_000n, usdt: 0n } });
    expect(new Set(seen)).toEqual(new Set(["devnet"]));
  });
});
