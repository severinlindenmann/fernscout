"use client";

import { useEffect, useState } from "react";

/**
 * Whether this tab has an in-app page before the current one — B822.
 *
 * Set by `BackTracker` (mounted once, in the root layout) the first time a
 * client-side navigation happens in this tab. `sessionStorage` is already
 * per-tab, which is exactly the scope wanted: a reader who opened a day from
 * an email has no in-app page before it, and a reader three taps deep does.
 *
 * `document.referrer` does not update across a soft navigation and
 * `history.length` counts entries from whatever else loaded in the tab
 * before this app did — both ruled out for that reason. This is a flag this
 * app sets itself, so it only ever answers about this app's own history.
 */
export const BACK_HISTORY_KEY = "fs.backHistory";

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(BACK_HISTORY_KEY) === "1";
  } catch {
    // Storage blocked (private mode, some embedded webviews) — treat as a
    // fresh tab, which is the safe direction: it means a fallback, never a
    // `router.back()` that could leave the site.
    return false;
  }
}

export function markInAppHistory(): void {
  try {
    sessionStorage.setItem(BACK_HISTORY_KEY, "1");
  } catch {
    // Nothing to do — the next read stays false and every back arrow falls
    // back to its fixed parent, same as today.
  }
}

/**
 * Read at mount rather than during render: the flag lives in
 * `sessionStorage`, which the server never sees, so answering `true` on the
 * very first render a deep arrival gets would be a hydration mismatch. The
 * cost is one render assuming deep-arrival before correcting itself, which is
 * also the safe direction to be wrong in.
 */
export function useHasInAppHistory(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHas(readFlag());
  }, []);
  return has;
}
