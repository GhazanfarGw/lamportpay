/**
 * Admin server functions for the emergency controls: global payment pause,
 * per-currency (corridor) pause and per-corridor limits, for the ACTIVE mode only
 * (TEST rules and LIVE rules are stored separately). Admin-only, audited, and
 * enforced on the server (service.server assertPaymentsOpen, corridor limits).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActions } from "./admin.audit.server";
import type { ModeControls } from "./payments/controls";

type AdminContext = {
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => unknown };
  userId: string;
  claims?: unknown;
};

async function requireAdmin(context: AdminContext) {
  const { data: isAdmin, error } = (await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  })) as { data: boolean | null; error: unknown };
  if (error) throw new Error("Could not verify admin access.");
  if (!isAdmin) throw new Error("Admin role required.");
}

const minor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
const corridorSchema = z
  .object({
    paused: z.boolean(),
    reason: z.string().trim().max(300).nullable(),
    min_minor: minor,
    max_minor: minor,
  })
  .strict();
const controlsSchema = z
  .object({
    paused: z.boolean(),
    reason: z.string().trim().max(300).nullable(),
    corridors: z.record(z.string().regex(/^[A-Za-z]{3}$/), corridorSchema),
  })
  .strict();

/** The active mode and its controls. */
export const getPaymentControlsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { getBusinessSettings, activeControls } = await import("@/lib/business-settings.server");
    const { currentMode } = await import("@/lib/app-mode.server");
    const mode = currentMode().mode;
    const settings = await getBusinessSettings();
    return {
      mode,
      controls: activeControls(settings, mode) as ModeControls,
      coinLimits: settings.paymentLimits,
    };
  });

/** Replace the active mode's controls. A reason is required for every change. */
export const updatePaymentControlsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ controls: controlsSchema, note: z.string().trim().min(3).max(300) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabase, userId, claims } = context;
    const actor = { id: userId, email: (claims as { email?: string } | null)?.email ?? null };
    const { updateBusinessSettings, activeControls } =
      await import("@/lib/business-settings.server");
    const { currentMode } = await import("@/lib/app-mode.server");
    const mode = currentMode().mode;

    let result;
    try {
      result = await updateBusinessSettings(
        { paymentControls: { mode, controls: data.controls } },
        userId,
      );
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Could not save the controls.");
    }
    const before = activeControls(result.before, mode);
    const after = activeControls(result.after, mode);
    await logAdminActions(supabase, actor, [
      {
        entityType: "business_settings",
        entityReference: `payment_controls:${mode}`,
        action:
          before.paused !== after.paused
            ? after.paused
              ? "payments_paused"
              : "payments_resumed"
            : "payment_controls_changed",
        field: "payment_controls",
        oldValue: JSON.stringify(before),
        newValue: JSON.stringify(after),
        note: data.note,
      },
    ]);
    console.warn(
      JSON.stringify({
        event: "payment_controls_changed",
        mode,
        paused: after.paused,
        paused_corridors: Object.entries(after.corridors)
          .filter(([, r]) => r.paused)
          .map(([c]) => c),
        limited_corridors: Object.entries(after.corridors)
          .filter(([, r]) => r.min_minor !== null || r.max_minor !== null)
          .map(([c]) => c),
      }),
    );
    return { mode, controls: after };
  });
