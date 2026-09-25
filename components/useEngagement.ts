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

    // Visible time is banked on each visibility change rather than sampled
    // once a second. This used to be a one-second interval on every journal
    // page for as long as the reader had not yet engaged — for somebody who
    // reads without scrolling, the whole visit. Now nothing runs on a clock
    // until there is something to wait for: one timeout for exactly the dwell
    // still owed, armed once the reader has acted and only while the tab is in
    // front.
    let dwelled = 0;
    let visibleSince: number | null = document.visibilityState === "visible" ? Date.now() : null;
    let timer: number | undefined;

    // A navigation inside the journal — the story pager's day links, a trip,
    // the gallery — is the clearest "I am reading this" there is.
    let acted = pathname !== startPath.current;

    const arm = () => {
      window.clearTimeout(timer);
      if (!acted || visibleSince === null) return;
      const remaining = DWELL_MS - (dwelled + Date.now() - visibleSince);
      if (remaining <= 0) setEngaged(true);
      // Re-checked when it fires rather than trusted: a timer in a tab that
      // has just been put in the background can fire late.
      else timer = window.setTimeout(arm, remaining);
    };

    const onVisibility = () => {
      const now = Date.now();
      if (visibleSince !== null) dwelled += now - visibleSince;
      visibleSince = document.visibilityState === "visible" ? now : null;
      arm();
    };

    const onScroll = () => {
      if (window.scrollY < SCROLL_PX) return;
      acted = true;
      // One screen is the whole question; the rest of the reading need not
      // keep calling in.
      window.removeEventListener("scroll", onScroll);
      arm();
    };

    if (!acted) window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    arm();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [engaged, pathname]);

  return engaged;
}
