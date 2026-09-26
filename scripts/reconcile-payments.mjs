#!/usr/bin/env node
/**
 * Run the payment reconciliation job now, against a running LamportPay server
 * (default: the local dev server). Authenticates with CRON_SECRET from .env /
 * .env.local (dev server precedence: .env.local wins); the secret is never
 * printed.
 *
 *   npm run reconcile
 *   npm run reconcile -- --url https://<tunnel>.trycloudflare.com
 *
 * The job retries stored webhook deliveries that were never processed, then
 * reads every active Stables transfer and moves payments forward. It prints
 * the job's report as JSON.
 */
import { loadEnv } from "vite";

const PATH = "/api/cron/reconcile-payments";

const args = process.argv.slice(2);
const urlFlag = args.indexOf("--url");
const base = urlFlag >= 0 ? args[urlFlag + 1] : "http://localhost:8080";
if (!base) {
  console.error("Usage: npm run reconcile -- [--url <base or endpoint URL>]");
  process.exit(1);
}
const url = new URL(base);
if (url.pathname === "/" || url.pathname === "") url.pathname = PATH;

const secret = loadEnv("development", process.cwd(), "")["CRON_SECRET"]?.trim();
if (!secret) {
  console.error("CRON_SECRET is not set in .env.local (or .env).");
  process.exit(1);
}

let response;
try {
  response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
} catch (error) {
  console.error(`Could not reach ${url.href}: ${error instanceof Error ? error.message : error}`);
  console.error("Is the dev server running (npm run dev)?");
  process.exit(2);
}

const text = await response.text();
console.log(`POST ${url.href} → HTTP ${response.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
if (!response.ok) {
  if (response.status === 401) {
    console.error(
      "401: the server's CRON_SECRET differs (restart the dev server after editing .env).",
    );
  }
  process.exit(2);
}
