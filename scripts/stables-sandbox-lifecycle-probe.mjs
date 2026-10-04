// SANDBOX ONLY. Controlled experiment on Stables' own sandbox, bypassing LamportPay:
// for each case it creates a quote and a transfer for an existing, already-verified
// sandbox customer, calls Stables' simulate-deposit, then polls GET /transfers/{id}
// and prints every status Stables reports. It proves whether a transfer reaching
// (or not reaching) `completed` depends on Stables, independent of our code.
// Writes nothing to LamportPay's database. Never prints the API key or bank data.
// Usage: node --use-env-proxy scripts/stables-sandbox-lifecycle-probe.mjs <customer_id> [CUR:AMOUNT ...]
//   e.g. ... c97c3e6e-... AUD:105 NGN:105 NGN:9.8 GBP:100
import { randomUUID } from "node:crypto";
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
if (!env.STABLES_API_KEY?.startsWith("sti_test_"))
  throw new Error("Refusing: not a sandbox (sti_test_) key.");

const [customerId, ...cases] = process.argv.slice(2);
if (!customerId || cases.length === 0) throw new Error("Usage: <customer_id> CUR:AMOUNT [...]");

// Sandbox test bank details (same placeholders as stables-bank-fields-probe.mjs --full).
const ADDRESS =
  process.env.PROBE_ADDRESS === "uk"
    ? { street: "1 Test Street", city: "London", state: "England", postal_code: "SW1A 1AA" }
    : { street: "1 Test Street", city: "Test City", state: "TS", postal_code: "10001" };
const BANK = {
  AUD: { country: "AU", fields: { bsb_code: "062000", account_number: "12345678" } },
  GBP: {
    country: "GB",
    fields: { sort_code: "040004", account_number: "12345678" },
    address: true,
  },
  NGN: { country: "NG", fields: { account_number: "0123456789", phone: "+2348012345678" } },
  MXN: {
    country: "MX",
    fields: { account_number: "002010077777777771", phone: "+525512345678" },
    address: true,
  },
  KES: { country: "KE", fields: { account_number: "12345678", phone: "+254712345678" } },
  ARS: {
    country: "AR",
    fields: {
      account_number: "0000003100010000000001",
      phone: "+5491123456789",
      national_identification_number: "20123456786",
    },
  },
  BRL: { country: "BR", fields: { account_number: "+5511912345678", phone: "+5511912345678" } },
  COP: {
    country: "CO",
    fields: {
      account_number: "12345678",
      phone: "+573001234567",
      national_identification_number: "1234567890",
    },
  },
  GHS: { country: "GH", fields: { account_number: "12345678", phone: "+233201234567" } },
  INR: {
    country: "IN",
    fields: { ifsc_code: "HDFC0000001", account_number: "123456789012" },
    address: true,
  },
  PHP: {
    country: "PH",
    fields: { account_number: "1234567890", swift_code: "BNORPHMM" },
    bankName: "Banco De Oro Unibank, Inc.",
  },
  RWF: { country: "RW", fields: { account_number: "12345678", phone: "+250781234567" } },
  TZS: { country: "TZ", fields: { account_number: "12345678", phone: "+255712345678" } },
  UGX: { country: "UG", fields: { account_number: "12345678", phone: "+256712345678" } },
  USD: {
    country: "US",
    fields: { aba_code: "021000021", account_number: "123456789" },
    address: true,
  },
  XAF: { country: "CM", fields: { account_number: "12345678", phone: "+237671234567" } },
  XOF: { country: "CI", fields: { account_number: "12345678", phone: "+2250712345678" } },
  ZAR: { country: "ZA", fields: { account_number: "12345678", phone: "+27821234567" } },
  ZMW: { country: "ZM", fields: { account_number: "12345678", phone: "+260971234567" } },
};

async function call(method, path, body) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STABLES_API_KEY}`,
      Accept: "application/json",
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(method === "POST" && { "Idempotency-Key": randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, correlation: res.headers.get("x-correlation-id") };
}

const customer = await call("GET", `/api/v1/customers/${customerId}`);
const name = [customer.json.first_name, customer.json.last_name].filter(Boolean).join(" ");
console.log(
  `customer ${customerId}: HTTP ${customer.status}, levels=${JSON.stringify(customer.json.verification_levels)}`,
);

const results = [];
for (const c of cases) {
  const [cur, amount] = c.split(":");
  const bank = BANK[cur];
  const row = { case: c };
  results.push(row);
  if (!bank) {
    row.error = "no test bank details for this currency";
    continue;
  }
  const quote = await call("POST", "/api/v1/quotes", {
    source: { currency: "usdc", network: "solana", amount },
    destination: { currency: cur.toLowerCase(), country: bank.country, network: "bank" },
    metadata: { probe: "lifecycle" },
  });
  if (quote.status >= 300) {
    row.quote = `HTTP ${quote.status} ${quote.json.message ?? ""}`;
    continue;
  }
  const destination = {
    ...bank.fields,
    type: "bank",
    recipient_type: "individual",
    account_holder_name: name || "Test Person",
    bank_name: bank.bankName ?? "Test Bank",
    bank_country: bank.country,
    currency: cur,
    ...(bank.address && { address: { ...ADDRESS, country: bank.country.toLowerCase() } }),
  };
  const transfer = await call("POST", "/api/v1/transfer", {
    quote_id: quote.json.id ?? quote.json.quote_id,
    customer_id: customerId,
    destination,
    purpose_code: "TRANSFER_TO_OWN_ACCOUNT",
    metadata: { probe: "lifecycle" },
  });
  if (transfer.status >= 300) {
    row.transfer = `HTTP ${transfer.status} ${transfer.json.message ?? ""} (correlation ${transfer.correlation})`;
    continue;
  }
  row.transfer_id = transfer.json.id;
  row.statuses = [`${transfer.json.status}@create`];
  const sim = await call(
    "POST",
    `/api/v1/transfers/${transfer.json.id}/sandbox/simulate-deposit`,
    {},
  );
  row.simulate = `HTTP ${sim.status} ${sim.json.deposit_status ?? sim.json.message ?? ""}`;
  console.log(JSON.stringify(row));
}

// Poll every transfer for up to ~150 s, recording each distinct status.
const started = Date.now();
const pollMs = Number(process.env.PROBE_POLL_MS ?? 90_000);
while (Date.now() - started < pollMs) {
  let open = 0;
  for (const row of results.filter((r) => r.transfer_id)) {
    const t = await call("GET", `/api/v1/transfers/${row.transfer_id}`);
    const s = `${t.json.status}@${Math.round((Date.now() - started) / 1000)}s`;
    if (!row.statuses.at(-1)?.startsWith(`${t.json.status}@`)) {
      row.statuses.push(s);
      console.log(`${row.case} ${row.transfer_id} -> ${s}`);
    }
    if (!["completed", "failed", "cancelled", "expired"].includes(t.json.status)) open++;
  }
  if (open === 0) break;
  await new Promise((r) => setTimeout(r, 10_000));
}
console.log(JSON.stringify(results, null, 1));
