"use client";

import { useEffect, useState } from "react";
import { useStudioOnline } from "@/components/studio/StudioBar";

/**
 * B2331 — wired to `useOutbox`'s own `/api/health` probe (via
 * `StudioBarProvider`'s context, `useStudioOnline`) rather than only
 * `navigator.onLine`: the pill and every greyed "needs a signal" feature
 * (`PolishText`, `PublishDayFlow`, `NewTripFlow`, `AddDayFlow`,
 * `FigureCreator`, the planner's `Composer`) now agree — the wifi being up
 * with this server's own `next start` dead greys the same features the pill
 * already calls "offline", instead of a feature staying lit for a server
 * nobody can reach.
 *
 * `useStudioOnline()` answers `null` only outside `StudioBarProvider` (a
 * component mounted on its own, with no studio page around it — mostly a
 * test), where this falls back to the plain `navigator.onLine` listener it
 * always had, so nothing outside the studio breaks and no test needs a
 * provider it was never given.
 */
export function useOnline(): boolean {
  const shared = useStudioOnline();
  const [interfaceOnline, setInterfaceOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    if (shared !== null) return;
    const onOnline = () => setInterfaceOnline(true);
    const onOffline = () => setInterfaceOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [shared]);
  return shared ?? interfaceOnline;
}
