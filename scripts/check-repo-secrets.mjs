#!/usr/bin/env node
/**
 * Fails when tracked files include .env files or look like they hold secrets.
 * Uses `git ls-files`, so only committed/staged files are checked. Prints file
 * names and the pattern name only, never the value.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const ENV_FILE = /(^|\/)\.env($|\.(?!example$)[^/]+$)/;
const PATTERNS = {
  "Stables live key": /sti_live_[A-Za-z0-9]{16,}/,
  "Supabase secret key": /sb_secret_[A-Za-z0-9]{16,}/,
  "JWT-shaped service key":
    /eyJhbGciOi[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  "private key block": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
};
// Test fixtures use obviously fake values like "sti_live_fixture".
const SKIP = [/^tests\//, /^package-lock\.json$/];

let problems = 0;
for (const file of tracked) {
  if (ENV_FILE.test(file)) {
    console.error(`TRACKED env file: ${file}`);
    problems++;
    continue;
  }
  if (SKIP.some((re) => re.test(file))) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [label, re] of Object.entries(PATTERNS)) {
    if (re.test(text)) {
      console.error(`FOUND ${label} in ${file}`);
      problems++;
    }
  }
}
console.log(`Checked ${tracked.length} tracked files.`);
if (problems > 0) process.exit(1);
console.log("No env files or secrets in tracked files.");
