"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type State = "idle" | "loading" | "done";

/** Past this, the bar gives up rather than crawl forever over a navigation
 * that never reported arriving (a `?query` change, a cancelled load). */
const GIVE_UP_MS = 10_000;

/**
 * The thin bar along the top while the next page is on its way.
 *
 * Every page here is rendered on the server per request, and without a
 * `loading.tsx` — each page draws its own header, so a route fallback would
 * blank the header on every tap — a tap on a slow connection left the old page
 * sitting there with no sign the tap had been heard. In the iPhone app, where
 * there is no browser spinner either, that read as the app having frozen.
 *
 * The heaviest reading pages (the story, a day, the maps, the trip list) also
 * draw `components/RouteSkeleton.tsx` under their real header as soon as the
 * first bytes of the answer arrive. This bar still answers the tap before
 * that, and on every other page.
 *
 * **Why a document listener and not `useLinkStatus`.** That hook answers
 * inside one `<Link>` only, and the phone menu unmounts its links the moment
 * one is tapped — the hint would vanish exactly when it was needed. One
 * capture of every same-origin link click covers the menus, the trip cards
 * and the day links alike, with nothing to add to each of them.
 *
 * It starts on a plain left click of an in-site link to a different page and
 * finishes when the pathname changes. Anything else — a new tab, a download, a
 * `#fragment` on this page — never starts it. The movement is CSS transitions
 * (`.fs-nav-progress` in app/globals.css), which is what keeps this small:
 * a transition always starts from wherever the bar is, so "done" runs on from
 * the crawl without anybody measuring it, and the 150ms delay before the bar
 * shows means a page that arrives inside it goes to "done" still invisible —
 * a prefetched page never flashes a bar. `aria-hidden`: it duplicates what
 * the arriving page says for itself.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin) return;
      if (to.pathname === location.pathname && to.search === location.search) return;
      setState("loading");
    };
    // Coming back through the bfcache must not restore a bar mid-crawl.
    const onShow = () => setState("idle");
    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  // Arrived — adjusted during render rather than in an effect, the same
  // pattern GalleryGrid uses for its filter.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (state === "loading") setState("done");
  }

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), state === "done" ? 500 : GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return <div aria-hidden className="fs-nav-progress" data-state={state} />;
}
