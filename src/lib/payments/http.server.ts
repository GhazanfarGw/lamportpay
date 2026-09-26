/** Shared plumbing for the payment API routes: auth, JSON bodies, error mapping. */
import type { z } from "zod";

import { authenticateUser, type AuthenticatedUser } from "./auth.server";
import { PaymentError } from "./service.server";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function errorResponse(error: unknown): Response {
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
