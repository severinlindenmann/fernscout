import type { TranslationKey } from "./i18n";

/**
 * Where a reader can go from the header — B823.
 *
 * `components/SiteNav.tsx` resolves each of these to this reader's own URL
 * (trip-relative, or the journal's own base) and its active state;
 * `lib/search.ts` turns the same list into page documents beside the day
 * entries, so a person can search their way to a menu point ("cost",
 * "storage") the way they can already search their way to a day. One list,
 * so the two can never disagree about what the destinations *are* — the same
 * discipline the enum imports in `lib/api/openapi.ts` already follow.
 */
export type NavDestination = {
  /** Relative to whichever base this destination belongs to — a trip's own
   * base for `TRIP_DESTINATIONS`, the journal's base for `ACCOUNT_DESTINATION`. */
  path: string;
  labelKey: TranslationKey;
  /** Other paths this destination also answers to, for the nav's active
   * state — Analytics owning `/costs` and `/weather`, unchanged since B557. */
  also?: string[];
  /**
   * A locale key holding extra words to index for this destination, as a
   * plain space-separated list — words nobody would guess from the label
   * alone ("Kosten", "Ausgaben", "Budget" all meaning the costs page, which
   * lives under Analytics since B557). Absent when the label is the whole of
   * it.
   */
  synonymsKey?: TranslationKey;
};

/** Trip-scoped: resolved against a trip's own base, and only ever shown or
 * indexed for a trip a reader may already open. */
export const TRIP_DESTINATIONS: NavDestination[] = [
  { path: "/", labelKey: "nav.story" },
  { path: "/gallery", labelKey: "nav.gallery" },
  { path: "/map", labelKey: "nav.map" },
  {
    path: "/analytics",
    labelKey: "nav.analytics",
    also: ["/costs", "/weather"],
    synonymsKey: "search.analyticsTerms",
  },
];

/**
 * Journal-scoped: resolved against the journal's own base rather than a
 * trip's — B890. These are the header rows that belong to the reader rather
 * than to any one trip, and each carries the reader level it needs, because
 * search must never offer a page the reader would only be refused at.
 *
 * `/search` itself is deliberately absent: a row whose only destination is
 * the page you are already typing into is noise.
 */
export const JOURNAL_DESTINATIONS: {
  destination: NavDestination;
  /** Who may find it: everyone, anybody who proved an address, or the owner. */
  level: "public" | "reader" | "owner";
}[] = [
  { destination: { path: "/trips", labelKey: "nav.trips", synonymsKey: "search.tripsTerms" }, level: "public" },
  { destination: { path: "/me", labelKey: "me.title", synonymsKey: "search.meTerms" }, level: "reader" },
  {
    destination: { path: "/contacts", labelKey: "contact.adminTitle", synonymsKey: "search.contactsTerms" },
    level: "owner",
  },
];

/** Journal-scoped and owner-only — B821. Not in `TRIP_DESTINATIONS`: it
 * belongs to the journal rather than to one trip, and search must never
 * offer it to anybody but the owner (see lib/search.ts). */
export const ACCOUNT_DESTINATION: NavDestination = {
  path: "/account",
  labelKey: "nav.account",
  synonymsKey: "search.accountTerms",
};
