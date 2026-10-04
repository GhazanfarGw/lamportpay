/**
 * Audit trail for TEST / LIVE mode (append-only table app_mode_events):
 * - mode_observed: the first time a server process reports a mode/state that
 *   differs from the last recorded one (i.e. the deployment's mode changed).
 * - switch_requested: someone asked, from the app, to switch to LIVE MODE,
 *   with the server's answer. Switching never happens from the browser.
 * Best-effort: a logging failure never changes the mode or unblocks anything.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AppMode, ModeStatus } from "./app-mode";

let observedKey: string | null = null;

export async function recordModeObserved(status: ModeStatus): Promise<void> {
  const key = `${status.mode}:${status.ok}`;
  if (observedKey === key) return;
  observedKey = key;
  try {
    const { data: last } = await supabaseAdmin
      .from("app_mode_events")
      .select("mode, ok")
      .eq("event", "mode_observed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last && last.mode === status.mode && last.ok === status.ok) return;
    const { error } = await supabaseAdmin.from("app_mode_events").insert({
      event: "mode_observed",
      mode: status.mode,
      ok: status.ok,
      detail: {
        previous: last ? { mode: last.mode, ok: last.ok } : null,
        problems: status.problems,
        solana_cluster: status.solanaCluster,
        stables_environment: status.stablesEnvironment,
      },
    });
    if (error) throw new Error(error.message);
    console.warn(`[mode] recorded mode change → ${status.mode} (ok=${status.ok})`);
  } catch (e) {
    observedKey = null; // retry on the next call
    console.error("[mode] could not record mode:", e instanceof Error ? e.message : e);
  }
}

export async function recordSwitchRequest(p: {
  userId: string | null;
  from: AppMode;
  to: AppMode;
  allowed: boolean;
  reasons: string[];
}): Promise<void> {
  const { error } = await supabaseAdmin.from("app_mode_events").insert({
    event: "switch_requested",
    mode: p.from,
    ok: p.allowed,
    user_id: p.userId,
    detail: { to: p.to, allowed: p.allowed, reasons: p.reasons },
  });
  if (error) console.error("[mode] could not record switch request:", error.message);
}
