import type { RateTable } from "./currency";
import type { Figure } from "./travellers/vocabulary";

export type TransportMode =
  | "flight"
  | "train"
  | "bus"
  | "motorbike"
  | "boat"
  | "car"
  | "walk";

export type Locale = "en" | "de" | "hu";

export type GalleryItem = {
  src: string;
  type: "image" | "video";
  caption?: string;
  width?: number;
  height?: number;
  /**
   * A still from a clip, for the grid.
   *
   * Ingest has written this into frontmatter since videos were supported, but
   * it was never declared here — so nothing read it, and the grid drew every
   * clip by loading the clip. It is trip-relative like `src`, and prefixed
   * with the owner in the same place.
   */
  poster?: string;
};

/**
 * One photograph or clip, as the trip gallery needs it, and no more.
 *
 * `getAllMedia` used to flat-map to `{ item: GalleryItem; entry: Entry }` — the
 * whole `Entry`, prose and all, once per photograph on it. A day with thirty
 * pictures shipped that day's `content` and `translations` thirty times, in
 * every language the journal is written in, to a grid that only ever read the
 * entry's location and date. Same shape of problem as `DaySummary` above,
 * same fix: project the four entry fields the tiles and the open viewer
 * actually use, not the entry itself (B87).
 */
export type MediaTile = {
  src: string;
  /**
   * The day this photograph belongs to.
   *
   * Carried since B441, for the postcard sheet: an order is addressed as trip
   * + day + photo, and the day was the one part of that a tile could not
   * supply. Everything else on this type is here to *render* the tile; this is
   * here to act on it.
   */
  slug: string;
  type: "image" | "video";
  caption?: string;
  width?: number;
  height?: number;
  poster?: string;
  location: string;
  country: string;
  countryCode?: string;
  date: string;
};

/**
 * What a page needs to offer "send a postcard" — B441, and `undefined` for
 * everybody who may not.
 *
 * Here rather than beside the function that computes it
 * (`lib/postcard/entry.ts`), because that module is `server-only` and the
 * component rendering the button is a client one. A type is erased at build
 * time and could be imported across that line with `import type`, but a
 * client file importing anything at all from a server-only module is a
 * confusing thing to leave for the next person to check.
 */
export type PostcardEntry = {
  username: string;
  /** The trip id — the API takes the id, not the qualified ref. */
  trip: string;
  /** The signature on the card, from the journal's own config. */
  from: string;
};

/**
 * What the gallery needs to offer a photobook: who, and of what. The rest of
 * an order is chosen on the photobook page itself, so unlike `PostcardEntry`
 * there is no signature to carry here.
 */
export type PhotobookEntry = {
  username: string;
  /** The trip id — the API takes the id, not the qualified ref. */
  trip: string;
};

export type Transport = {
  mode: TransportMode;
  from: string;
  to: string;
};

/**
 * How the travel scene between the previous day and this one plays — see
 * `components/TravelScene.tsx`. Mirrored at runtime by `TRAVEL_SCENE_VARIANTS`
 * in `lib/validate/entry.ts`, the same split `TransportMode` uses.
 *
 * Absent means `"default"`: today's scene, unchanged. `"skip"` leaves the leg
 * out of the story pager entirely, for a trip whose fortieth identical hop a
 * reader has already seen thirty-nine times.
 */
export type TravelSceneVariant = "default" | "quick" | "skip";

/** Optional per-locale overrides for an entry's prose. Whatever is missing
 * falls back to the entry's own `title` / `content`. */
/** Keyed by locale code. Open on purpose (ROADMAP §1.2): an author may write
 * in a language we ship no chrome for, and that must work. */
export type EntryTranslations = Record<string, { title?: string; content?: string }>;

export type EntryCost = {
  label: string;
  /** As spent, in `currency`. Never converted at write time. */
  amount: number;
  /** ISO-4217 code. Absent from frontmatter means the site's base currency. */
  currency: string;
  category: string;
};

export type Entry = {
  slug: string;
  title: string;
  date: string; // ISO yyyy-mm-dd
  /** HH:mm — orders several updates within the same day. */
  time?: string;
  location: string;
  country: string;
  /** ISO 3166-1 alpha-2, used for the flag. */
  countryCode?: string;
  lat: number;
  lng: number;
  transport?: Transport;
  /** How the arrival scene for this day should play. Absent means the
   * default. An unrecognised value on disk is never carried this far — see
   * `parseTravelSceneVariant` in lib/entries.ts. */
  travelScene?: TravelSceneVariant;
  cover?: string;
  gallery: GalleryItem[];
  tags: string[];
  /** Spend logged against this update, each in the currency it was spent in. */
  costs: EntryCost[];
  content: string;
  translations?: EntryTranslations;
  /**
   * Written by an agent, not yet published by a person.
   *
   * Absent from every public reading path. Present, and flagged, when the
   * journal's owner is looking at their own site — so they can read the thing
   * before deciding to publish it. See `getAllEntries`.
   */
  draft?: boolean;
  /**
   * Content nobody lived — written to exercise the pipeline, not to record
   * anything.
   *
   * There is one legitimate reason to write a day that did not happen: proving
   * that signup, a journal, a trip, a day and its photographs still work end to
   * end. The guide otherwise forbids inventing detail, and an agent asked to do
   * this had no way to mark it — the one that tried wrote "this is invented
   * test content" into the prose, which is its own convention and only harmless
   * because it chose to make it so.
   *
   * `test: true` makes that the system's business instead. The page says so in
   * a banner nobody can miss, and the entry is kept out of the feed, the search
   * index and the sitemap exactly as a draft is — so a test day cannot arrive
   * in somebody's feed reader looking like a Tuesday.
   */
  test?: boolean;
};

/** One calendar day, which may hold several updates ("branches"). */
export type Day = {
  date: string;
  entries: Entry[];
  /** The first entry of the day — carries the day's location and arrival leg. */
  lead: Entry;
};

/**
 * One day as the navigation needs it, and no more.
 *
 * The winding path, the day list, the route line on the hero map and the
 * travel legs between days all need every day of the trip; none of them needs
 * its prose, its gallery or its itemised spend. Sending `Day[]` for all of
 * that made the story page grow by ~11 KB for every day written — a five-month
 * trip would have shipped megabytes before the reader saw day one. This is the
 * cheap half, sent for every day; the expensive half travels a window at a
 * time. See `lib/tripView.ts`.
 */
export type DaySummary = {
  date: string;
  /** The lead entry's slug — what `#day-…` links and resume use. */
  slug: string;
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  /** The leg that arrived here, which is enough to play the travel scene. */
  transport?: Transport;
  /** How this leg's travel scene should play. Absent means the default. */
  travelScene?: TravelSceneVariant;
  /** How many updates were written that day. */
  updates: number;
  /** Spend that day in the base currency; 0 when nothing was logged. */
  cost: number;
};

/** One stop on the intended route, from a trip's plan.md or from a
 * future-dated draft (W33). */
export type PlannedStop = {
  location: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  note?: string;
  /** True once a real entry exists near this stop. */
  reached: boolean;
  /** The draft's date, present only on a stop born from a draft — used to
   * order it among other draft-derived stops. plan.md's hand-written stops
   * carry no date, so this is never used to sort against them. */
  date?: string;
  /** This stop came from a future-dated draft rather than plan.md. Purely
   * informational for the legend — the security boundary is upstream, in
   * whether `getPlan` was asked for drafts at all (see lib/plan.ts). */
  fromDraft?: boolean;
};

export type PlanProgress = {
  stops: PlannedStop[];
  reachedCount: number;
  /** The next stop we haven't got to yet, if any. */
  next?: PlannedStop;
};

export type TripStatus = "past" | "current" | "upcoming";

/** Hues from app/globals.css — a trip's colour on the lifetime map. */
export type TripAccent = "sky" | "yellow" | "green" | "coral" | "navy";

/** See EntryTranslations — open by locale code, not a fixed union. */
export type TripTranslations = Record<string, { title?: string; tagline?: string }>;

/** One trip: a folder under content/trips/, described by its trip.md. */
/**
 * Who may read a trip.
 *
 * `unlisted` is deliberately not security — a shared link is a public link.
 * It exists because it is the honest middle for a family trip: no wall in
 * front of a grandparent, and no strangers arriving from a search engine.
 */
/**
 * Who a trip is for.
 *
 * - `private` — only the people who took it (`people:`, plus the owner).
 * - `public`  — everyone.
 * - `guest`   — everyone the owner has let into the **journal**, and the
 *   people who took it.
 *
 * The line between the last two is the one a person gets wrong at the moment
 * they create a trip, and it is worth saying in the words they will need:
 * `guest` means the people I let into this journal; `private` means only the
 * people who were there. A guest is a guest of the journal and never of a
 * single trip — there is no per-trip invitation and none should be added, so a
 * trip that must be held back from people who are otherwise let in is
 * `private`. That is the whole reason there are three values and not two.
 *
 * The older words are still accepted and mapped on read: `password` is a
 * `guest` trip (there are no trip passwords any more — B39), and `unlisted` is a
 * public trip that is not advertised, which is what `listed` below is for.
 * Those two were describing how you get in; these three describe who is let
 * in, and conflating the axes is how "unlisted" stopped meaning anything.
 */
export type TripVisibility = "private" | "public" | "guest";

/** Costs are the most personal thing on the site and the most interesting;
 * they get their own switch rather than riding on the trip's. */
export type CostsVisibility = "public" | "guests";

/**
 * Somebody who took the trip.
 *
 * A name and an address, and the address is the identity — it is already what
 * a login code is sent to, so there is no second username to invent.
 *
 * Note what this is *not*: a journal's own `username` is a URL segment and a
 * directory name, and therefore a security boundary with a strict character
 * set. An email address is neither. People are addressed by email; journals
 * keep their usernames.
 */
export type TripPerson = {
  name: string;
  /** Lower-cased on parse, because that is what an address is compared as. */
  email: string;
  /**
   * What to call them in a byline. Optional, falling back to `name`.
   *
   * There is no derivation from the full name: splitting on a space to guess a
   * first name is how you mangle somebody's name in the credit line of their
   * own holiday.
   */
  nickname?: string;
};

export type Trip = {
  /** Unique within its owner, not across the instance — see `ref`. */
  id: string;
  username: string;
  /** `<username>/<id>` — the key every content function takes. */
  ref: string;
  /**
   * This trip's own historical exchange rates, from the `rates:` block in
   * `trip.md`. Units of the site's base currency per one unit of the keyed
   * currency, frozen at whatever they were while the trip was happening.
   *
   * Per trip rather than global on purpose: a 2029 trip to the same country
   * must not restate what 2026 cost. Empty when the trip declares none, which
   * is correct for a trip spent entirely in the base currency.
   */
  rates: RateTable;
  title: string;
  tagline?: string;
  start: string; // ISO yyyy-mm-dd
  end: string;   // ISO yyyy-mm-dd
  status: TripStatus;
  /** The trip card's photograph. Written trip-relative ("/media/<trip>/…")
   * and prefixed with the owner on read, like any other media path. */
  cover?: string;
  /** The colour the owner chose. Absent means no preference — the trips page
   * assigns one, rather than every trip defaulting to the same blue. B346. */
  accent?: TripAccent;
  /** The markdown body of trip.md — the trip's intro paragraph. */
  intro: string;
  translations?: TripTranslations;
  /**
   * Who took this trip. Empty for a trip that declares nobody, which reads as
   * "the journal's owner, alone".
   *
   * Everyone here may write to the whole trip, not only to their own days —
   * you were both there, and splitting a shared day between two authors is a
   * distinction nobody on the bus was making.
   */
  people: TripPerson[];
  /**
   * How the people on this trip are **drawn** — see lib/travellers/.
   *
   * Deliberately not a field inside `people:`, and the separation is the
   * load-bearing part rather than a stylistic one. `parsePeople` fails closed:
   * one malformed entry drops the whole list, because that list is who may
   * write to the trip. A cosmetic field sharing that parser would mean a typo
   * in a hair colour revoking everybody's write access. `parseTravellers`
   * fails open instead, and nothing it does can change `peopleOf()`.
   *
   * Empty means "whatever the journal's config says", and ultimately one
   * neutral figure. An optional `for:` on a figure ties it to an address in
   * `people:`, which is all the two blocks ever say to each other.
   */
  travellers: Figure[];
  visibility: TripVisibility;
  /**
   * Whether the trip is advertised — sitemap, feed, the trip switcher.
   *
   * Its own axis, because being reachable by a link and being listed are
   * different questions. A `public` trip with `listed: false` is the old
   * `unlisted`.
   *
   * Derived from `visibility:` and then **narrowed** by the frontmatter's own
   * `listed:` key, which `parseVisibility` reads — a `listed: false` anywhere
   * is honoured, a `listed: true` on a trip its visibility does not advertise
   * is refused and logged (B51). So this is never wider than `visibility`
   * allows, and a consumer may read it without re-deriving that: `private` and
   * `guest` are always false here, whatever the file says.
   *
   * Never a *reading* right. Nothing about who may open the trip is decided
   * here; that is `mayReadTrip` and `visibility` alone.
   */
  listed: boolean;
  /**
   * A trip that exists to prove the software works. See `Entry.test`.
   *
   * On a trip it is inherited: every day of a test trip is a test day, so
   * somebody exercising the pipeline sets it once rather than remembering it
   * on each entry.
   */
  test?: boolean;
  costsVisibility: CostsVisibility;
  /**
   * Frontmatter keys the parser did not consume. Absent when there are none,
   * which is the ordinary case.
   *
   * It exists so that a key the software no longer honours can still be
   * *noticed*. `instrumentation.ts` refuses to boot on a leftover trip
   * password — a line that used to lock a trip and now does nothing is the
   * most dangerous kind of dead config, because its owner still believes in
   * it. Naming that key in here or anywhere else under `lib/` would put the
   * password back in the codebase B39 took it out of, so the parser reports
   * what it did not understand and the boot decides which of those is
   * dangerous.
   */
  unknownFields?: string[];
};
