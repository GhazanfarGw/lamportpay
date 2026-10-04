// SANDBOX ONLY, READ-ONLY. Prints a sanitized view of Stables transfers side by side
// (structure, statuses, currencies, amounts, timestamps) so a completed and a stuck
// transfer can be compared. Personal data (names, account numbers, addresses, phone,
// email) is masked. Never prints the API key.
// Usage: node scripts/stables-transfer-compare.mjs <transfer_id> [...]
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const url = env.STABLES_API_URL;
if (!url || !url.includes("sandbox"))
  throw new Error("Refusing: STABLES_API_URL is not the sandbox.");

const KEEP =
  /(^|_)(status|state|currency|network|country|type|amount|rate|fee|created_at|updated_at|completed_at|expires_at|scenario|code|reason|purpose|method|rail|id)$/i;
const PII =
  /(name|account|iban|number|address|street|city|postal|phone|email|sort|ifsc|routing|aba|bsb|clabe|cbu|pix|swift|bic|holder|line)/i;

function sanitize(value, key = "") {
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  if (typeof value === "string" && PII.test(key) && !KEEP.test(key))
    return `<${value.length} chars>`;
  if (typeof value === "string" && value.includes("@")) return "<email>";
  return value;
}

for (const id of process.argv.slice(2)) {
  const res = await fetch(`${url}/api/v1/transfers/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.STABLES_API_KEY}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`===== ${id} (HTTP ${res.status})`);
  console.log(JSON.stringify(sanitize(body), null, 1));
}
