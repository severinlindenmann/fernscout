"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Has this reader actually read anything?
 *
 * Two signals, either of which counts, both gated behind visible dwell time:
 * they scrolled a screen's worth, or they moved to another page inside the
 * journal. A timer alone would fire at somebody who opened a tab and walked
 * away, which is the reader least likely to want anything asked of them.
 *
 * Written for `PushPrompt` (B440) and lifted out of it whole in B1718, when
 * the showcase bar needed the same question answered the same way. Two
 * definitions of "has read something" drift, and the one that drifts is the
 * one whose card starts appearing at people who have read nothing.
 */

/** How long a reader has to have been *looking* at the page, tab in front,
 * before the ask is earned. Paused while the tab is in the background, so a
 * journal left open in another window never qualifies on its own. */
const DWELL_MS = 15_000;
/** And how far they have to have scrolled, if they have not navigated. */
const SCROLL_PX = 300;

export function useEngagement(): boolean {
  const pathname = usePathname();
  const startPath = useRef(pathname);
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    if (engaged) return;

    let dwelled = 0;
    let last = Date.now();
    let acted = false;

    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === "visible") dwelled += now - last;
      last = now;
      if (acted && dwelled >= DWELL_MS) setEngaged(true);
    };

    const onScroll = () => {
      if (window.scrollY >= SCROLL_PX) acted = true;
    };

    // A navigation inside the journal — the story pager's day links, a trip,
    // the gallery — is the clearest "I am reading this" there is.
    if (pathname !== startPath.current) acted = true;

    const timer = window.setInterval(tick, 1000);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [engaged, pathname]);

  return engaged;
}
