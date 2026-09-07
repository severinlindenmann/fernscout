"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markInAppHistory } from "./useBackHistory";

/**
 * Marks the first client-side navigation in this tab — B822.
 *
 * Mounted once, in `app/layout.tsx`, so it sees every route this app has:
 * the root layout does not remount on a client navigation, so this stays
 * alive across the whole visit and its `usePathname()` dependency fires
 * again each time the pathname actually changes. The very first pathname it
 * sees is left unmarked — that one page came from wherever the tab came
 * from, in-app or not — and every pathname after it means this app itself
 * navigated somewhere, which is exactly what a back arrow needs to know
 * before trusting `router.back()`. Renders nothing.
 */
export default function BackTracker() {
  const pathname = usePathname();
  const first = useRef(pathname);

  useEffect(() => {
    if (pathname !== first.current) markInAppHistory();
  }, [pathname]);

  return null;
}
