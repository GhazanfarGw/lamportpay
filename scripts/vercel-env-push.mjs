#!/usr/bin/env node
/**
 * Copy this machine's .env and .env.local into the linked Vercel project, so
 * the deployment gets the same keys as localhost (Stables, Supabase service
 * role, revenue wallet, ...). Values are piped to the Vercel CLI on stdin and
 * never printed; only variable names are shown.
 *
 *   npx vercel login && npx vercel link     # once, in this folder
 *   npm run vercel:env                      # production (default)
 *   npm run vercel:env -- --target preview
 *   npm run vercel:env -- --dry-run         # list what would be sent
 *
 * .env.local wins over .env. Empty values are skipped, and so are values that
 * point at this machine (localhost / 127.0.0.1): a deployment cannot reach them.
 * Existing Vercel values are overwritten (--force). Redeploy afterwards: Vite
 * reads VITE_* variables at build time.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetIndex = args.indexOf("--target");
const target = targetIndex >= 0 ? args[targetIndex + 1] : "production";
if (!["production", "preview", "development"].includes(target)) {
  console.error(`Unknown --target "${target}" (production, preview or development).`);
  process.exit(1);
}

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "").trim();
    out[m[1]] = value;
  }
  return out;
}

const env = { ...parseEnvFile(".env"), ...parseEnvFile(".env.local") };
const names = Object.keys(env).sort();
if (names.length === 0) {
  console.error("No .env or .env.local found in this folder.");
  process.exit(1);
}

const send = [];
const skipped = [];
for (const name of names) {
  const value = env[name];
  if (!value) skipped.push(`${name} (empty)`);
  else if (/\b(localhost|127\.0\.0\.1)\b/i.test(value))
    skipped.push(`${name} (points at localhost)`);
  else send.push(name);
}

console.log(`Target: Vercel ${target}`);
for (const s of skipped) console.log(`  skip  ${s}`);
if (dryRun) {
  for (const name of send) console.log(`  would set  ${name}`);
  process.exit(0);
}

const isWindows = process.platform === "win32";
let failed = 0;
for (const name of send) {
  const r = spawnSync("npx", ["--yes", "vercel", "env", "add", name, target, "--force"], {
    input: env[name],
    stdio: ["pipe", "ignore", "pipe"],
    shell: isWindows,
  });
  if (r.status === 0) {
    console.log(`  set   ${name}`);
  } else {
    failed++;
    const err = (r.stderr?.toString() ?? "").split("\n").find((l) => l.trim()) ?? "unknown error";
    // The CLI's message names the variable, never its value.
    console.log(`  FAIL  ${name}: ${err.trim()}`);
  }
}
console.log(
  failed
    ? `\n${failed} variable(s) failed. Run "npx vercel link" in this folder first if the project is not linked.`
    : `\nDone. Redeploy on Vercel (Deployments → Redeploy) so the new values are used.`,
);
process.exit(failed ? 1 : 0);
