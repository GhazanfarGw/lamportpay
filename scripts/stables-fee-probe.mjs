// Dev-only: ask the Stables SANDBOX for preview quotes and print how fees relate
// to the payout. Never prints the API key. Usage: node scripts/stables-fee-probe.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const url = (env.STABLES_API_URL || "https://api.sandbox.stables.money").replace(/\/$/, "");
if (!url.includes("sandbox")) throw new Error("Refusing: not the sandbox URL.");

for (const [amount, country, currency] of [
  ["100", "IN", "inr"],
  ["98", "IN", "inr"],
  ["1000", "IN", "inr"],
  ["100", "US", "usd"],
  ["100", "GB", "gbp"],
]) {
  const res = await fetch(`${url}/api/v1/quotes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STABLES_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      source: { currency: "usdc", network: "solana", amount },
      destination: { currency, country, network: "bank" },
      preview: true,
    }),
  });
  const q = await res.json();
  if (!res.ok) {
    console.log(amount, currency, "ERROR", res.status, q?.message);
    continue;
  }
  const fees = Object.fromEntries(Object.entries(q.fees ?? {}).map(([k, v]) => [k, v?.amount]));
  const dest = Number(q.destination.amount);
  const rate = Number(q.exchange_rate);
  const total = Number(q.fees?.total_fee?.amount ?? 0);
  console.log(
    JSON.stringify({
      send: amount,
      currency,
      destination: q.destination.amount,
      exchange_rate: q.exchange_rate,
      fees,
      "send*rate": (Number(amount) * rate).toFixed(2),
      "(send-total_fee)*rate": ((Number(amount) - total) * rate).toFixed(2),
      "destination/send": (dest / Number(amount)).toFixed(6),
    }),
  );
}
