/**
 * The product must contain no fake settlement data: no invented transaction
 * hashes, no mock routing, no hard-coded token prices. This scans the source
 * so a stand-in cannot quietly come back.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const all = files(SRC).map((path) => ({
  path: relative(ROOT, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

/** Code that handles real payments, balances or swaps. */
const MONEY_PATHS = [
  "src/lib/payments/",
  "src/lib/stables/",
  "src/lib/jupiter/",
  "src/routes/api/payments/",
  "src/routes/_authenticated/",
];

const FAKE_SYMBOLS = ["mockSolanaHash", "mockPayoutRef", "buildMockRoutePreview", "MOCK_SOL_USD"];

describe("no fake settlement data in the product", () => {
  it("money-handling code never imports the marketing demo data", () => {
    const offenders = all
      .filter((f) => MONEY_PATHS.some((p) => f.path.startsWith(p)))
      .filter((f) => /from\s+["'][^"']*demo-data["']/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no fake hash, payout reference or mock routing exists anywhere under src/", () => {
    const offenders = all.flatMap((f) =>
      FAKE_SYMBOLS.filter((s) => f.text.includes(s)).map((s) => `${f.path}: ${s}`),
    );
    expect(offenders).toEqual([]);
  });
});
