/**
 * Browser client for the payment API. Attaches the signed-in user's Supabase
 * access token; the server verifies it on every call.
 */
import { supabase } from "@/integrations/supabase/client";

/** A recipient field the payout partner flagged, in its snake_case naming. */
export type FieldIssue = { field: string | null; message: string };

export class PaymentApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The partner's own wording, when the server passes it on. */
    readonly reason?: string,
    readonly fields: FieldIssue[] = [],
  ) {
    super(message);
    this.name = "PaymentApiError";
  }
}

type ErrorBody = { error?: string; code?: string; reason?: string; fields?: FieldIssue[] };

export async function paymentApi<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<{ status: number; data: T }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new PaymentApiError("Sign in to continue.", 401);

  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) {
    throw new PaymentApiError(
      data.error ?? `Request failed (${res.status}).`,
      res.status,
      data.code,
      data.reason,
      Array.isArray(data.fields) ? data.fields : [],
    );
  }
  return { status: res.status, data };
}
