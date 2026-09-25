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
/** Journal-scoped and owner-only — B821, moved under `/studio` by B2016.
 * Not in `TRIP_DESTINATIONS`: it belongs to the journal rather than to one
 * trip, and search must never offer it to anybody but the owner (see
 * lib/search.ts). No longer drawn as its own nav row — B2016 removed the
 * tab in favour of the studio hub's own Journal group, the same shape
 * `STUDIO_DESTINATION` below already has. */
const ACCOUNT_DESTINATION: NavDestination = {
  path: "/studio/account",
  labelKey: "nav.account",
  synonymsKey: "search.accountTerms",
};

/**
 * The studio hub — B1797, renamed and widened by B1825.
 *
 * Journal-scoped and owner-only, like `ACCOUNT_DESTINATION`. It draws no nav
 * row (B1963 gave the studio the header button the agent's control had, and
 * a row as well was two links to one page); it is here for `lib/search.ts`,
* which is a different question from drawing a tab — B1964, after this
 * constant was briefly deleted on the mistaken belief that search already
 * read it.
 *
 * **Not conditioned on a capability.** `lib/studio/pageGate.ts` says why:
 * each flow the hub lists carries its own gate, so an instance with
 * `extract` off still has a working studio, and hiding the whole hub behind
 * one flow's switch would be the "absent, not broken" bug aimed at the wrong
 * thing. The header control gates on `isOwner` alone for the same reason.
 */
const STUDIO_DESTINATION: NavDestination = {
  path: "/studio",
  labelKey: "nav.studio",
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
    // B2017 — moved under `/studio` with the rest of journal administration,
    // the same move `ACCOUNT_DESTINATION` already made for B2016.
    // `/me/analytics` still answers, as a permanent redirect.
    destination: {
      path: "/studio/visitors",
      labelKey: "visitors.title",
      synonymsKey: "search.visitorsTerms",
    },
    level: "owner",
    feature: "analytics",
  },
  {
    destination: {
      path: "/studio/readers",
      labelKey: "contact.adminTitle",
      synonymsKey: "search.contactsTerms",
    },
    level: "owner",
  },
  { destination: ACCOUNT_DESTINATION, level: "owner" },
  // B1964 — dropped when `STUDIO_DESTINATION` lost its last reader on
  // 2026-09-20 (a nav-row removal wrongly assumed search read the same
  // table; it did not). Owner-only, same as `ACCOUNT_DESTINATION` above:
  // the hub lists owner-only flows, so a reader must not learn it exists by
  // searching for it either.
  { destination: STUDIO_DESTINATION, level: "owner" },
  // B2019 — one row per card the hub itself draws (`components/studio/
  // StudioHub.tsx`'s `journalGroupItems` plus the `groups` array), so
  // "postcard", "rename" or "credits" finds the flow and not only the hub
  // page that lists it. Each label is the hub's own `studio.hub.item.*`
  // key — one string serves both. Not gated on a capability: the hub's own
  // doc comment on `requireStudioOwner` (`lib/studio/pageGate.ts`) says why
  // — a flow a capability switches off is still listed, greyed, with its
  // reason on the flow's own page (`StudioHubModel["cannotRun"]`,
  // `lib/studio/hub.ts`), never hidden, so search must not hide it either.
  // The two cards keyed to one specific trip's id (add a day to an ended
  // trip, plan a trip) have no fixed path to index and are left out, same
  // as the account/visitors/contacts rows above already were before this
  // ticket.
  {
    destination: { path: "/studio/day/edit", labelKey: "studio.hub.item.changeDay.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/day/reshape", labelKey: "studio.hub.item.reshapeDay.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/trip/new", labelKey: "studio.hub.item.newTrip.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/trip/plan-readers", labelKey: "studio.hub.item.planReaders.title" },
    level: "owner",
  },
  {
    // B2018's one trip-editing page — title, dates, who may read it, its
    // own address (the old "rename" flow) and deletion. `synonymsKey` is
    // what makes "rename" and "delete" find it: neither word is in the
    // hub's own title, "Edit a trip".
    destination: {
      path: "/studio/trip",
      labelKey: "studio.hub.item.tripEdit.title",
      synonymsKey: "search.tripEditTerms",
    },
    level: "owner",
  },
  {
    destination: { path: "/studio/people", labelKey: "studio.hub.item.people.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/photos", labelKey: "studio.hub.item.photos.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/location", labelKey: "studio.hub.item.location.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/statement", labelKey: "studio.hub.item.statement.title" },
    level: "owner",
  },
  {
    destination: {
      path: "/studio/inbox",
      labelKey: "studio.hub.item.inbox.title",
      synonymsKey: "search.inboxTerms",
    },
    level: "owner",
  },
  // B2172 — the hub's own composing flow, so "write a day" finds the studio
  // rather than the retired `/agent` room. Same label the hub's hero card
  // itself uses (`studio.hub.addDay.title`), not `changeDay`'s — that one
  // corrects a day already written, this one starts a new one. The
  // synonyms key is the one the old `/agent` search row carried, reused
  // rather than orphaned.
  {
    destination: {
      path: "/studio/day/new",
      labelKey: "studio.hub.addDay.title",
      synonymsKey: "search.helperTerms",
    },
    level: "owner",
  },
  {
    destination: { path: "/studio/postcard", labelKey: "studio.hub.item.postcard.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/photobook", labelKey: "studio.hub.item.photobook.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/journal", labelKey: "studio.hub.item.journalSettings.title" },
    level: "owner",
  },
  {
    destination: { path: "/studio/agent", labelKey: "studio.hub.item.agent.title" },
    level: "owner",
  },
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

