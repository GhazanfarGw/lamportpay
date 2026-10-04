/** Shared plumbing for the payment API routes: auth, JSON bodies, error mapping. */
import type { z } from "zod";

import { ModeGuardError, requireModeProfile } from "@/lib/app-mode.server";
import { authenticateUser, type AuthenticatedUser } from "./auth.server";
import { allow, clientKey } from "./rate-limit.server";
import { PaymentError } from "./service.server";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function errorResponse(error: unknown): Response {
  if (error instanceof ModeGuardError) {
    return json({ error: error.message, code: "mode_endpoint_blocked" }, 403);
  }
  if (error instanceof PaymentError) {
    return json(
      { error: error.message, ...(error.code && { code: error.code }), ...error.extra },
      error.status,
    );
  }
  console.error("[payments] unexpected error", error);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

/** Run `handler` for an authenticated user, with `schema`-validated JSON when given. */
export async function handleUserRequest<S extends z.ZodTypeAny | undefined>(
  request: Request,
  schema: S,
  handler: (
    user: AuthenticatedUser,
    body: S extends z.ZodTypeAny ? z.infer<S> : undefined,
  ) => Promise<Response>,
): Promise<Response> {
  try {
    // Server-side mode check first: a misconfigured TEST/LIVE deployment
    // serves no payment action at all (no silent fallback to the other mode).
    requireModeProfile();
    const auth = await authenticateUser(request);
    if (auth.denied) return auth.denied;

    let body: unknown = undefined;
    if (schema) {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return json({ error: "Invalid JSON body." }, 400);
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
        return json({ error: `${where}${issue?.message ?? "Invalid request."}` }, 400);
      }
      body = parsed.data;
    }
    return await handler(auth.user, body as S extends z.ZodTypeAny ? z.infer<S> : undefined);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * A public, read-only endpoint: works signed out; uses the user when a valid
 * token is sent. Rate limited per user / IP (`limitPerMinute`). JSON body
 * validated with `schema`.
 */
export async function handlePublicRequest<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  bucket: string,
  limitPerMinute: number,
  handler: (user: AuthenticatedUser | null, body: z.infer<S>) => Promise<Response>,
): Promise<Response> {
  try {
    requireModeProfile();
    let user: AuthenticatedUser | null = null;
    if (request.headers.get("authorization")) {
      const auth = await authenticateUser(request);
      if (auth.denied) return auth.denied;
      user = auth.user;
    }
    if (!allow(bucket, clientKey(request, user?.id ?? null), limitPerMinute)) {
      return json(
        { error: "Too many requests. Wait a moment and try again.", code: "rate_limited" },
        429,
      );
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return json({ error: `${where}${issue?.message ?? "Invalid request."}` }, 400);
    }
    return await handler(user, parsed.data);
  } catch (error) {
    return errorResponse(error);
  }
}
