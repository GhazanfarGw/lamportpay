import { MODE_PROFILES } from "./app-mode";
import { currentMode, endpointAllowed } from "./app-mode.server";
import { DEFAULT_RPC_URLS, type SolanaCluster } from "./solana-rpc";

/** Resolve the RPC endpoint for a cluster; a custom SOLANA_RPC_URL wins for mainnet. */
export function resolveRpcUrl(cluster: SolanaCluster): { url: string; custom: boolean } {
  const custom = process.env["SOLANA_RPC_URL"];
  if (custom && cluster === "mainnet-beta") return { url: custom, custom: true };
  const devnetCustom = process.env["SOLANA_DEVNET_RPC_URL"];
  if (devnetCustom && cluster === "devnet") return { url: devnetCustom, custom: true };
  const testnetCustom = process.env["SOLANA_TESTNET_RPC_URL"];
  if (testnetCustom && cluster === "testnet") return { url: testnetCustom, custom: true };
  return { url: DEFAULT_RPC_URLS[cluster], custom: false };
}

/** The Solana cluster of the server's mode (TEST: devnet, LIVE: mainnet-beta). */
export function activeCluster(): SolanaCluster {
  return MODE_PROFILES[currentMode().mode].solanaCluster;
}

export async function rpc<T>(
  cluster: SolanaCluster,
  method: string,
  params: unknown[],
): Promise<{ ok: true; result: T } | { ok: false; error: string; status: number }> {
  const { url, custom } = resolveRpcUrl(cluster);
  // TEST MODE never reaches mainnet; LIVE MODE never reaches a test cluster.
  const mode = currentMode().mode;
  if (cluster !== MODE_PROFILES[mode].solanaCluster) {
    const reason = `${mode === "test" ? "TEST" : "LIVE"} MODE: the ${cluster} cluster is blocked.`;
    console.error("[mode] RPC refused:", reason);
    return { ok: false, error: reason, status: 403 };
  }
  const primary = endpointAllowed(mode, "solana_rpc", url);
  const fallback = endpointAllowed(mode, "solana_rpc", DEFAULT_RPC_URLS[cluster]);
  if (!primary.ok || !fallback.ok) {
    const reason = !primary.ok ? primary.reason : (fallback as { reason: string }).reason;
    console.error("[mode] RPC refused:", cluster, reason);
    return { ok: false, error: reason, status: 403 };
  }
  const attempt = await rpcAt<T>(url, cluster, method, params);
  // A misconfigured or unreachable custom endpoint should not break the cluster
  // check — retry once on the public endpoint.
  if (!attempt.ok && custom && url !== DEFAULT_RPC_URLS[cluster]) {
    return rpcAt<T>(DEFAULT_RPC_URLS[cluster], cluster, method, params);
  }
  return attempt;
}

async function rpcAt<T>(
  url: string,
  cluster: SolanaCluster,
  method: string,
  params: unknown[],
): Promise<{ ok: true; result: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await res.text();
    let json: { result?: T; error?: { message?: string } } | null = null;
    try {
      json = JSON.parse(text) as { result?: T; error?: { message?: string } };
    } catch {
      return { ok: false, error: `Invalid RPC response from ${cluster}.`, status: 502 };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: json?.error?.message ?? `RPC request failed (${res.status}).`,
        status: 502,
      };
    }
    if (json?.error) return { ok: false, error: json.error.message ?? "RPC error.", status: 502 };
    return { ok: true, result: json?.result as T };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : `Could not reach the ${cluster} RPC endpoint.`,
      status: 502,
    };
  }
}
