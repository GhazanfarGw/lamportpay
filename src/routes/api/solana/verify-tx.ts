import { createFileRoute } from "@tanstack/react-router";

import { SOL_MINT, USDC_MINT } from "@/lib/tokens";
import {
  SOLANA_CLUSTERS,
  explorerTxUrl,
  isLikelySignature,
  isSolanaCluster,
} from "@/lib/solana-rpc";
import { rpc } from "@/lib/solana-rpc.server";

const FORBIDDEN_FIELDS = [
  "privateKey",
  "private_key",
  "secretKey",
  "secret_key",
  "seed",
  "seedPhrase",
  "seed_phrase",
  "mnemonic",
  "keypair",
];

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null };
};

type TxResult = {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction: { message: { accountKeys: unknown[] } };
} | null;

function tokenDelta(
  pre: TokenBalance[] | undefined,
  post: TokenBalance[] | undefined,
  mint: string,
  owner?: string,
) {
  const sum = (list: TokenBalance[] | undefined) =>
    (list ?? [])
      .filter((b) => b.mint === mint && (!owner || b.owner === owner))
      .reduce((acc, b) => acc + Number(b.uiTokenAmount.amount || "0"), 0);
  return sum(post) - sum(pre);
}

/**
 * POST /api/solana/verify-tx
 * Body: { signature, cluster?, owner? }
 *
 * Read-only on-chain verification of an already-broadcast transaction.
 * Never accepts key material and never sends or signs anything.
 */
export const Route = createFileRoute("/api/solana/verify-tx")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }

        const present = FORBIDDEN_FIELDS.filter((f) => f in body);
        if (present.length > 0) {
          return Response.json(
            {
              error:
                "This endpoint never accepts private keys, secret keys, or seed phrases. Remove them and retry.",
            },
            { status: 400 },
          );
        }

        const signature = typeof body["signature"] === "string" ? body["signature"].trim() : "";
        if (!isLikelySignature(signature)) {
          return Response.json({ error: "Provide a valid base58 transaction signature." }, { status: 400 });
        }

        const rawCluster = body["cluster"] ?? "devnet";
        if (!isSolanaCluster(rawCluster)) {
          return Response.json(
            { error: `cluster must be one of: ${SOLANA_CLUSTERS.join(", ")}` },
            { status: 400 },
          );
        }
        const cluster = rawCluster;
        const owner = typeof body["owner"] === "string" ? body["owner"] : undefined;

        const statuses = await rpc<{ value: Array<null | { confirmationStatus: string | null; confirmations: number | null; err: unknown }> }>(
          cluster,
          "getSignatureStatuses",
          [[signature], { searchTransactionHistory: true }],
        );
        if (!statuses.ok) {
          return Response.json({ error: statuses.error, cluster }, { status: statuses.status });
        }
        const status = statuses.result?.value?.[0] ?? null;

        const tx = await rpc<TxResult>(cluster, "getTransaction", [
          signature,
          { maxSupportedTransactionVersion: 0, commitment: "confirmed", encoding: "json" },
        ]);

        if (!status && (!tx.ok || !tx.result)) {
          return Response.json(
            {
              cluster,
              signature,
              found: false,
              explorerUrl: explorerTxUrl(signature, cluster),
              error: "Transaction not found on this cluster. Check the signature and the cluster.",
            },
            { status: 404, headers: { "Cache-Control": "no-store" } },
          );
        }

        const meta = tx.ok && tx.result ? tx.result.meta : null;
        const usdcDelta = meta
          ? tokenDelta(meta.preTokenBalances, meta.postTokenBalances, USDC_MINT, owner)
          : 0;
        const solDelta =
          meta && meta.preBalances.length > 0 ? meta.postBalances[0]! - meta.preBalances[0]! : 0;

        const err = status?.err ?? meta?.err ?? null;
        return Response.json(
          {
            cluster,
            signature,
            found: true,
            success: err == null,
            error: err ? "Transaction failed on-chain." : null,
            onChainError: err ?? null,
            confirmationStatus: status?.confirmationStatus ?? null,
            confirmations: status?.confirmations ?? null,
            slot: tx.ok && tx.result ? tx.result.slot : null,
            blockTime: tx.ok && tx.result ? tx.result.blockTime : null,
            feeLamports: meta?.fee ?? null,
            inputMint: SOL_MINT,
            outputMint: USDC_MINT,
            solLamportsDelta: solDelta,
            usdcRawDelta: usdcDelta,
            usdcUiDelta: usdcDelta / 1_000_000,
            outputToOwner: owner ?? null,
            explorerUrl: explorerTxUrl(signature, cluster),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});