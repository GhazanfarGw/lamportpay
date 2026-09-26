import {
  DEFAULT_RPC_URLS,
  type SolanaCluster,
} from "./solana-rpc";

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

export async function rpc<T>(
  cluster: SolanaCluster,
  method: string,
  params: unknown[],
): Promise<{ ok: true; result: T } | { ok: false; error: string; status: number }> {
  const { url, custom } = resolveRpcUrl(cluster);
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