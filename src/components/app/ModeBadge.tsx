/**
 * TEST MODE / LIVE MODE indicator for the app header, with the mode switch.
 *
 * The badge shows ONLY what the server reports. "Switch" never changes the
 * server: it asks the server whether a separate deployment for the other mode
 * exists (and is approved), after an explicit confirmation, and only then
 * navigates there. Every request is audited server-side.
 */
import { AlertTriangle, FlaskConical, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { paymentApi } from "@/lib/payments/api-client";
import { useModeStatus } from "@/lib/use-mode-status";

const TONE: Record<string, string> = {
  test: "border-amber-500/50 bg-amber-400/15 text-amber-700 dark:text-amber-300",
  live: "border-red-600/60 bg-red-600 text-white",
  error: "border-red-600/60 bg-red-600/10 text-red-700",
  loading: "border-border bg-muted text-muted-foreground",
};

type SwitchAnswer = { allowed: boolean; url: string | null; reasons: string[] };

export function ModeBadge() {
  const { status, indicator } = useModeStatus();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<SwitchAnswer | null>(null);
  const target = status?.mode === "live" ? "test" : "live";

  const requestSwitch = async () => {
    setBusy(true);
    try {
      const { data } = await paymentApi<SwitchAnswer>("/api/mode/switch-request", {
        method: "POST",
        allowAnonymous: true,
        body: { to: target },
      });
      if (data.allowed && data.url) {
        window.location.assign(data.url);
        return;
      }
      setAnswer(data);
    } catch (e) {
      setAnswer({
        allowed: false,
        url: null,
        reasons: [e instanceof Error ? e.message : "The mode switch could not be checked."],
      });
    } finally {
      setBusy(false);
    }
  };

  const Icon =
    indicator.tone === "test" ? FlaskConical : indicator.tone === "loading" ? Loader2 : ShieldAlert;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${indicator.label}. ${indicator.detail}`}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-extrabold tracking-wider ${TONE[indicator.tone]}`}
      >
        <Icon className={`w-3.5 h-3.5 ${indicator.tone === "loading" ? "animate-spin" : ""}`} />
        {indicator.label}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-card p-3 text-sm shadow-[var(--shadow-elegant)] space-y-3">
            <div>
              <div className="font-semibold">{indicator.label}</div>
              <p className="mt-1 text-xs text-muted-foreground">{indicator.detail}</p>
              {status && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Solana {status.solanaCluster} · payout partner {status.stablesEnvironment} · set
                  by the server
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={!status}
              onClick={() => {
                setOpen(false);
                setAnswer(null);
                setConfirming(true);
              }}
              className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs font-semibold hover:bg-secondary disabled:opacity-50"
            >
              Switch to {target.toUpperCase()} MODE…
              {target === "live" && !status?.liveAvailable && (
                <span className="block font-normal text-muted-foreground">
                  Not available yet: needs production setup and owner approval.
                </span>
              )}
            </button>
          </div>
        </>
      )}

      <AlertDialog open={confirming} onOpenChange={(v) => !busy && setConfirming(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Switch to {target.toUpperCase()} MODE?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {target === "live" ? (
                  <>
                    <p>
                      <strong>LIVE MODE moves real funds</strong> on Solana mainnet, with the
                      production payout partner. Every payment and swap is real and cannot be
                      undone.
                    </p>
                    <p>
                      Live mode is a separate app with its own configuration. Switching opens it;
                      nothing in this test app changes.
                    </p>
                  </>
                ) : (
                  <p>TEST MODE is a separate app using devnet test assets and the sandbox.</p>
                )}
                {answer && !answer.allowed && (
                  <div className="rounded-lg border border-red-600/30 bg-red-600/10 px-3 py-2 text-red-700">
                    {target.toUpperCase()} MODE is not available. {answer.reasons.join(" ")}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              Stay in {status?.mode.toUpperCase() ?? "this"} MODE
            </AlertDialogCancel>
            {!answer && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestSwitch()}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}I understand, switch
              </button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Extra warning before any wallet approval that moves real funds (LIVE MODE only). */
export function LiveFundsWarning() {
  const { status } = useModeStatus();
  if (status?.mode !== "live") return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-600/50 bg-red-600/10 px-3 py-2 text-xs font-medium text-red-700"
    >
      <ShieldAlert className="w-4 h-4 shrink-0" />
      LIVE MODE: approving in your wallet moves real funds on Solana mainnet. It cannot be undone.
    </div>
  );
}
