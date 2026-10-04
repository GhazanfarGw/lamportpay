import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { recordSwitchRequest } from "@/lib/app-mode-log.server";
import { currentMode, publicModeStatus } from "@/lib/app-mode.server";
import { authenticateUser } from "@/lib/payments/auth.server";
import { allow, clientKey } from "@/lib/payments/rate-limit.server";

const Input = z.object({ to: z.enum(["test", "live"]) }).strict();

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/mode/switch-request — the app asks to go to the other mode.
 *
 * This NEVER changes the server's mode: the mode is fixed by the deployment's
 * environment. The answer says whether the other mode exists (and its URL, for
 * a configured and approved live deployment). Every request is audited.
 */
export const Route = createFileRoute("/api/mode/switch-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string | null = null;
        if (request.headers.get("authorization")) {
          const auth = await authenticateUser(request);
          if (auth.denied) return auth.denied;
          userId = auth.user.id;
        }
        if (!allow("mode-switch", clientKey(request, userId), 10)) {
          return Response.json({ error: "Too many requests." }, { status: 429, headers: NO_STORE });
        }
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: NO_STORE });
        }
        const parsed = Input.safeParse(raw);
        if (!parsed.success) {
          return Response.json(
            { error: "to must be test or live." },
            { status: 400, headers: NO_STORE },
          );
        }

        const status = currentMode();
        const to = parsed.data.to;
        let allowed = false;
        let url: string | null = null;
        let reasons: string[];
        if (to === status.mode) {
          reasons = [`Already in ${to.toUpperCase()} MODE.`];
        } else if (to === "live") {
          allowed = status.liveAvailable && Boolean(status.liveUrl);
          url = allowed ? status.liveUrl : null;
          reasons = allowed ? [] : publicModeStatus(status).liveBlockers;
        } else {
          url = process.env["LAMPORTPAY_TEST_URL"]?.trim() || null;
          allowed = Boolean(url);
          reasons = allowed ? [] : ["No separate test app is configured."];
        }
        // Audit with the full (internal) reasons.
        await recordSwitchRequest({
          userId,
          from: status.mode,
          to,
          allowed,
          reasons: to === "live" && !allowed ? status.liveBlockers : reasons,
        });
        return Response.json(
          { from: status.mode, to, allowed, url, reasons, modeChanged: false },
          { headers: NO_STORE },
        );
      },
    },
  },
});
