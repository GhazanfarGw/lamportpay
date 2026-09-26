/**
 * USDC on Solana mainnet: build an unsigned transfer to a deposit address and
 * verify on-chain that a deposit arrived. The server never holds keys; the
 * user's wallet signs and sends.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { USDC_MINT } from "./tokens";
import { rpc } from "./solana-rpc.server";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const USDC = new PublicKey(USDC_MINT);
const USDC_DECIMALS = 6;

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

function usdcAta(owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/**
 * Unsigned transaction sending exactly `amountMinor` USDC from `payer` to
 * `recipient`'s USDC account, creating that account if needed (payer covers
 * the rent). Returns base64 for the wallet to sign and send.
 */
export async function buildUsdcTransferTransaction(input: {
  payer: string;
  recipient: string;
  amountMinor: bigint;
}): Promise<{ transaction: string; lastValidBlockHeight: number }> {
  const payer = new PublicKey(input.payer);
  const recipient = new PublicKey(input.recipient);
  const source = usdcAta(payer);
  const destination = usdcAta(recipient);

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
      { pubkey: USDC, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });

  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0); // TransferChecked
  data.writeBigUInt64LE(input.amountMinor, 1);
  data.writeUInt8(USDC_DECIMALS, 9);
  const transfer = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: USDC, isSigner: false, isWritable: false },
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
  | { status: "failed"; reason: string }
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
 * `expectedMinor` USDC (by mint) and `depositOwner` received exactly that
 * amount. "pending" means the transaction is not finalized yet.
 */
export async function verifyUsdcDeposit(input: {
  signature: string;
  depositOwner: string;
  payer: string;
  expectedMinor: bigint;
}): Promise<DepositVerification> {
  const tx = await rpc<TxResult>("mainnet-beta", "getTransaction", [
    input.signature,
    { maxSupportedTransactionVersion: 0, commitment: "finalized", encoding: "json" },
  ]);
  if (!tx.ok) throw new Error(tx.error);
  if (!tx.result) return { status: "pending" };

  const meta = tx.result.meta;
  if (!meta) return { status: "failed", reason: "Transaction metadata is unavailable." };
  if (meta.err != null) return { status: "failed", reason: "Transaction failed on-chain." };

  const delta = (owner: string) =>
    tokenDelta(meta.preTokenBalances, meta.postTokenBalances, USDC_MINT, owner);

  const received = delta(input.depositOwner);
  if (received !== input.expectedMinor) {
    return {
      status: "failed",
      reason: `The deposit address received ${received} USDC base units in this transaction; exactly ${input.expectedMinor} are required.`,
    };
  }

  if (!signersOf(tx.result).includes(input.payer)) {
    return { status: "failed", reason: "This transaction was not signed by your wallet." };
  }
  const sent = -delta(input.payer);
  if (sent !== input.expectedMinor) {
    return {
      status: "failed",
      reason: `Your wallet sent ${sent} USDC base units in this transaction; exactly ${input.expectedMinor} are required.`,
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
