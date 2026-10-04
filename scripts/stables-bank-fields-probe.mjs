// SANDBOX ONLY. Asks Stables' /payment-methods/validate which bank fields each payout
// currency needs, using placeholder test values. Read-only: nothing is created.
// Usage: node scripts/stables-bank-fields-probe.mjs [CUR ...]
// Never prints the API key.
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

const CORRIDORS = {
  ARS: "AR",
  AUD: "AU",
  BRL: "BR",
  CNY: "CN",
  COP: "CO",
  GBP: "GB",
  GHS: "GH",
  INR: "IN",
  KES: "KE",
  MXN: "MX",
  NGN: "NG",
  PHP: "PH",
  RWF: "RW",
  TZS: "TZ",
  UGX: "UG",
  USD: "US",
  XAF: "CM",
  XOF: "CI",
  ZAR: "ZA",
  ZMW: "ZM",
};
const pick = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const list = pick.length ? pick : Object.keys(CORRIDORS);

async function validate(destination) {
  const res = await fetch(`${url}/api/v1/payment-methods/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.STABLES_API_KEY}`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ network: "bank", destination }),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text.slice(0, 300) };
  }
}

// Round 2 (--full): placeholder values for the fields round 1 reported, to see
// whether Stables then accepts the shape (sandbox test values only).
const ADDRESS = { street: "1 Test Street", city: "Test City", state: "TS", postal_code: "10001" };
const FULL = {
  ARS: {
    account_number: "0000003100010000000001",
    phone: "+5491123456789",
    national_identification_number: "20123456786",
  },
  AUD: { bsb_code: "062000", account_number: "12345678" },
  BRL: { account_number: "+5511912345678", phone: "+5511912345678" },
  COP: { phone: "+573001234567", national_identification_number: "1234567890" },
  GBP: { sort_code: "040004", account_number: "12345678", address: true },
  GHS: { phone: "+233201234567" },
  INR: { ifsc_code: "HDFC0000001", account_number: "123456789012", address: true },
  KES: { phone: "+254712345678" },
  MXN: { account_number: "002010077777777771", phone: "+525512345678", address: true },
  NGN: { account_number: "0123456789", phone: "+2348012345678" },
  PHP: {
    account_number: "1234567890",
    swift_code: "BNORPHMM",
    bank_name: "Banco De Oro Unibank, Inc.",
  },
  RWF: { phone: "+250781234567" },
  TZS: { phone: "+255712345678" },
  UGX: { phone: "+256712345678" },
  USD: { aba_code: "021000021", account_number: "123456789", address: true },
  XAF: { phone: "+237671234567" },
  XOF: { phone: "+2250712345678" },
  ZAR: { phone: "+27821234567" },
  ZMW: { phone: "+260971234567" },
};
const full = process.argv.includes("--full");

for (const cur of list.filter((c) => !c.startsWith("--"))) {
  const country = CORRIDORS[cur];
  const base = {
    type: "bank",
    recipient_type: "individual",
    account_holder_name: "Test Person",
    bank_name: "Test Bank",
    bank_country: country,
    currency: cur,
    account_number: "12345678",
  };
  if (full && FULL[cur]) {
    const { address, ...rest } = FULL[cur];
    Object.assign(base, rest);
    if (address) base.address = { ...ADDRESS, country: country.toLowerCase() };
  }
  const r = await validate(base);
  const errs = Array.isArray(r.body?.errors)
    ? r.body.errors.map((e) => `${e.field ?? "-"}: ${e.message} [${e.code}]`)
    : [JSON.stringify(r.body).slice(0, 300)];
  console.log(`\n${cur} (${country}) HTTP ${r.status} valid=${r.body?.valid}`);
  for (const e of errs) console.log("   ", e);
}
