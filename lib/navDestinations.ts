import type { FeatureName } from "./config";
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
  { path: "/", labelKey: "nav.story", synonymsKey: "search.storyTerms" },
  { path: "/gallery", labelKey: "nav.gallery", synonymsKey: "search.galleryTerms" },
  { path: "/map", labelKey: "nav.map", synonymsKey: "search.mapTerms" },
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
/** Journal-scoped and owner-only — B821. Not in `TRIP_DESTINATIONS`: it
 * belongs to the journal rather than to one trip, and search must never
 * offer it to anybody but the owner (see lib/search.ts). */
export const ACCOUNT_DESTINATION: NavDestination = {
  path: "/account",
  labelKey: "nav.account",
  synonymsKey: "search.accountTerms",
};

export type SearchLevel = "public" | "reader" | "owner";

export type SearchDestination = {
  destination: NavDestination;
  /** Who may find it: everyone, anybody who proved an address, or the owner. */
  level: SearchLevel;
  /**
   * A different label for the anonymous index — B903. `/me` is the one row
   * whose name depends on who is reading: "Sign in" to somebody with no
   * session, "Your access" to somebody who has one, exactly as `SiteNav`
   * labels the same door. Absent everywhere else, where one name is the whole
   * of it.
   */
  publicLabelKey?: TranslationKey;
  /**
   * Which capability has to be on, if any, before this row is real. Asked in
   * lib/search.ts, which is server-only and may — this file is imported by
   * the header and must stay free of it.
   */
  feature?: FeatureName;
};

/**
 * Journal-scoped: resolved against the journal's own base rather than a
 * trip's — B890, widened in B903. These are the rows that belong to the
 * reader rather than to any one trip, and each carries the reader level it
 * needs, because search must never offer a page the reader would only be
 * refused at.
 *
 * `/search` itself is deliberately absent: a row whose only destination is
 * the page you are already typing into is noise.
 */
export const JOURNAL_DESTINATIONS: SearchDestination[] = [
  {
    destination: { path: "/trips", labelKey: "nav.trips", synonymsKey: "search.tripsTerms" },
    level: "public",
  },
  {
    // Public, and it is the sign-in door that makes it so: somebody typing
    // "Anmelden" has no session by definition, so indexing this for signed-in
    // readers alone answered everybody except the person asking. B903.
    destination: { path: "/me", labelKey: "me.title", synonymsKey: "search.meTerms" },
    level: "public",
    publicLabelKey: "nav.signIn",
    feature: "auth",
  },
  {
    destination: {
      path: "/me/analytics",
      labelKey: "visitors.title",
      synonymsKey: "search.visitorsTerms",
    },
    level: "owner",
    feature: "analytics",
  },
  {
    destination: {
      path: "/contacts",
      labelKey: "contact.adminTitle",
      synonymsKey: "search.contactsTerms",
    },
    level: "owner",
  },
  { destination: ACCOUNT_DESTINATION, level: "owner" },
];

/**
 * Trip-scoped pages that are not in the header — B903.
 *
 * The header shows Analytics and lets it own `/costs` and `/weather` (B557),
 * which is right for a nav four wide on a phone and wrong for search: the hub
 * only exists when some analysis has data, so on a journal with costs and no
 * weather the word "Preis" had nowhere to land. Each of these is its own row,
 * and each is only added where lib/search.ts finds something behind it.
 */
export const TRIP_SEARCH_DESTINATIONS: SearchDestination[] = [
  {
    destination: { path: "/costs", labelKey: "cost.title", synonymsKey: "search.costsTerms" },
    level: "public",
    feature: "costs",
  },
  {
    destination: {
      path: "/weather",
      labelKey: "weatherPage.title",
      synonymsKey: "search.weatherTerms",
    },
    level: "public",
    feature: "weather",
  },
  {
    destination: {
      path: "/photobook",
      labelKey: "photobook.title",
      synonymsKey: "search.photobookTerms",
    },
    level: "owner",
    feature: "photobook",
  },
];

/**
 * The helper — B903. Not under `/<user>/` at all: `/agent/<user>` is its own
 * top-level route, so these carry whole paths rather than a suffix, and
 * lib/search.ts resolves them without the journal base.
 */
export const HELPER_DESTINATIONS: SearchDestination[] = [
  {
    destination: { path: "", labelKey: "agent.wizardTitle", synonymsKey: "search.helperTerms" },
    level: "owner",
    feature: "helper",
  },
  {
    destination: {
      path: "/inbox",
      labelKey: "agent.inboxTitle",
      synonymsKey: "search.inboxTerms",
    },
    level: "owner",
    feature: "helper",
  },
];

