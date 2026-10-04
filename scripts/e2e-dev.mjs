// Usage (dev only): node --env-file=.env scripts/e2e-dev.mjs tests/payments.test.ts ...
// Mints a short-lived session for the dev E2E test user (dev project only) and runs the
// end-to-end tests against a local dev server. The token is never printed.
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const url = process.env.SUPABASE_URL;
if (!url || !url.includes("gdksfksypkcfiohozzsx")) throw new Error("Refusing: not the dev project.");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: link, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: "e2e-phase2@lamportpay.test",
});
if (error) throw new Error(`generateLink: ${error.message}`);
const { data: session, error: vErr } = await anon.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: "magiclink",
});
if (vErr || !session.session) throw new Error(`verifyOtp: ${vErr?.message ?? "no session"}`);
console.log("E2E session minted for the dev test user.");
const files = process.argv.slice(2);
const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", ...files], {
  stdio: "inherit",
  env: { ...process.env, E2E_ACCESS_TOKEN: session.session.access_token, E2E_BASE_URL: process.env.E2E_BASE_URL ?? "http://localhost:8080" },
});
process.exit(r.status ?? 1);
