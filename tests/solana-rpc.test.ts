import { describe, expect, it } from "vitest";

import { api } from "./helpers";

describe("solana rpc health", () => {
  it("rejects unknown clusters", async () => {
    const res = await api("/api/solana/health?cluster=fakenet");
    expect(res.status).toBe(400);
  });

  for (const cluster of ["devnet", "testnet", "mainnet-beta"]) {
    it(`reports connectivity for ${cluster}`, async () => {
      const res = await api<{
        cluster: string;
        reachable: boolean;
        slot: number | null;
        jupiterSwapAvailable: boolean;
        customEndpoint: boolean;
        endpointProvider: string | null;
      }>(`/api/solana/health?cluster=${cluster}`);
      expect(res.status).toBe(200);
      expect(res.body.cluster).toBe(cluster);
      expect(res.body.jupiterSwapAvailable).toBe(cluster === "mainnet-beta");
      expect(res.body.customEndpoint).toBe(true);
      expect(res.body.endpointProvider).toBe("Alchemy");
      if (res.status === 200) {
        expect(res.body.reachable).toBe(true);
        expect(typeof res.body.slot).toBe("number");
      }
    });
  }

  it("never leaks secrets", async () => {
    const res = await api("/api/solana/health?cluster=devnet");
    expect(res.raw).not.toMatch(/jup_[a-f0-9]/i);
    expect(res.raw.toLowerCase()).not.toContain("api_key");
  });
});

describe("solana transaction verification", () => {
  it("rejects an invalid signature", async () => {
    const res = await api("/api/solana/verify-tx", {
      method: "POST",
      body: { signature: "abc", cluster: "devnet" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects key material", async () => {
    const res = await api<{ error: string }>("/api/solana/verify-tx", {
      method: "POST",
      body: {
        signature: "1".repeat(88),
        cluster: "devnet",
        seedPhrase: "test test test",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/never accepts/i);
  });

  it("rejects unknown clusters", async () => {
    const res = await api("/api/solana/verify-tx", {
      method: "POST",
      body: { signature: "1".repeat(88), cluster: "fakenet" },
    });
    expect(res.status).toBe(400);
  });

  it("returns not found for an unknown signature", async () => {
    const res = await api<{ found: boolean; explorerUrl: string }>("/api/solana/verify-tx", {
      method: "POST",
      body: { signature: "2".repeat(88), cluster: "devnet" },
    });
    expect([404, 502]).toContain(res.status);
    if (res.status === 404) {
      expect(res.body.found).toBe(false);
      expect(res.body.explorerUrl).toContain("cluster=devnet");
    }
  });
});