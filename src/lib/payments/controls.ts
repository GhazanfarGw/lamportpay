/**
 * Emergency controls and per-corridor rules (pure; no I/O).
 *
 * - Global pause: no new payment, quote, transfer or in-app funding transaction.
 * - Per-currency (corridor) pause: no new payment, quote or transfer to that payout currency.
 * - Per-corridor limits: narrow LamportPay's per-coin limits for one payout currency.
 *
 * Stored per mode in `business_settings.payment_controls` so TEST/sandbox rules and
 * LIVE/production rules never mix. Enforced on the server (service.server.ts); the UI
 * only reflects them. A pause never touches existing payments' statuses: transfers
 * already created keep following Stables.
 */
import type { AppMode } from "@/lib/app-mode";

export type CorridorRule = {
  paused: boolean;
  reason: string | null;
  /** Narrows the coin minimum for this payout currency (minor units of the coin). */
  min_minor: number | null;
  /** Narrows the coin maximum for this payout currency. */
  max_minor: number | null;
};

export type ModeControls = {
  paused: boolean;
  reason: string | null;
  /** Keyed by upper-case payout currency (ISO 4217), e.g. "INR". */
  corridors: Record<string, CorridorRule>;
};

export type StoredPaymentControls = Partial<Record<AppMode, ModeControls>>;

export const EMPTY_CONTROLS: ModeControls = { paused: false, reason: null, corridors: {} };

const CURRENCY = /^[A-Z]{3}$/;
const MAX_REASON = 300;

function cleanReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, MAX_REASON) : null;
}

function cleanMinor(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive amount in minor units.`);
  }
  return value;
}

/**
 * Validate one mode's controls (from the database or an admin). Throws a clear
 * message on anything invalid; unknown keys are dropped.
 */
export function parseModeControls(raw: unknown): ModeControls {
  if (raw === null || raw === undefined) return { ...EMPTY_CONTROLS, corridors: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid payment controls.");
  const r = raw as Record<string, unknown>;
  const paused = r["paused"] === true;
  const reason = cleanReason(r["reason"]);
  if (paused && !reason) throw new Error("A payment pause needs a reason.");
  const corridors: Record<string, CorridorRule> = {};
  const rawCorridors = r["corridors"];
  if (rawCorridors !== undefined && rawCorridors !== null) {
    if (typeof rawCorridors !== "object" || Array.isArray(rawCorridors)) {
      throw new Error("Invalid corridor controls.");
    }
    for (const [key, value] of Object.entries(rawCorridors as Record<string, unknown>)) {
      const code = key.trim().toUpperCase();
      if (!CURRENCY.test(code)) throw new Error(`"${key}" is not a currency code.`);
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`Invalid controls for ${code}.`);
      }
      const v = value as Record<string, unknown>;
      const rule: CorridorRule = {
        paused: v["paused"] === true,
        reason: cleanReason(v["reason"]),
        min_minor: cleanMinor(v["min_minor"], `${code} minimum`),
        max_minor: cleanMinor(v["max_minor"], `${code} maximum`),
      };
      if (rule.paused && !rule.reason) throw new Error(`Pausing ${code} needs a reason.`);
      if (rule.min_minor !== null && rule.max_minor !== null && rule.min_minor > rule.max_minor) {
        throw new Error(`${code}: the minimum is above the maximum.`);
      }
      // A rule that restricts nothing is not stored.
      if (rule.paused || rule.min_minor !== null || rule.max_minor !== null) corridors[code] = rule;
    }
  }
  return { paused, reason: paused ? reason : null, corridors };
}

/** The controls for one mode. Invalid stored controls fail closed (everything paused). */
export function controlsForMode(stored: unknown, mode: AppMode): ModeControls {
  const all = (stored ?? {}) as Record<string, unknown>;
  try {
    return parseModeControls(all[mode]);
  } catch (e) {
    console.error(
      "[controls] invalid stored payment controls:",
      e instanceof Error ? e.message : e,
    );
    return {
      paused: true,
      reason: "Payment controls are misconfigured; payments are paused until an admin fixes them.",
      corridors: {},
    };
  }
}

export type Refusal = { status: 503; code: "payments_paused" | "corridor_paused"; message: string };

/** Why a new payment step must be refused, or null. `currency` = payout currency. */
export function pauseRefusal(controls: ModeControls, currency: string | null): Refusal | null {
  if (controls.paused) {
    return {
      status: 503,
      code: "payments_paused",
      message: "New payments are paused for maintenance. Please try again later.",
    };
  }
  if (currency) {
    const rule = controls.corridors[currency.trim().toUpperCase()];
    if (rule?.paused) {
      return {
        status: 503,
        code: "corridor_paused",
        message: `Payouts in ${currency.trim().toUpperCase()} are temporarily paused. Please try again later or choose another currency.`,
      };
    }
  }
  return null;
}

type MajorLimits = { min: string; max: string | null };

/**
 * Coin limits narrowed by a corridor's rule (both in the coin's major units).
 * `toMajor` converts a minor amount to the coin's major units. Never widens a
 * coin limit: the stricter value always wins.
 */
export function narrowLimits(
  coin: MajorLimits | null,
  rule: CorridorRule | undefined,
  toMajor: (minor: number) => string,
): MajorLimits | null {
  if (!coin || !rule) return coin;
  const num = (s: string) => Number(s);
  let min = coin.min;
  let max = coin.max;
  if (rule.min_minor !== null) {
    const m = toMajor(rule.min_minor);
    if (num(m) > num(min)) min = m;
  }
  if (rule.max_minor !== null) {
    const m = toMajor(rule.max_minor);
    if (max === null || num(m) < num(max)) max = m;
  }
  // Contradictory rules (corridor minimum above the coin maximum, or the reverse):
  // null = misconfigured, so payments to this corridor answer 503 rather than guess.
  if (max !== null && num(min) > num(max)) return null;
  return { min, max };
}
