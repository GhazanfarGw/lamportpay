/**
 * The browser Buffer must be complete enough for @solana/web3.js to serialize
 * transactions (3 Oct 2026: a minimal shim broke every wallet signature with
 * "Buffer.from(...).copy is not a function").
 */
import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { Buffer, hasFullBuffer } from "@/lib/buffer-polyfill";
import { MEMO_PROGRAM_ID, testPaymentMemo } from "@/lib/payments/test-payment";

describe("browser Buffer polyfill", () => {
  it("provides the full Buffer API web3.js needs", () => {
    expect(hasFullBuffer).toBe(true);
    const b = Buffer.from([1, 2, 3]) as unknown as {
      copy: unknown;
      writeUIntLE: unknown;
      readUInt32LE: unknown;
    };
    expect(typeof b.copy).toBe("function");
    expect(typeof b.writeUIntLE).toBe("function");
    expect(typeof b.readUInt32LE).toBe("function");
  });

  it("serializes the TEST MODE memo transaction (v0 and legacy)", () => {
    const payer = Keypair.generate();
    const ix = new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM_ID),
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
      data: new TextEncoder().encode(testPaymentMemo("p1")) as never,
    });
    const blockhash = Keypair.generate().publicKey.toBase58();
    const v0 = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message(),
    );
    v0.sign([payer]);
    expect(v0.serialize().length).toBeGreaterThan(64);
    const legacy = new Transaction().add(ix);
    legacy.recentBlockhash = blockhash;
    legacy.feePayer = payer.publicKey;
    legacy.sign(payer);
    expect(legacy.serialize().length).toBeGreaterThan(64);
  });
});
