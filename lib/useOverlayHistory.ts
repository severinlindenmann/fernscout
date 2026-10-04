"use client";

import { useCallback, useEffect, useId, useRef } from "react";

const KEY = "fernscoutOverlay";

/**
 * What closing should do: pop the entry we pushed (when it is still the
 * current one) or just close in place. Pure so it can be tested (B-2852).
 */
export function closeAction(pushed: boolean, state: unknown, id: string): "back" | "direct" {
  const mine = typeof state === "object" && state !== null && (state as Record<string, unknown>)[KEY] === id;
  return pushed && mine ? "back" : "direct";
}

/** After a close that was not Back or X: is our entry still on top and worth popping? */
export function isStaleEntry(live: boolean, pushed: boolean, state: unknown, id: string): boolean {
  return !live && closeAction(pushed, state, id) === "back";
}

/**
 * A full-screen overlay as one history step, so the phone's edge swipe / the
 * browser Back closes the overlay and not the page behind it. Returns the
 * close function to use for X and Escape. `push: false` is for an overlay that
 * was the entry point (`?show=1`): closing then never leaves the page.
 * Next's own `history.state` is spread, not replaced.
 */
export function useOverlayHistory(open: boolean, onClose: () => void, push = true): () => void {
  const id = { current: useId() };
  const pushed = useRef(false);
  const live = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open || !push) return;
    // Strict mode runs effects twice; the second run finds its own entry.
    if (closeAction(true, window.history.state, id.current) === "direct") {
      window.history.pushState({ ...window.history.state, [KEY]: id.current }, "");
    }
    pushed.current = true;
    live.current = true;
    const onPop = () => {
      if (closeAction(true, window.history.state, id.current) === "back") return;
      pushed.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      live.current = false;
      // The parent closed it (not Back, not X): drop our entry so the next Back
      // is not a no-op. Deferred a tick so a strict-mode re-run can keep it.
      setTimeout(() => {
        if (!isStaleEntry(live.current, pushed.current, window.history.state, id.current)) return;
        pushed.current = false;
        window.history.back();
      }, 0);
    };
  }, [open, push]);

  return useCallback(() => {
    if (closeAction(pushed.current, window.history.state, id.current) === "back") {
      // The X sits inside a backdrop that also closes: a second call must not pop a second entry.
      pushed.current = false;
      window.history.back();
    } else onCloseRef.current();
  }, []);
}
