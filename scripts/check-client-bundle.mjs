#!/usr/bin/env node
/**
 * Fails when the built browser bundle contains anything server-only: secret
 * env names, key prefixes or private-key blocks. Run after `npm run build`.
 * Prints only file names and the pattern name, never the matched value.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [".vercel/output/static", ".output/public", "dist"];
const PATTERNS = {
  "service role key name": /SUPABASE_SERVICE_ROLE_KEY/,
  "Stables API key name": /STABLES_API_KEY/,
  "Stables webhook secret name": /STABLES_WEBHOOK_SECRET/,
  "Jupiter API key name": /JUPITER_API_KEY/,
  "Stables live key prefix": /sti_live_[A-Za-z0-9]{8,}/,
  "Supabase secret key prefix": /sb_secret_[A-Za-z0-9]{8,}/,
  "private key block": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|html|css|json|map)$/.test(name)) yield path;
  }
}

const roots = ROOTS.filter((r) => {
  try {
    return statSync(r).isDirectory();
  } catch {
    return false;
  }
});
if (roots.length === 0) {
  console.error("No build output found. Run `npm run build` first.");
  process.exit(1);
}

let found = 0;
let scanned = 0;
for (const root of roots) {
  for (const file of files(root)) {
    scanned++;
    const text = readFileSync(file, "utf8");
    for (const [label, re] of Object.entries(PATTERNS)) {
      if (re.test(text)) {
        console.error(`FOUND ${label} in ${file}`);
        found++;
      }
    }
  }
}
console.log(`Scanned ${scanned} client files in ${roots.join(", ")}.`);
if (found > 0) process.exit(1);
console.log("No server secrets in the client bundle.");
