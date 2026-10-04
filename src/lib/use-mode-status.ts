/**
 * The server's TEST / LIVE mode, as reported by /api/integration-status
 * (same query as the /pay page, so it is fetched once). Display only: the
 * server enforces the mode on every call.
 */
import { useQuery } from "@tanstack/react-query";

import { clientBuildMode, modeIndicator, type ModeIndicator, type ModeStatus } from "./app-mode";

export function useModeStatus(): { status: ModeStatus | null; indicator: ModeIndicator } {
  const query = useQuery({
    queryKey: ["integration-status"],
    queryFn: async () => {
      const res = await fetch("/api/integration-status");
      return (await res.json()) as { mode?: ModeStatus };
    },
    staleTime: 30_000,
  });
  const status = query.data?.mode ?? null;
  if (query.isError) {
    return {
      status: null,
      indicator: {
        tone: "error",
        label: "MODE UNKNOWN",
        detail: "The server mode could not be checked. Payments are blocked until it can.",
        blocking: true,
      },
    };
  }
  return { status, indicator: modeIndicator(status, clientBuildMode()) };
}
