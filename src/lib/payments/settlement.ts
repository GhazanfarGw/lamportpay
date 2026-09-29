/**
 * Settlement choice: which stablecoin pays for a payment, and whether the
 * wallet needs a swap first (docs/wallet-settlement-design.md, "Decision
 * rule"). Pure: the caller runs the Stables previews and the balance read and
 * passes the results in, so every branch is testable without I/O. Amounts are
 * bigint minor units throughout; USDC and USDT share 6 decimals, so one
 * payment amount is comparable across coins.
 */

import { toMajor } from "@/lib/money";
import type { StablesQuote } from "@/lib/stables/types";
import { PAYMENT_CURRENCIES, type PaymentCurrency } from "@/lib/tokens";

export type Verdict =
  "priced" | "amount_rejected" | "unavailable" | "unsupported" | "out_of_limits";

export type Candidate =
  | {
      coin: PaymentCurrency;
      verdict: "priced";
      destinationAmountMinor: bigint;
      totalFeeMinor: bigint | null;
      rate: number;
      quote: StablesQuote;
    }
  | {
      coin: PaymentCurrency;
      verdict: Exclude<Verdict, "priced">;
      code: string | null;
      reason: string;
    };

export type PricedCandidate = Extract<Candidate, { verdict: "priced" }>;
type RefusedCandidate = Exclude<Candidate, PricedCandidate>;

/** A Stables error as the client reports it; status 0 means the request never got an answer. */
export type PreviewError = { status: number; code?: string; message: string };

/**
 * Major-unit string to minor-unit converters, supplied by the caller so this
 * module needs no currency table. `source` may throw on an unreadable amount;
 * `destination` and `fee` return null instead.
 */
export type PreviewDecimals = {
  source: (amount: string) => bigint;
  destination: (amount: string) => bigint | null;
  fee: (amount: string, currency: string) => bigint | null;
};

export type PreviewInput = {
  coin: PaymentCurrency;
  amountMinor: bigint;
  destinationCurrency: string;
  decimals: PreviewDecimals;
} & ({ quote: StablesQuote } | { error: PreviewError });

export type Holdings =
  | { status: "ok"; solLamports: bigint; tokens: Record<PaymentCurrency, bigint> }
  | { status: "unavailable"; reason: string }
  | null;

export type Preference = "auto" | PaymentCurrency;

export type SwapInput = { asset: "sol" | PaymentCurrency; availableMinor: bigint };

export type SettlementDecision =
  | {
      kind: "none_priced";
      error: "quote_unavailable" | "amount_rejected" | "destination_not_supported";
      candidates: Candidate[];
      reason: string;
    }
  | { kind: "tentative"; coin: PaymentCurrency; candidates: Candidate[]; reason: string }
  | { kind: "funds_ready"; coin: PaymentCurrency; candidates: Candidate[]; reason: string }
  | { kind: "retry_later"; coin: PaymentCurrency; candidates: Candidate[]; reason: string }
  | {
      kind: "swap_required";
      coin: PaymentCurrency;
      shortfallMinor: bigint;
      swapInputs: SwapInput[];
      candidates: Candidate[];
      reason: string;
    }
  | {
      kind: "insufficient_funds";
      coin: PaymentCurrency;
      shortfallMinor: bigint;
      candidates: Candidate[];
      reason: string;
    }
  | {
      kind: "needs_sol";
      coin: PaymentCurrency;
      solNeededLamports: bigint;
      candidates: Candidate[];
      reason: string;
    };

// ------------------------------------------------------------ classification

const AMOUNT_WORDS = /amount|limit|minimum|maximum|exceed|too (low|high|small|large)/i;

/**
 * Stables refused because of the amount (its per-customer or corridor limits).
 * Same rule as amountRejected() in service.server.ts, so a preview and a firm
 * quote read the same refusal the same way.
 */
export function isAmountRejection(error: PreviewError): boolean {
  const rejection =
    error.status >= 400 && error.status < 500 && ![401, 403, 429].includes(error.status);
  return rejection && AMOUNT_WORDS.test(`${error.code ?? ""} ${error.message}`);
}

/**
 * Classify one Stables preview outcome. `quote` is a 2xx body; `error` a
 * Stables error (status 0 = network). A 401/403 is a configuration fault, not
 * a verdict on the route, so it throws. Never returns `out_of_limits`: the
 * caller builds that candidate itself without calling Stables.
 */
export function classifyPreview(input: PreviewInput): Candidate {
  return "error" in input ? classifyError(input, input.error) : classifyQuote(input, input.quote);
}

function classifyError(input: PreviewInput, error: PreviewError): Candidate {
  if (error.status === 401 || error.status === 403) {
    throw new Error("Stables rejected the credentials (401/403).");
  }
  const { coin } = input;
  const code = error.code ?? null;
  const refused = (verdict: RefusedCandidate["verdict"]): Candidate => ({
    coin,
    verdict,
    code,
    reason: withDetail(
      refusal(verdict, label(coin), label(input.destinationCurrency)),
      error.message,
    ),
  });

  if (isAmountRejection(error)) return refused("amount_rejected");
  // "Could not be priced right now", throttling and outages are not verdicts.
  if (
    code === "ROUTING_QUOTE_FAILED" ||
    error.status === 429 ||
    error.status >= 500 ||
    error.status === 0
  ) {
    return refused("unavailable");
  }
  if (error.status >= 400 && error.status < 500) return refused("unsupported");
  // Not an HTTP failure status at all: say nothing about the route.
  return refused("unavailable");
}

/** A 2xx is only a price for this payment if it quotes exactly what was asked. */
function classifyQuote(input: PreviewInput, quote: StablesQuote): Candidate {
  const { coin, amountMinor, decimals } = input;
  const coinLabel = label(coin);
  const dest = input.destinationCurrency.toLowerCase();
  const unsupported = (reason: string): Candidate => ({
    coin,
    verdict: "unsupported",
    code: null,
    reason,
  });

  const source = quote?.source;
  const destination = quote?.destination;
  if (
    typeof source?.currency !== "string" ||
    typeof source.amount !== "string" ||
    typeof destination?.currency !== "string" ||
    typeof destination.amount !== "string"
  ) {
    return unsupported(`The ${coinLabel} quote came back incomplete.`);
  }
  if (source.currency.toLowerCase() !== coin) {
    return unsupported(`The quote was for ${label(source.currency)}, not ${coinLabel}.`);
  }
  if (source.network !== undefined && source.network !== null) {
    if (source.network.toLowerCase() !== "solana") {
      return unsupported(`The ${coinLabel} quote was on ${source.network}, not Solana.`);
    }
  }
  const sourceMinor = attempt(() => decimals.source(source.amount));
  if (sourceMinor === null) {
    return unsupported(`The ${coinLabel} quote's amount (${source.amount}) couldn't be read.`);
  }
  if (sourceMinor !== amountMinor) {
    return unsupported(
      `The quote was for ${source.amount} ${coinLabel}, not ${coinAmount(amountMinor, coin)} ${coinLabel}.`,
    );
  }
  if (destination.currency.toLowerCase() !== dest) {
    return unsupported(
      `The ${coinLabel} quote pays out ${label(destination.currency)}, not ${label(dest)}.`,
    );
  }
  const destinationAmountMinor = attempt(() => decimals.destination(destination.amount));
  if (destinationAmountMinor === null) {
    return unsupported(
      `The ${coinLabel} quote's ${label(dest)} payout (${destination.amount}) couldn't be read.`,
    );
  }
  // The fee is a tie-break and a display value only, so an odd one is dropped.
  const total = quote.fees?.total_fee;
  const totalFeeMinor =
    typeof total?.amount === "string" && typeof total.currency === "string"
      ? attempt(() => decimals.fee(total.amount, total.currency))
      : null;

  return {
    coin,
    verdict: "priced",
    destinationAmountMinor,
    totalFeeMinor,
    rate: quote.exchange_rate,
    quote,
  };
}

// ------------------------------------------------------------------ decision

/**
 * Choose the settlement coin. A coin the wallet already holds in full always
 * wins over a swap, and a preference only picks among coins that need no swap,
 * so it can never cause one.
 */
export function decideSettlement(input: {
  amountMinor: bigint;
  /**
   * What the wallet must hold of the chosen coin: the amount plus LamportPay's
   * fee, paid in the same transaction. Defaults to `amountMinor` (no fee).
   */
  requiredMinor?: bigint;
  candidates: Candidate[];
  holdings: Holdings;
  preference: Preference;
  solReserveLamports: bigint | null;
  order: readonly PaymentCurrency[];
}): SettlementDecision {
  const { candidates, holdings, preference, solReserveLamports, order } = input;
  const amountMinor = input.requiredMinor ?? input.amountMinor;
  if (amountMinor < input.amountMinor) throw new Error("requiredMinor is below the amount.");
  const priced = candidates.filter(isPriced);
  const position = positionIn(order);

  // 1. Nothing priced.
  if (priced.length === 0) return nonePriced(candidates, position);

  const dest = label(priced[0]!.quote.destination.currency);
  const bestPayout = (a: PricedCandidate, b: PricedCandidate): number =>
    compareDesc(a.destinationAmountMinor, b.destinationAmountMinor) ||
    compareFee(a.totalFeeMinor, b.totalFeeMinor) ||
    position(a.coin) - position(b.coin);
  const others = (chosen: PaymentCurrency): Candidate[] =>
    candidates.filter((c) => c.coin !== chosen).sort((a, b) => position(a.coin) - position(b.coin));
  /** Why each other coin lost; empty when the user asked for the chosen one. */
  const whyChosen = (
    chosen: PricedCandidate,
    pricedClause: (other: PricedCandidate) => string,
  ): string[] =>
    preference === chosen.coin
      ? []
      : others(chosen.coin).map((other) =>
          other.verdict === "priced"
            ? pricedClause(other)
            : refusal(other.verdict, label(other.coin), dest),
        );

  // 2. Holdings unknown: a provisional choice that can't lead to a swap.
  if (holdings === null || holdings.status === "unavailable") {
    const chosen = priced.find((c) => c.coin === preference) ?? [...priced].sort(bestPayout)[0]!;
    const clauses = whyChosen(chosen, (other) => payoutClause(chosen, other, dest));
    const cause =
      holdings === null
        ? "connect your wallet so we can check what you hold"
        : "we couldn't read your wallet to check what you hold";
    return {
      kind: "tentative",
      coin: chosen.coin,
      candidates,
      reason: `${label(chosen.coin)} chosen for now${because(clauses)}; ${cause}.`,
    };
  }

  const balance = (coin: PaymentCurrency): bigint => holdings.tokens[coin] ?? 0n;
  const isHeld = (coin: PaymentCurrency): boolean => balance(coin) >= amountMinor;
  const solShort =
    solReserveLamports !== null && holdings.solLamports < solReserveLamports
      ? solReserveLamports - holdings.solLamports
      : null;
  const needsSol = (coin: PaymentCurrency, solNeededLamports: bigint): SettlementDecision => ({
    kind: "needs_sol",
    coin,
    solNeededLamports,
    candidates,
    reason: `Add ${lamportsText(solNeededLamports)} SOL to your wallet to cover network fees before paying with ${label(coin)}.`,
  });

  // 3. Held in full: no swap, whatever the rates.
  const held = priced.filter((c) => isHeld(c.coin));
  if (held.length > 0) {
    const chosen = held.find((c) => c.coin === preference) ?? [...held].sort(bestPayout)[0]!;
    if (solShort !== null) return needsSol(chosen.coin, solShort);
    const clauses = whyChosen(chosen, (other) =>
      isHeld(other.coin)
        ? payoutClause(chosen, other, dest)
        : `you don't hold enough ${label(other.coin)}`,
    );
    const holding = `you hold ${holdingText(balance(chosen.coin), chosen.coin)}, enough for this payment`;
    return {
      kind: "funds_ready",
      coin: chosen.coin,
      candidates,
      reason: clauses.length
        ? `${label(chosen.coin)} chosen${because(clauses)}: ${holding}.`
        : `${capitalize(holding)}.`,
    };
  }

  // 4. Held, but Stables couldn't price it just now: retry, don't swap.
  const waiting = candidates
    .filter((c) => c.verdict === "unavailable" && isHeld(c.coin))
    .sort((a, b) => position(a.coin) - position(b.coin))[0];
  if (waiting) {
    return {
      kind: "retry_later",
      coin: waiting.coin,
      candidates,
      reason: `You hold ${holdingText(balance(waiting.coin), waiting.coin)}, but it couldn't be priced right now; try again shortly.`,
    };
  }

  // 5. Swap into the priced coin that is closest to the amount.
  const shortfall = (c: PricedCandidate): bigint => amountMinor - balance(c.coin);
  const target = [...priced].sort(
    (a, b) =>
      compareAsc(shortfall(a), shortfall(b)) ||
      Number(b.coin === preference) - Number(a.coin === preference) ||
      bestPayout(a, b),
  )[0]!;
  const shortfallMinor = shortfall(target);
  const swapInputs: SwapInput[] = [];
  const spareSol = holdings.solLamports - (solReserveLamports ?? 0n);
  if (spareSol > 0n) swapInputs.push({ asset: "sol", availableMinor: spareSol });
  for (const coin of [...order, ...PAYMENT_CURRENCIES.filter((c) => !order.includes(c))]) {
    if (coin !== target.coin && balance(coin) > 0n) {
      swapInputs.push({ asset: coin, availableMinor: balance(coin) });
    }
  }

  const coinLabel = label(target.coin);
  const clauses = whyChosen(target, (other) =>
    shortfall(other) > shortfallMinor
      ? `you hold less ${label(other.coin)}`
      : payoutClause(target, other, dest),
  );
  const lead = clauses.length ? `${coinLabel} chosen${because(clauses)}: ` : "";
  const heldText = `you hold ${coinAmount(balance(target.coin), target.coin)} of the ${holdingText(amountMinor, target.coin)} needed`;
  const missing = holdingText(shortfallMinor, target.coin);

  if (swapInputs.length === 0) {
    return {
      kind: "insufficient_funds",
      coin: target.coin,
      shortfallMinor,
      candidates,
      reason: capitalize(
        `${lead}${heldText} and nothing to swap from, so add ${missing} to your wallet.`,
      ),
    };
  }
  // 6. Not enough SOL for fees and rent: never swap the payment coin into SOL.
  if (solShort !== null) return needsSol(target.coin, solShort);
  const inputs = joinList(
    swapInputs.map((s) => label(s.asset)),
    "or",
  );
  return {
    kind: "swap_required",
    coin: target.coin,
    shortfallMinor,
    swapInputs,
    candidates,
    reason: capitalize(`${lead}${heldText}, so swap ${inputs} for the missing ${missing}.`),
  };
}

function nonePriced(
  candidates: Candidate[],
  position: (coin: PaymentCurrency) => number,
): SettlementDecision {
  const refused = candidates.filter((c): c is RefusedCandidate => c.verdict !== "priced");
  const has = (verdict: RefusedCandidate["verdict"]) => refused.some((c) => c.verdict === verdict);
  // Our own limits are an amount problem too, not a verdict on the destination.
  const error = has("unavailable")
    ? "quote_unavailable"
    : has("amount_rejected") || has("out_of_limits")
      ? "amount_rejected"
      : "destination_not_supported";

  const byVerdict = new Map<RefusedCandidate["verdict"], string[]>();
  for (const c of [...refused].sort((a, b) => position(a.coin) - position(b.coin))) {
    byVerdict.set(c.verdict, [...(byVerdict.get(c.verdict) ?? []), label(c.coin)]);
  }
  const clauses = [...byVerdict].map(([verdict, coins]) =>
    refusal(verdict, joinList(coins, "and"), null),
  );
  const summary = clauses.length
    ? capitalize(joinList(clauses, "and"))
    : "No settlement coin is available for this payment";
  return {
    kind: "none_priced",
    error,
    candidates,
    reason: error === "quote_unavailable" ? `${summary}; try again shortly.` : `${summary}.`,
  };
}

// ------------------------------------------------------------------- helpers

function isPriced(c: Candidate): c is PricedCandidate {
  return c.verdict === "priced";
}

/** Position in the configured coin order; unknown coins sort last. */
function positionIn(order: readonly PaymentCurrency[]) {
  return (coin: PaymentCurrency): number => {
    const i = order.indexOf(coin);
    return i === -1 ? order.length : i;
  };
}

function compareAsc(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDesc(a: bigint, b: bigint): number {
  return compareAsc(b, a);
}

/** Lower fee first; an unknown fee counts as the worst. */
function compareFee(a: bigint | null, b: bigint | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareAsc(a, b);
}

function attempt<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function label(code: string): string {
  return code.toUpperCase();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Minor units of a payment coin as a grouped major amount: "1,000,000" or "99.5". */
function coinAmount(minor: bigint, coin: PaymentCurrency): string {
  const [whole, fraction] = toMajor(minor, coin).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function holdingText(minor: bigint, coin: PaymentCurrency): string {
  return `${coinAmount(minor, coin)} ${label(coin)}`;
}

/** Lamports as SOL (9 decimals), trailing zeros trimmed. */
function lamportsText(lamports: bigint): string {
  const digits = lamports.toString().padStart(10, "0");
  const fraction = digits.slice(-9).replace(/0+$/, "");
  return fraction ? `${digits.slice(0, -9)}.${fraction}` : digits.slice(0, -9);
}

function joinList(items: string[], word: "and" | "or"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

function because(clauses: string[]): string {
  return clauses.length ? ` because ${joinList(clauses, "and")}` : "";
}

/** Why a coin was refused, as a clause; `dest` is null when no quote named it. */
function refusal(verdict: RefusedCandidate["verdict"], coins: string, dest: string | null): string {
  switch (verdict) {
    case "unsupported":
      return `${coins} can't pay out ${dest ?? "to this destination"}`;
    case "unavailable":
      return `${coins} couldn't be priced right now`;
    case "amount_rejected":
      return `${coins} can't be used for this amount`;
    case "out_of_limits":
      return `this amount is outside the ${coins} limits`;
  }
}

/** Why `chosen` beat another priced coin that it outranked. */
function payoutClause(chosen: PricedCandidate, other: PricedCandidate, dest: string): string {
  const otherLabel = label(other.coin);
  if (chosen.destinationAmountMinor !== other.destinationAmountMinor) {
    return `it pays out more ${dest} than ${otherLabel}`;
  }
  if (compareFee(chosen.totalFeeMinor, other.totalFeeMinor) !== 0) {
    return `it has a lower fee than ${otherLabel}`;
  }
  return `it pays out the same as ${otherLabel}`;
}

/** Our clause, then Stables' own wording when it gave any. */
function withDetail(clause: string, detail: string | undefined): string {
  const text = (detail ?? "").trim().replace(/[\s.]+$/, "");
  return text ? `${capitalize(clause)}: ${text}.` : `${capitalize(clause)}.`;
}
