"use client";

import { usePathname } from "next/navigation";
import ReaderNotice from "./ReaderNotice";
import { useSite } from "./SiteProvider";

/**
 * The 404 inside somebody's journal.
 *
 * The journal itself exists — its layout rendered, which is why `useSite()`
 * works here and not in the root 404 — so the reader is one link away from
 * what they wanted, and the page's whole job is to hand them that link rather
 * than a dead end.
 *
 * `not-found.tsx` takes no props, so the *kind* of miss is read from the path:
 * a missing day and a missing trip send people to different places, and
 * telling somebody chasing `/alex/day/hoi-ann` to look at the trip list is
 * a wasted tap.
 */
export default function JournalNotFoundNotice() {
  const site = useSite();
  const pathname = usePathname();
  // Checked before "/trips/", because a photobook route sits under a trip's
  // own path and would otherwise read as the trip itself being gone — B1294.
  const kind = pathname.endsWith("/photobook")
    ? "photobook"
    : pathname.includes("/day/")
      ? "day"
      : pathname.includes("/trips/")
        ? "trip"
        : "page";

  return (
    <ReaderNotice
      titleKey={
        kind === "day"
          ? "err.dayGoneTitle"
          : kind === "trip"
            ? "err.tripGoneTitle"
            : kind === "photobook"
              ? "err.photobookUnavailableTitle"
              : "err.pageGoneTitle"
      }
      bodyKey={
        kind === "day"
          ? "err.dayGoneBody"
          : kind === "trip"
            ? "err.tripGoneBody"
            : kind === "photobook"
              ? "err.photobookUnavailableBody"
              : "err.pageGoneBody"
      }
      actions={
        kind === "trip"
          ? [
              { href: `${site.base}/trips`, labelKey: "err.allTrips" },
              { href: site.base, labelKey: "err.goToJournal", vars: { title: site.title } },
            ]
          : kind === "photobook"
            ? [
                // Back to the trip itself — the photobook segment stripped off
                // its own path — rather than only the trip list, since the trip
                // is exactly what did not go anywhere.
                {
                  href: pathname.slice(0, -"/photobook".length) || site.base,
                  labelKey: "err.backToTrip",
                },
                { href: `${site.base}/trips`, labelKey: "err.allTrips" },
              ]
            : [
                { href: site.base, labelKey: "err.goToJournal", vars: { title: site.title } },
                { href: `${site.base}/search`, labelKey: "err.searchJournal" },
                { href: `${site.base}/trips`, labelKey: "err.allTrips" },
              ]
      }
    />
  );
}
