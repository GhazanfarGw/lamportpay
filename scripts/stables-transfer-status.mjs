// SANDBOX ONLY, READ-ONLY. Prints what Stables itself reports for transfers:
// status, deposit status and timestamps, so a payment that looks "stuck" can be
// told apart from a LamportPay problem. Never prints the API key or personal data.
// Usage: node scripts/stables-transfer-status.mjs <transfer_id> [...]
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

const ids = process.argv.slice(2);
if (ids.length === 0)
  throw new Error("Usage: node scripts/stables-transfer-status.mjs <transfer_id> [...]");

for (const id of ids) {
  const res = await fetch(`${url}/api/v1/transfers/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.STABLES_API_KEY}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  const pick = (o, keys) =>
    Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
  console.log(
    JSON.stringify(
      {
        transfer_id: id,
        http: res.status,
        ...pick(body, ["status", "created_at", "updated_at", "completed_at", "failure_reason"]),
        deposit: pick(body.deposit ?? body.source ?? {}, [
          "status",
          "network",
          "currency",
          "amount",
        ]),
        keys: Object.keys(body ?? {}),
      },
      null,
      1,
    ),
  );
}
