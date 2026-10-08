#!/usr/bin/env node
/**
 * CI dependency audit: `npm audit --omit=dev`, failing on any high or critical
 * advisory except the ones accepted below. Each accepted advisory names why it
 * is accepted; remove it as soon as an upstream fix exists.
 */
import { spawnSync } from "node:child_process";

const ACCEPTED = {
  // braces <= 3.0.3 (no fixed release yet). Reaches the tree only through
  // @solana/wallet-adapter-react -> @solana-mobile/wallet-adapter-mobile ->
  // react-native -> metro (React Native's bundler), which the web app never
  // runs. Owner decision 2026-10-08.
  "GHSA-vfj7-8cjw-p6xm": "braces: metro (React Native bundler) only, not loaded by the app",
};

const FAIL_ON = new Set(["high", "critical"]);

const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 64 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error("npm audit did not return JSON:", (r.stderr || r.stdout || "").slice(0, 2000));
  process.exit(1);
}

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== "object" || !FAIL_ON.has(via.severity)) continue;
    const id =
      String(via.url ?? "")
        .split("/")
        .pop() || String(via.source);
    advisories.set(id, `${via.severity} ${via.name}: ${via.title} (${via.url})`);
  }
}

let failed = 0;
for (const [id, text] of advisories) {
  if (ACCEPTED[id]) {
    console.log(`accepted  ${id}  ${ACCEPTED[id]}`);
  } else {
    failed++;
    console.log(`FAIL      ${id}  ${text}`);
  }
}
for (const id of Object.keys(ACCEPTED)) {
  if (!advisories.has(id))
    console.log(`note      ${id} no longer reported; remove it from ACCEPTED`);
}
console.log(
  failed
    ? `\n${failed} high/critical advisory(ies) not accepted.`
    : "\nNo unaccepted high or critical advisories.",
);
process.exit(failed ? 1 : 0);
