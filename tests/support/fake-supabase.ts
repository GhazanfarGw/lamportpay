/**
 * In-memory stand-in for the service-role Supabase client, covering the query
 * builder subset the payment ledger uses. Enforces the unique constraints and
 * the status check the real schema has, so conflicts behave like Postgres
 * (error code 23505).
 */
import { randomUUID } from "node:crypto";

import { PAYMENT_STATES } from "@/lib/payments/state";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

const now = () => new Date().toISOString();

const DEFAULTS: Record<string, () => Row> = {
  payments: () => ({
    id: randomUUID(),
    status: "PAYMENT_CREATED",
    pre_hold_status: null,
    source_currency: "usdc",
    source_network: "solana",
    destination_amount_minor: null,
    exchange_rate: null,
    fees: null,
    stables_customer_id: null,
    quote_id: null,
    quote_expires_at: null,
    quote_snapshot: null,
    transfer_id: null,
    transfer_snapshot: null,
    purpose_code: null,
    beneficiary_summary: null,
    deposit_address: null,
    deposit_amount_minor: null,
    deposit_currency: null,
    deposit_network: null,
    funding_signature: null,
    funding_payer: null,
    funding_verified_at: null,
    failure_reason: null,
    actual_payout_minor: null,
    actual_payout_currency: null,
    payer_wallet: null,
    platform_fee_bps: null,
    platform_fee_minor: null,
    platform_fee_wallet: null,
    platform_fee_received_minor: null,
    reconciled_at: null,
    travel_rule_reference: null,
    travel_rule_verification_url: null,
    travel_rule_expires_at: null,
    travel_rule_requested_at: null,
    travel_rule_resolved_at: null,
    created_at: now(),
    updated_at: now(),
  }),
  business_settings: () => ({
    id: true,
    conversion_fee_bps: null,
    swap_fee_bps: null,
    revenue_wallet: null,
    enabled_currencies: null,
    updated_at: now(),
    updated_by: null,
  }),
  payment_events: () => ({ detail: null, from_status: null, to_status: null, created_at: now() }),
  stables_customers: () => ({
    verification_status: null,
    verification_sub_status: null,
    base_payout_status: null,
    kyc_link: null,
    kyc_link_expires_at: null,
    first_name: null,
    last_name: null,
    created_at: now(),
    updated_at: now(),
  }),
  payment_swaps: () => ({
    id: randomUUID(),
    status: "ordered",
    slippage_bps: null,
    price_impact_pct: null,
    last_valid_block_height: null,
    signature: null,
    jupiter_status: null,
    jupiter_error: null,
    actual_in_minor: null,
    actual_out_minor: null,
    failure_reason: null,
    created_at: now(),
    updated_at: now(),
  }),
  jupiter_swap_orders: () => ({
    id: randomUUID(),
    status: "ordered",
    relayed_at: null,
    signature: null,
    jupiter_status: null,
    jupiter_error: null,
    created_at: now(),
    updated_at: now(),
  }),
  stables_webhook_events: () => ({
    event_object_id: null,
    event_object_status: null,
    received_at: now(),
    processed_at: null,
    process_error: null,
  }),
};

const UNIQUE: Record<string, string[]> = {
  payments: ["id", "transfer_id", "funding_signature"],
  payment_events: ["id"],
  stables_customers: ["user_id", "stables_customer_id"],
  stables_webhook_events: ["event_id"],
  payment_swaps: ["id", "jupiter_request_id", "signature"],
  jupiter_swap_orders: ["id", "jupiter_request_id", "signature"],
};

const TOUCHES_UPDATED_AT = new Set(["payments", "stables_customers", "payment_swaps"]);

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private payload: Row | Row[] = {};
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean; nullsFirst: boolean } | null = null;
  private max: number | null = null;
  private returning = false;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns?: string) {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  upsert(row: Row, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = row;
    this.upsertOptions = options;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  not(column: string, operator: "is", value: null) {
    if (operator !== "is") throw new Error(`fake-supabase: unsupported not(${operator})`);
    this.filters.push((r) => (r[column] ?? null) !== value);
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((r) => String(r[column]) >= value);
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((r) => String(r[column]) <= value);
    return this;
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orderBy = {
      column,
      ascending: options.ascending ?? true,
      nullsFirst: options.nullsFirst ?? !(options.ascending ?? true),
    };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private rows(): Row[] {
    return this.db.table(this.table);
  }

  private matching(): Row[] {
    return this.rows().filter((r) => this.filters.every((f) => f(r)));
  }

  private violation(candidate: Row, self?: Row): Result | null {
    for (const column of UNIQUE[this.table] ?? []) {
      const value = candidate[column];
      if (value === null || value === undefined) continue;
      if (this.rows().some((r) => r !== self && r[column] === value)) {
        return {
          data: null,
          error: { code: "23505", message: `duplicate key value violates unique (${column})` },
        };
      }
    }
    if (this.table === "payment_swaps") {
      const others = this.rows().filter(
        (r) => r !== self && r["payment_id"] === candidate["payment_id"],
      );
      if (others.some((r) => r["attempt"] === candidate["attempt"])) {
        return {
          data: null,
          error: { code: "23505", message: "payment_swaps_payment_id_attempt_key" },
        };
      }
      // Partial unique index: one in-flight (submitted) swap per payment.
      if (candidate["status"] === "submitted" && others.some((r) => r["status"] === "submitted")) {
        return { data: null, error: { code: "23505", message: "payment_swaps_one_in_flight" } };
      }
    }
    if (
      this.table === "payments" &&
      !(PAYMENT_STATES as readonly unknown[]).includes(candidate["status"])
    ) {
      return { data: null, error: { code: "23514", message: "payments_status_check" } };
    }
    return null;
  }

  private shape(rows: Row[]): Result {
    const copies = rows.map((r) => structuredClone(r));
    if (this.mode === "many") return { data: copies, error: null };
    if (copies.length > 1)
      return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    if (copies.length === 0) {
      return this.mode === "single"
        ? { data: null, error: { code: "PGRST116", message: "no rows" } }
        : { data: null, error: null };
    }
    return { data: copies[0], error: null };
  }

  private insertRow(input: Row): Row | Result {
    const row: Row = { ...DEFAULTS[this.table]!(), ...structuredClone(input) };
    if (this.table === "payment_events") row["id"] = this.db.nextId();
    const conflict = this.violation(row);
    if (conflict) return conflict;
    this.rows().push(row);
    return row;
  }

  private execute(): Result {
    switch (this.op) {
      case "select": {
        let rows = this.matching();
        if (this.orderBy) {
          const { column, ascending, nullsFirst } = this.orderBy;
          rows = [...rows].sort((a, b) => {
            const x = a[column] ?? null;
            const y = b[column] ?? null;
            if (x === y) return 0;
            if (x === null) return nullsFirst ? -1 : 1;
            if (y === null) return nullsFirst ? 1 : -1;
            return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          });
        }
        if (this.max !== null) rows = rows.slice(0, this.max);
        return this.shape(rows);
      }
      case "insert": {
        const inserted: Row[] = [];
        for (const input of Array.isArray(this.payload) ? this.payload : [this.payload]) {
          const row = this.insertRow(input);
          if ("error" in row && "data" in row) return row as Result;
          inserted.push(row as Row);
        }
        return this.returning ? this.shape(inserted) : { data: null, error: null };
      }
      case "update": {
        const targets = this.matching();
        for (const row of targets) {
          const next = { ...row, ...structuredClone(this.payload as Row) };
          if (TOUCHES_UPDATED_AT.has(this.table)) next["updated_at"] = now();
          const conflict = this.violation(next, row);
          if (conflict) return conflict;
        }
        for (const row of targets) {
          Object.assign(row, structuredClone(this.payload as Row));
          if (TOUCHES_UPDATED_AT.has(this.table)) row["updated_at"] = now();
        }
        return this.returning ? this.shape(targets) : { data: null, error: null };
      }
      case "upsert": {
        const input = this.payload as Row;
        const keys = (this.upsertOptions.onConflict ?? "id").split(",").map((k) => k.trim());
        const existing = this.rows().find((r) => keys.every((k) => r[k] === input[k]));
        if (existing) {
          if (this.upsertOptions.ignoreDuplicates) {
            return this.returning ? this.shape([]) : { data: null, error: null };
          }
          const next = { ...existing, ...structuredClone(input) };
          const conflict = this.violation(next, existing);
          if (conflict) return conflict;
          Object.assign(existing, structuredClone(input));
          if (TOUCHES_UPDATED_AT.has(this.table)) existing["updated_at"] = now();
          return this.returning ? this.shape([existing]) : { data: null, error: null };
        }
        const row = this.insertRow(input);
        if ("error" in row && "data" in row) return row as Result;
        return this.returning ? this.shape([row as Row]) : { data: null, error: null };
      }
    }
  }
}

export class FakeSupabase {
  readonly tables = new Map<string, Row[]>();
  private sequence = 0;

  from(table: string) {
    if (!DEFAULTS[table]) throw new Error(`fake-supabase: unknown table ${table}`);
    return new Query(this, table);
  }

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) this.tables.set(name, (rows = []));
    return rows;
  }

  nextId(): number {
    return ++this.sequence;
  }

  reset() {
    this.tables.clear();
    this.sequence = 0;
  }
}

export function createFakeSupabase() {
  return new FakeSupabase();
}
