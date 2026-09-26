import { createFileRoute } from "@tanstack/react-router";

import { SOLANA_CLUSTERS, isSolanaCluster, supportsJupiterSwap } from "@/lib/solana-rpc";
import { resolveRpcUrl, rpc } from "@/lib/solana-rpc.server";

function detectProvider(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("alchemy")) return "Alchemy";
  if (lower.includes("quicknode")) return "QuickNode";
  if (lower.includes("helius")) return "Helius";
  return "Custom RPC";
}

/**
 * GET /api/solana/health?cluster=devnet
 *
 * Read-only RPC connectivity check. Never signs or sends a transaction.
 */
export const Route = createFileRoute("/api/solana/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const raw = requestUrl.searchParams.get("cluster") ?? "devnet";
        if (!isSolanaCluster(raw)) {
          return Response.json(
            { error: `cluster must be one of: ${SOLANA_CLUSTERS.join(", ")}` },
            { status: 400 },
          );
        }
        const cluster = raw;
        const started = Date.now();
        const [health, slot, version, blockHeight] = await Promise.all([
          rpc<string>(cluster, "getHealth", []),
          rpc<number>(cluster, "getSlot", [{ commitment: "confirmed" }]),
          rpc<{ "solana-core"?: string }>(cluster, "getVersion", []),
          rpc<number>(cluster, "getBlockHeight", [{ commitment: "confirmed" }]),
        ]);
        const latencyMs = Date.now() - started;
        const { url, custom } = resolveRpcUrl(cluster);
        const endpointProvider = custom ? detectProvider(url) : null;

        const reachable = health.ok && slot.ok;
        return Response.json(
          {
            cluster,
            reachable,
            health: health.ok ? health.result : null,
            slot: slot.ok ? slot.result : null,
            blockHeight: blockHeight.ok ? blockHeight.result : null,
            solanaCore: version.ok ? (version.result?.["solana-core"] ?? null) : null,
            latencyMs,
            customEndpoint: custom,
            endpointProvider,
            jupiterSwapAvailable: supportsJupiterSwap(cluster),
            note: supportsJupiterSwap(cluster)
              ? "Jupiter routing and liquidity exist on this cluster. Swap limits 0.001–0.01 SOL still apply."
              : "Jupiter has no routing or liquidity on this cluster. Use it to verify RPC and transaction verification only.",
            error: reachable ? null : (health.ok ? null : health.error) ?? (slot.ok ? null : slot.error),
          },
          // Always 200: an unreachable cluster is reported in the payload, not as
          // an HTTP error, so the client can render it without an error boundary.
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});