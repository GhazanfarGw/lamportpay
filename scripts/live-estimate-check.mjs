// Usage (dev only): node --env-file=.env scripts/live-estimate-check.mjs
// Calls /api/quote/estimate on the local dev server (localhost:8080) as the dev E2E test user
// for a list of countries. Dev project only; prints results, never tokens.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
if (!url || !url.includes("gdksfksypkcfiohozzsx")) throw new Error("Refusing: not the dev project.");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(url, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: "e2e-phase2@lamportpay.test" });
if (error) throw error;
const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
if (e2) throw e2;
for (const body of [
  ["PK","PKR"],["NG","NGN"],["PH","PHP"],["MX","MXN"],["CO","COP"],["BR","BRL"],["KE","KES"],["GB","GBP"],["US","USD"],
  ["AU","AUD"],["AE","AED"],["CA","CAD"],["DE","EUR"],["SG","SGD"],["ZA","ZAR"],["GH","GHS"],["IN","INR"],["SA","SAR"],
].map(([country, currency]) => ({ amount: "150", country, currency, coin: "usdc", withSol: country === "GB" }))) {
  const t = Date.now();
  const r = await fetch("http://localhost:8080/api/quote/estimate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.session.access_token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json(); console.log(body.country, r.status, j.payout ? (j.payout.status === 'priced' ? `priced receives ${j.payout.receives} ${j.payout.currency}` : `refused: ${j.payout.reason}`) + (j.sol ? ` | sol ${JSON.stringify(j.sol)}` : '') : JSON.stringify(j));
}
