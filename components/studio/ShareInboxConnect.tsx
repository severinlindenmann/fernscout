"use client";

import { useEffect, useState } from "react";
import { connectShareInbox, shareInboxStatus, useNativeShell } from "@/components/nativeShell";

/** Fewer than this many days left and the studio quietly mints a new token. */
const REFRESH_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The iPhone's credential for Photos → Share → Fernscout — B2175, automatic
 * since B2182, silent since B2206, a switch on /me since B2208. Inside the shell the studio hub and the
 * owner's /me page both run this: the first open mints the owner's own
 * agent key and hands it to the extension, every later open refreshes it
 * with under three days left. It also hands over the trip list, so the
 * share sheet's picker has its rows before the first share ever (B2206:
 * "Trips took a moment to load"). The web never runs it.
 */
export function useShareInboxAutoConnect(username: string): "unknown" | "busy" | "on" | "off" | "failed" {
  const native = useNativeShell();
  const [state, setState] = useState<"unknown" | "busy" | "on" | "off" | "failed">("unknown");
  useEffect(() => {
    if (!native) return;
    let live = true;
    (async () => {
      try {
        const s = await shareInboxStatus();
        if (!live) return;
        const left = new Date(s.expiresAt ?? 0).getTime() - Date.now();
        const usable = s.connected && s.user === username && left >= REFRESH_BEFORE_MS;
        if (!usable) {
          setState("busy");
          await connectShareInbox(username);
        }
        if (live) setState("on");
      } catch {
        if (live) setState("failed");
      }
    })();
    return () => {
      live = false;
    };
  }, [native, username]);
  return native ? state : "unknown";
}
