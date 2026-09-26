/**
 * Stablecoins (USDC, USDT) on Solana mainnet: build an unsigned transfer to a
 * deposit address and verify on-chain that a deposit arrived. The server never
 * holds keys; the user's wallet signs and sends. Both mints use the classic SPL
 * Token program and 6 decimals.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { toMajor } from "./money";
import { getTokenInfo, USDC_MINT } from "./tokens";
import { rpc } from "./solana-rpc.server";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function stablecoin(mint: string) {
  const info = getTokenInfo(mint);
  if (!info || info.decimals !== 6) throw new Error(`Unsupported payment mint ${mint}.`);
  return { key: new PublicKey(mint), symbol: info.symbol, decimals: info.decimals };
}

export type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null };
};

export type TxMeta = {
  err: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
};

export type TxResult = {
  slot: number;
  blockTime: number | null;
  meta: TxMeta | null;
  transaction: {
    message: { accountKeys: unknown[]; header?: { numRequiredSignatures: number } };
  };
} | null;

/** Net change in raw token units held by `owner` (all owners if omitted) for `mint`. */
export function tokenDelta(
  pre: TokenBalance[] | undefined,
  post: TokenBalance[] | undefined,
  mint: string,
  owner?: string,
): bigint {
  const sum = (list: TokenBalance[] | undefined) =>
    (list ?? [])
      .filter((b) => b.mint === mint && (!owner || b.owner === owner))
      .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount || "0"), 0n);
  return sum(post) - sum(pre);
}

export function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function tokenAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Unsigned transaction sending exactly `amountMinor` of `mint` (USDC by
 * default, or USDT) from `payer` to `recipient`'s token account, creating that
 * account if needed (payer covers the rent). Returns base64 for the wallet to
 * sign and send.
 */
export async function buildUsdcTransferTransaction(input: {
  payer: string;
  recipient: string;
  amountMinor: bigint;
  mint?: string;
}): Promise<{ transaction: string; lastValidBlockHeight: number }> {
  const token = stablecoin(input.mint ?? USDC_MINT);
  const payer = new PublicKey(input.payer);
  const recipient = new PublicKey(input.recipient);
  const source = tokenAta(payer, token.key);
  const destination = tokenAta(recipient, token.key);

  const blockhash = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
    "mainnet-beta",
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
  );
  if (!blockhash.ok) throw new Error(blockhash.error);

  const createDestination = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: token.key, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });

  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0); // TransferChecked
  data.writeBigUInt64LE(input.amountMinor, 1);
  data.writeUInt8(token.decimals, 9);
  const transfer = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: token.key, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction({
    feePayer: payer,
    blockhash: blockhash.result.value.blockhash,
    lastValidBlockHeight: blockhash.result.value.lastValidBlockHeight,
  }).add(createDestination, transfer);

  return {
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    lastValidBlockHeight: blockhash.result.value.lastValidBlockHeight,
  };
}

export type DepositVerification =
  | { status: "pending" }
  /**
   * `receivedMinor` is what the deposit address actually got in this
   * transaction (0 when nothing moved): a positive value means funds reached
   * Stables even though the deposit does not match.
   */
  | { status: "failed"; reason: string; receivedMinor: bigint }
  | {
      status: "verified";
      receivedMinor: bigint;
      payer: string;
      slot: number;
      blockTime: number | null;
    };

/** Accounts that signed the transaction (the first `numRequiredSignatures` keys). */
function signersOf(tx: NonNullable<TxResult>): string[] {
  const { accountKeys, header } = tx.transaction.message;
  const count = header?.numRequiredSignatures ?? 0;
  return accountKeys
    .slice(0, count)
    .map((k) => (typeof k === "string" ? k : String((k as { pubkey?: unknown }).pubkey ?? "")));
}

/**
 * Check on mainnet, at `finalized` commitment, that `signature` is a
 * successful transaction in which `payer` signed and sent exactly
 * `expectedMinor` of `mint` (USDC by default, or USDT) and `depositOwner`
 * received exactly that amount. "pending" means the transaction is not
 * finalized yet.
 */
export async function verifyUsdcDeposit(input: {
  signature: string;
  depositOwner: string;
  payer: string;
  expectedMinor: bigint;
  mint?: string;
}): Promise<DepositVerification> {
  const mint = input.mint ?? USDC_MINT;
  const { symbol } = stablecoin(mint);
  const tx = await rpc<TxResult>("mainnet-beta", "getTransaction", [
    input.signature,
    { maxSupportedTransactionVersion: 0, commitment: "finalized", encoding: "json" },
  ]);
  if (!tx.ok) throw new Error(tx.error);
  if (!tx.result) return { status: "pending" };

  const meta = tx.result.meta;
  if (!meta) {
    return { status: "failed", reason: "Transaction metadata is unavailable.", receivedMinor: 0n };
  }
  if (meta.err != null) {
    return { status: "failed", reason: "Transaction failed on-chain.", receivedMinor: 0n };
  }

  const delta = (owner: string) =>
    tokenDelta(meta.preTokenBalances, meta.postTokenBalances, mint, owner);
  const units = (minor: bigint) => `${toMajor(minor, "usdc")} ${symbol}`;

  const received = delta(input.depositOwner);
  if (received !== input.expectedMinor) {
    return {
      status: "failed",
      reason: `The deposit address received ${units(received)} in this transaction; exactly ${units(input.expectedMinor)} is required.`,
      receivedMinor: received > 0n ? received : 0n,
    };
  }

  if (!signersOf(tx.result).includes(input.payer)) {
    return {
      status: "failed",
      reason: "This transaction was not signed by your wallet.",
      receivedMinor: received,
    };
  }
  const sent = -delta(input.payer);
  if (sent !== input.expectedMinor) {
    return {
      status: "failed",
      reason: `Your wallet sent ${units(sent)} in this transaction; exactly ${units(input.expectedMinor)} is required.`,
      receivedMinor: received,
    };
  }

  return {
    status: "verified",
    receivedMinor: received,
    payer: input.payer,
    slot: tx.result.slot,
    blockTime: tx.result.blockTime,
  };
}
