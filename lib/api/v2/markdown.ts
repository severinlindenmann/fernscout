// The one place that maps a v2 wire document onto the bytes of a file on
// disk, and back — B1596.
//
// Pure, like lib/validate/*: no fs, no "server-only", no next import. What
// touches the filesystem is a later ticket's job (the day and trip routes);
// this module only knows how to turn an object into a string and a string
// back into the same object.
//
// v1 keeps its own key names on disk for compatibility with content nobody
// has replayed yet. v2 does not carry that weight: the owner has allowed a
// breaking change to the on-disk format here, because only
// `content/example/` needs to read the new shape today and the migration
// (a later ticket) replays everything else through this module once. So the
// rule is the plain one — **a day's frontmatter IS `dayDoc`, minus the two
// fields that live elsewhere** (`slug` is the filename, `content` is the
// body) **plus the handful of things the server derives and the wire never
// carries.** Same for a trip, split across its three files. No renaming, no
// v1 compatibility shim: one fact, one address, and the address is the one
// the wire already uses.
//
// Emission goes through gray-matter's `stringify`, which is js-yaml under
// it — never a hand-built line of YAML. Two private copies of that escaping
// existed before (`q()` in lib/tripWrite.ts, `quote()` in lib/api/entries.ts)
// and were wrong in the same way (B204: an unescaped newline in a title
// closed the frontmatter block from inside the value, and the trip became
// unparseable and undeletable). `lib/validate/frontmatter.ts` exists to fix
// that for v1's hand-rolled lines; this module has no lines to hand-roll in
// the first place.
import matter from "gray-matter";
import type { z } from "zod";
import type { dayWrite } from "./schemas/day";
import type { tripCreate } from "./schemas/trip";

/** ── day ─────────────────────────────────────────────────────────────── */

type DayWriteShape = z.infer<typeof dayWrite>;
type DayMediaWire = NonNullable<DayWriteShape["media"]>[number];

/**
 * The v2 day document's frontmatter, plus the two things the wire never
 * carries because the server owns them:
 *
 * - each media item's `type`/`width`/`height` — derived once, at upload,
 *   from the bytes themselves — and, for a video, `poster`: a still frame
 *   ingest writes for the grid to draw instead of loading the clip. Neither
 *   is a wire concept; both are lost if this file does not keep them.
 *
 * `status` is required here rather than the wire's optional literal
 * `"draft"`, because a file on disk is always one or the other — this type
 * has to speak for a published day too, which the write shape refuses to
 * describe (publishing is a separate call, not a value the wire ever sends).
 *
 * `weather` is exactly the wire's own field: `true` (asked, unanswered) or a
 * reading. There is no second disk-only key for it — the server's own
 * fetched reading is simply a reading whose `source` happens to be
 * `open-meteo`; nothing about "was this asked for" needs its own address
 * once the reading itself is on the day.
 */
export type DayFile = Omit<DayWriteShape, "status" | "media"> & {
  status: "draft" | "published";
  media?: (DayMediaWire & {
    type: "image" | "video";
    width?: number;
    height?: number;
    /** A still from a clip, for the grid — video items only. */
    poster?: string;
  })[];
};

/**
 * v1's per-field decline encoding for `costs` — `costs: false` ("nothing
 * spent") or `costs: "unknown"` ("figures lost") — retired in favour of the
 * one `declined` mechanism. A file still carrying it predates v2; read and
 * thrown away rather than round-tripped, because turning it into a
 * `declined` entry is the replay migrator's job, not this serializer's.
 */
function isRetiredCostsDecline(value: unknown): boolean {
  return value === false || value === "unknown";
}

/**
 * Strip every `undefined` property, at every depth, before the object
 * reaches `matter.stringify` — which throws `unacceptable kind of an object
 * to dump [object Undefined]` on ANY `undefined` it meets, gray-matter
 * vendoring its own copy of js-yaml rather than deferring to the one
 * elsewhere in node_modules. The old `set(data, key, value)` helper only
 * filtered the top level, by never assigning an undefined value in the first
 * place; a *nested* `undefined` built into an object literal — a cost item
 * with `category: undefined`, a media item's `width: undefined`,
 * `rates.manual: undefined` — reached `matter.stringify` still present and
 * blew up, which is how three ordinary documents in the v1587 dry run failed
 * to serialise at all (B1601). One recursive pass here replaces `set()`
 * everywhere it was used.
 *
 * An `undefined` *array element* is a different fact from an absent object
 * property — the array still has that many slots — so it is not dropped and
 * the array is not compacted; it becomes `null`, the nearest thing YAML (and
 * JSON) has to "a slot with nothing in it". Nothing in this codebase's wire
 * shapes is expected to produce one (every array here is built by mapping
 * present values, never by a sparse literal), so this is a safety net rather
 * than an encoding anything relies on.
 */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : pruneUndefined(v))) as T;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = pruneUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * `matter.stringify(body, data)` re-parses `body` for frontmatter of its
 * own before writing — so a body whose first line reads as an opening
 * delimiter (`str.startsWith("---")`, then the fourth character anything
 * but a fourth dash: gray-matter's own `open`/`language` check in
 * `lib/parse.js`) has that "frontmatter" sliced back out and merged into
 * `data`, silently eating everything up to the next line matching `---`.
 * A day or a trip whose prose opens with a horizontal rule, a dialogue
 * separator, or plain three-dash punctuation is ordinary travel writing,
 * and refusing it is not on the table (AGENTS.md: write what you were
 * told). The fix is a leading blank line, which is invisible to the
 * delimiter check and already stripped back off by `content.trim()` on
 * read — so it changes nothing about what round-trips.
 */
function bodySafeForFrontmatter(body: string): string {
  return body.startsWith("---") ? "\n" + body : body;
}

/**
 * A day document → the bytes of `entries/YYYY-MM-DD-slug.md`.
 *
 * Key order is fixed so that serialising the same document twice matches
 * byte-for-byte: a diff in git is then always a change in content, never a
 * change in this function's mood.
 */
export function dayToMarkdown(day: DayFile): string {
  const data: Record<string, unknown> = pruneUndefined({
    title: day.title,
    date: day.date,
    time: day.time,
    timezone: day.timezone,
    location: day.location,
    country: day.country,
    countryCode: day.countryCode,
    coordinates: day.coordinates,
    media: day.media,
    costs: day.costs,
    transportMode: day.transportMode,
    transportFrom: day.transportFrom,
    transportTo: day.transportTo,
    tags: day.tags,
    translations: day.translations,
    visibility: day.visibility,
    weather: day.weather,
    travelScene: day.travelScene,
    test: day.test,
    declined: day.declined,
    status: day.status,
  });

  return matter.stringify(bodySafeForFrontmatter(day.content), data);
}

/** A day file's raw bytes → the v2 day document. `slug` comes from the
 * filename, never from frontmatter. */
export function dayFromMarkdown(slug: string, raw: string): DayFile {
  const { data, content } = matter(raw);

  const day: DayFile = {
    slug,
    title: data.title,
    date: data.date,
    content: content.trim(),
    // Anything that is not exactly "published" reads as a draft — a missing
    // key, a typo, a half-written file. v2 always writes this key, so the
    // case should not arise; when it does, the failure has to fall on the
    // side of *not* putting something on the site. The same asymmetry
    // governs `visibility` on a trip (lib/trips.ts): an unrecognised value
    // reads as private, never as public, because a typo must not publish
    // somebody's day.
    status: data.status === "published" ? "published" : "draft",
  };

  if (data.time !== undefined) day.time = data.time;
  if (data.timezone !== undefined) day.timezone = data.timezone;
  if (data.location !== undefined) day.location = data.location;
  if (data.country !== undefined) day.country = data.country;
  if (data.countryCode !== undefined) day.countryCode = data.countryCode;
  if (data.coordinates !== undefined) day.coordinates = data.coordinates;
  if (data.media !== undefined) day.media = data.media;
  if (data.costs !== undefined && !isRetiredCostsDecline(data.costs)) day.costs = data.costs;
  if (data.transportMode !== undefined) day.transportMode = data.transportMode;
  if (data.transportFrom !== undefined) day.transportFrom = data.transportFrom;
  if (data.transportTo !== undefined) day.transportTo = data.transportTo;
  if (data.tags !== undefined) day.tags = data.tags;
  if (data.translations !== undefined) day.translations = data.translations;
  if (data.visibility !== undefined) day.visibility = data.visibility;
  if (data.weather !== undefined) day.weather = data.weather;
  if (data.travelScene !== undefined) day.travelScene = data.travelScene;
  if (data.test !== undefined) day.test = data.test;
  if (data.declined !== undefined) day.declined = data.declined;

  // v1's per-field decline keys (`without`, `unrecorded`, `coordinates:
  // false`, `photos: false` — B531/B560) and its nested `transport:` block
  // are read by nothing here and never round-tripped. A file still carrying
  // one predates v2; translating it is the replay migrator's job, not this
  // serializer's.

  return day;
}

/** ── trip ────────────────────────────────────────────────────────────── */

type TripCreateShape = z.infer<typeof tripCreate>;
type TripCosts = NonNullable<TripCreateShape["costs"]>;
type TripPlan = NonNullable<TripCreateShape["plan"]>;

/**
 * The v2 trip document, unchanged from the wire — `costs` and `plan` are
 * still sections of one document here. `tripToMarkdown`/`tripFromMarkdown`
 * are what split them across `trip.md`, `costs.md` and `plan.md`; nothing
 * about the *document* changes because it happens to live in three files.
 */
export type TripFile = Omit<TripCreateShape, "days">;

/**
 * A trip document → the bytes of its three files. `costs` absent (declined,
 * or never brought) produces no `"costs.md"` entry at all — an absent file
 * IS the absence, and `trip.md`'s own `declined` map is what says why;
 * nothing is synthesised here. Same for `plan`.
 */
export function tripToMarkdown(trip: TripFile): { "trip.md": string; "costs.md"?: string; "plan.md"?: string } {
  const data: Record<string, unknown> = pruneUndefined({
    id: trip.id,
    title: trip.title,
    tagline: trip.tagline,
    dates: trip.dates,
    visibility: trip.visibility,
    listed: trip.listed,
    teaser: trip.teaser,
    test: trip.test,
    accent: trip.accent,
    cover: trip.cover,
    people: trip.people,
    rates: trip.rates,
    figures: trip.figures,
    translations: trip.translations,
    declined: trip.declined,
  });

  const files: { "trip.md": string; "costs.md"?: string; "plan.md"?: string } = {
    "trip.md": matter.stringify(bodySafeForFrontmatter(trip.intro ?? ""), data),
  };

  if (trip.costs) {
    const costsData: Record<string, unknown> = pruneUndefined({
      budget: trip.costs.budget,
      items: trip.costs.items,
      visibility: trip.costs.visibility,
    });
    files["costs.md"] = matter.stringify(bodySafeForFrontmatter(trip.costs.note ?? ""), costsData);
  }

  if (trip.plan) {
    files["plan.md"] = matter.stringify(bodySafeForFrontmatter(trip.plan.body ?? ""), { route: trip.plan.route });
  }

  return files;
}

/** The three files' raw bytes → the v2 trip document. A missing `costs.md`
 * or `plan.md` key means that section is simply absent — not declined, not
 * empty-but-present; the caller (and `trip.md`'s own `declined` map) is what
 * knows why. */
export function tripFromMarkdown(files: {
  "trip.md": string;
  "costs.md"?: string;
  "plan.md"?: string;
}): TripFile {
  const { data, content } = matter(files["trip.md"]);

  const trip: TripFile = {
    id: data.id,
    title: data.title,
    dates: data.dates,
    visibility: data.visibility,
    people: data.people,
  };

  const intro = content.trim();
  if (intro !== "") trip.intro = intro;

  if (data.tagline !== undefined) trip.tagline = data.tagline;
  if (data.listed !== undefined) trip.listed = data.listed;
  if (data.teaser !== undefined) trip.teaser = data.teaser;
  if (data.test !== undefined) trip.test = data.test;
  if (data.accent !== undefined) trip.accent = data.accent;
  if (data.cover !== undefined) trip.cover = data.cover;
  if (data.rates !== undefined) trip.rates = data.rates;
  if (data.figures !== undefined) trip.figures = data.figures;
  if (data.translations !== undefined) trip.translations = data.translations;
  if (data.declined !== undefined) trip.declined = data.declined;

  if (files["costs.md"] !== undefined) {
    const { data: costsData, content: costsContent } = matter(files["costs.md"]);
    const costs: TripCosts = { budget: costsData.budget };
    if (costsData.items !== undefined) costs.items = costsData.items;
    if (costsData.visibility !== undefined) costs.visibility = costsData.visibility;
    const note = costsContent.trim();
    if (note !== "") costs.note = note;
    trip.costs = costs;
  }

  if (files["plan.md"] !== undefined) {
    const { data: planData, content: planContent } = matter(files["plan.md"]);
    const plan: TripPlan = { route: planData.route };
    const body = planContent.trim();
    if (body !== "") plan.body = body;
    trip.plan = plan;
  }

  // v1's `travellers`, `tracks`, `status`, `startLocation`, `ratesFrom`,
  // `costsVisibility`, `reminder` and `reminderChannel` are read by nothing
  // here and never round-tripped — `travellers` is superseded by the figure
  // library, `tracks` and `costsVisibility` (now `costs.visibility`, in
  // `costs.md`) by their v2 homes, `status` is derived rather than stored,
  // and the rest never had a v2 home to begin with.

  return trip;
}
