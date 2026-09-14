"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "./LocaleProvider";
import { useSite } from "./SiteProvider";
import { useTrip } from "./TripProvider";
import { upTrail, type UpCrumb } from "@/lib/navUp";

export type NamedCrumb = UpCrumb & { label: string };

/**
 * The ancestors of the page being read, nearest first, each with the name it
 * should be drawn under — B1728.
 *
 * `lib/navUp.ts` decides *what* the ancestors are and is pure so a keeper can
 * assert the whole map; this is the thin layer that gives each one a word,
 * which needs the reader's language, this journal and the trip in context.
 *
 * Where each word comes from, and why none of them is the string "Back":
 *
 * - **root** — "Your journals" for a reader holding an instance-wide
 *   identity, and the instance's own name for everybody else. Not
 *   `site.signedIn`: that is a guest session on *one* journal, and sending
 *   its holder to `/` having promised them "your journals" is the bug
 *   `hasIdentity` exists for (see lib/site.ts).
 * - **journal** — "Trips", the trip list's own name, and deliberately *not*
 *   the journal's title. The journal's title is the header's `<h1>`,
 *   immediately below this trail and again beside the phone row's arrow;
 *   naming the crumb after it printed that word twice in a row, on two
 *   controls leading to different pages. The page this goes to is called
 *   Trips everywhere else in the site (`SiteNav`), so it is called Trips
 *   here.
 * - **trip** — the trip's title in the reader's language.
 */
export function useUpCrumbs(): NamedCrumb[] {
  const pathname = usePathname();
  const site = useSite();
  const trip = useTrip();
  const { t, localizedTrip } = useI18n();

  return upTrail(pathname, {
    userBase: site.base,
    tripBase: trip?.base ?? null,
  }).map((crumb) => ({
    ...crumb,
    label:
      crumb.kind === "root"
        ? site.hasIdentity
          ? t("nav.myJournals")
          : site.name
        : crumb.kind === "journal"
          ? t("nav.trips")
          : trip
            ? localizedTrip(trip.trip).title
            : site.title,
  }));
}
