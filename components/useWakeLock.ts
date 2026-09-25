"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps the screen from sleeping while `active` is true — for a slideshow
 * meant to run unattended on a TV, a screen that locks itself mid-show is a
 * worse failure than almost anything else here.
 *
 * `navigator.wakeLock` is unsupported on Safari as of this writing (and
 * gated behind document-visibility rules everywhere it exists), so this
 * always feature-detects and treats every failure — missing API, denied
 * permission, a request that resolves after the tab already lost focus — as
 * a silent no-op. The show goes on regardless; the screen just might sleep.
 */
export function useWakeLock(active: boolean): void {
  const lockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await lock.release();
          return;
        }
        lockRef.current = lock;
      } catch {
        // Denied, unsupported mid-flight, or the document wasn't visible
        // when the request resolved — nothing to do but try again later.
      }
    };

    acquire();

    // The lock is released automatically whenever the tab is hidden (e.g.
    // switching apps mid-show) and does not come back on its own.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !lockRef.current) acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}
