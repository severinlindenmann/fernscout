// Domain assembly for a v2 day document — B1612 (phase 2 step 3, parcel B).
//
// The seam with the media door: a day's `media` items on the wire are
// `{src, caption?, visibility?}` (dayWrite) and on disk additionally carry
// `type`/`width`/`height`/`poster`/`from`, derived once at upload by the media
// subsystem (documents.ts's own comment on `DayFile`). This file fills them
// with the smallest honest placeholder (`url` = `src`) rather than inventing
// dimensions — flagged everywhere it happens so the next reader finds it
// before trusting a width or a served URL that were never measured. `type`
// is no longer among the guesses: the extension says whether a file is a
// clip, and calling one an image was a broken picture on the day (B1885).
//
// `attachDayMedia`/`detachDayMedia` (bottom of this file, B1656) are the
// other half of that seam: `storeMediaV2`/`storeTripPhoto` (./media.ts)
// place bytes and decide where on disk they live, but never touch a day
// document — a day references a photograph by `src` afterwards, and that
// reference is this file's business. Deliberately their own narrow write,
// not a `dayPatch` — see their own doc comments for why.
import "server-only";
import type { ZodType } from "zod";
import { dayDoc, dayMerged, DAY_DECLINABLE_KEYS, type DayWrite } from "./schemas/day";
import { isEnabled } from "@/lib/capabilities";
import { isTestContent } from "@/lib/access";
import { mediaKey, type PhotoVisibility } from "@/lib/photos";
import { isVideoSrc, resolveMediaFile } from "@/lib/media";
import { altTextFor } from "@/lib/entries";
import type { TripRef } from "@/lib/trips";
import type { Trip } from "@/lib/types";
import type { DayFile, TripFile } from "./documents";
import { deepEqual, exemptSingleLocaleTranslations } from "./write";
import { readDayFile, writeDayFile } from "./store";
import { incompleteFrom, type MissingRow, type ProblemRow } from "./incomplete";

type WireMediaItem = NonNullable<DayWrite["media"]>[number];

/**
 * A day's incoming `media` array, trimmed back to exactly the wire fields
 * `dayWrite`/`dayPatch` declare. A caller that GETs a day and PUTs/PATCHes
 * the whole thing back carries every read-only addition (`url`, `type`,
 * `width`, `height`, `poster`) on each item; `z.strictObject` would refuse
 * all four as unrecognised keys. `stripEchoedFields` (./write.ts) only
 * strips a whole path's value against the stored document — it has no way
 * to reach inside each element of an array, which is what this does
 * instead, unconditionally (these four are never trusted from the wire in
 * the first place, so there is no value to compare against stored).
 */
/**
 * A `weather` the caller is handing straight back, dropped — B1732.
 *
 * The server writes a day's weather itself when the day asks for it
 * (`weather: true`, B1713), and what it writes carries `source: "open-meteo"`.
 * The write shapes refuse that source by name, and rightly: a caller may not
 * claim the server measured something. But the server then *hands that
 * document back* on every `GET`, and the documented way to correct a day is to
 * read it, change one field and write it back — so the ordinary
 * read-modify-write refused with
 * `weather.source: "this source name is the server's own — a caller may never
 * claim it"`, on a value the caller never chose.
 *
 * Since the folder a client keeps is now a mirror of the instance, that is
 * every day the server has weather for: 36 of the demo journal's 44, and all
 * 47 of the first real migration's.
 *
 * **Echoing is not claiming, and changing it still is.** An unchanged value is
 * dropped from the body — there is nothing to write — and anything else is
 * left exactly where it was for the schema to refuse. Same reasoning as
 * `stripMediaEcho` above; the difference is that this one must compare against
 * what is stored, because for weather the two cases are not the same fact.
 */
export function stripWeatherEcho(
  body: Record<string, unknown>,
  stored: DayFile | null,
): Record<string, unknown> {
  if (body.weather === undefined || !stored) return body;
  // `weather: true` is an INSTRUCTION, not a value being handed back — it
  // asks this server to look the day up. A day whose lookup came back empty
  // keeps `weather: true` stored, so treating that as an echo swallowed the
  // one way a caller has to ask again (B1713), silently. Caught by the test
  // that pins the retry.
  if (body.weather === true) return body;
  if (!deepEqual(body.weather, stored.weather)) return body;
  const { weather: _echoed, ...rest } = body;
  return rest;
}

/**
 * What a day still has neither answered nor declined — the completeness
 * re-check publishing makes (`applyPublish`), as one function so the studio's
 * share sheet (B2192) names exactly the fields the publish itself would
 * refuse, and the web door can refuse a decline for anything not on it.
 *
 * `dayMerged` rather than `dayWrite`, for the reason its own comment gives
 * (B1713): this candidate came off disk, so its weather may be the reading
 * the server itself fetched. The media echo is stripped first, same as
 * PATCH/PUT. A single-locale journal is exempt from `translations` (B1667) —
 * applied to the throwaway candidate only.
 */
export function missingAtPublish(day: DayFile, locales: readonly string[]): MissingRow[] {
  const candidate = stripMediaEcho({ ...day, status: "draft" });
  exemptSingleLocaleTranslations(candidate, locales);
  const check = dayMerged.safeParse(candidate);
  if (check.success) return [];
  return incompleteFrom(check.error, dayDoc.shape as unknown as Record<string, ZodType>, DAY_DECLINABLE_KEYS).missing;
}

export function stripMediaEcho(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.media)) return body;
  return {
    ...body,
    media: body.media.map((item) => {
      if (!item || typeof item !== "object") return item;
      const { src, caption, visibility } = item as Record<string, unknown>;
      return { src, ...(caption !== undefined ? { caption } : {}), ...(visibility !== undefined ? { visibility } : {}) };
    }),
  };
}

/**
 * The wire's `media` (just `{src, caption?, visibility?}`) → what a `DayFile`
 * stores. `existing` is the day already on disk, if any — a `src` that was
 * already attached keeps whatever `type`/`width`/`height`/`poster`/`from` it had;
 * a `src` new to this write gets the placeholder described at the top of
 * this file, since nothing here can measure real bytes.
 *
 * Matched by `mediaKey`, not by exact string, and the STORED src wins on a
 * match (B1586) — the page a caller like `EditDay` reads from renders each
 * photo through `mediaWithOwner`, which prefixes `/media/...` with the
 * owner (`lib/trips.ts`) for the `<img>` tag; a correction sent straight
 * back from that page therefore carries `/{owner}/media/...`, not the
 * trip-relative `src` this day's file actually has. Matching on the bare
 * key — the same normalisation `detachGallery` already uses — finds the
 * existing item either way, and keeping its own `src` is what stops every
 * other photograph on the day from being silently re-stored under a
 * browser-shaped path (and losing its measured `width`/`height` with it)
 * the moment one caption changes.
 */
export function toStoredMedia(
  items: readonly WireMediaItem[] | undefined,
  existing: DayFile["media"],
): DayFile["media"] | undefined {
  if (!items) return undefined;
  const bySrc = new Map((existing ?? []).map((m) => [mediaKey(m.src), m]));
  return items.map((item) => {
    const prior = bySrc.get(mediaKey(item.src));
    return {
      ...item,
      src: prior?.src ?? item.src,
      // What the file is, not what most files are — B1885. A `src` new to a
      // day used to be recorded as an image whatever it was, so a clip
      // uploaded through the media door (`storeTripPhoto` transcodes it and
      // writes `<hash>.mp4`) reached the day as an image and every reader
      // that switches on `type` drew an `<img>` for it. The extension is the
      // one fact about the bytes that is legible from here, and it is the
      // fact in question.
      type: prior?.type ?? (isVideoSrc(item.src) ? "video" : "image"),
      ...(prior?.width !== undefined ? { width: prior.width } : {}),
      ...(prior?.height !== undefined ? { height: prior.height } : {}),
      ...(prior?.poster !== undefined ? { poster: prior.poster } : {}),
      // What the file was called before it was renamed — B527, disk-only
      // and never on the wire (`dayMediaItem` is a `strictObject` without
      // it), so it can only ever come from the stored item, same as
      // `width`/`height`/`poster` above. Dropped here silently for every
      // PATCH/PUT until B2244.
      ...(prior?.from !== undefined ? { from: prior.from } : {}),
    };
  });
}

/**
 * Day's own status echo-tolerance — value-aware, unlike the generic
 * byte-identical removal `write.ts` uses everywhere else. `status: "draft"`
 * is a genuine write value (the ONLY one `dayWrite`'s literal accepts, and
 * the one `DAY_DECLINABLES` requires present-or-declined at create), so an
 * echo of it must reach the schema untouched. Only `"published"` — a value
 * the literal can never represent at all — is dropped, and only when it
 * merely echoes what's already stored; echoing any OTHER, different value
 * is refused, same as every other immutable field.
 */
export function resolveStatusEcho(
  body: Record<string, unknown>,
  storedStatus: DayFile["status"] | undefined,
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const attempted = body.status;
  if (attempted === undefined || attempted === "draft") return { ok: true, body };
  if (storedStatus !== undefined && attempted === storedStatus) {
    const { status: _status, ...rest } = body;
    return { ok: true, body: rest };
  }
  return { ok: false, message: "status is not writable here. Publishing and unpublishing are their own calls." };
}

/** `{ alt }` or `{}` — never `{ alt: undefined }`, because `etagFor`
 * (lib/api/v2/route.ts) hashes `Object.keys()` and a key present with an
 * undefined value hashes differently from the same key absent. */
function altOf(ref: TripRef, src: string): { alt?: string } {
  const alt = altTextFor(ref, src);
  return alt === undefined ? {} : { alt };
}

/** A stored `DayFile` → what `dayDoc.parse` needs to see: every media item
 * needs a `url`, which nothing but the media door can genuinely resolve yet
 * (`DayFile` itself carries no such field — see the file comment) — passed
 * through as the `src` itself in the meantime. */
export function dayEchoInput(day: DayFile, ref: TripRef): Record<string, unknown> {
  return {
    ...day,
    // Project each media item DOWN to the wire shape. The stored item also
    // carries `type`, `width`, `height` and `poster` — derived from the bytes
    // at upload, deliberately disk-only (`DayFile` in ./documents.ts), and
    // absent from `dayMediaItem`, which is a `strictObject`. Spreading the
    // stored item threw `Unrecognized key: "type"` out of the route's own
    // echo: the handler refused the value it had just written, and — because
    // the same `dayDoc.parse` runs on every read — no day carrying a
    // photograph could be read back either. `test/contract-roundtrip.test.ts`
    // is what caught it, which is exactly the "accepted is not the same claim
    // as it is there" check (B540) it exists to make.
    media: day.media?.map((m) => ({
      src: m.src,
      ...(m.caption !== undefined ? { caption: m.caption } : {}),
      ...(m.visibility !== undefined ? { visibility: m.visibility } : {}),
      url: m.src,
      // Server-owned, like `url` beside it: what the photograph shows, read
      // off its sidecar rather than off the day (B1867). Absent — the key
      // itself absent, since `etagFor` hashes the key list — for anything
      // nothing has described.
      ...altOf(ref, m.src),
    })),
  };
}

/**
 * B1620 #1 — `daySummary.test`/`dayDoc.test` resolved wherever a day is
 * listed or read, not only on the page that draws the "nobody lived this"
 * banner. Mirrors `isTestContent` (lib/access.ts) — a day inherits the flag
 * from a wholly-invented trip even when it carries no flag of its own. Not
 * exported: every caller goes through `withResolvedTest` below, which is the
 * version safe to hand a `dayEchoInput` result.
 */
function resolveDayTest(trip: Pick<TripFile, "test">, day: Pick<DayFile, "test">): boolean | undefined {
  return isTestContent(trip as unknown as Trip, day) || trip.test === true || day.test === true || undefined;
}

/**
 * Applies `resolveDayTest` to a `dayEchoInput` result WITHOUT ever adding a
 * literal `test: undefined` key — `etagFor` (lib/api/v2/route.ts) hashes
 * `Object.keys()`, so a key present with an `undefined` value hashes
 * differently than the same key absent altogether. Every `dayDoc.parse(...)`
 * call site across the day routes (list, GET, PUT, PATCH) goes through this
 * rather than setting `test` ad hoc, so the same stored day always produces
 * the same ETag regardless of which route last read it — the exact "GET it,
 * PUT it back" round trip V11 exists to keep working
 * (`test/api-v2-days.test.ts`'s echo-tolerance suite is what caught the
 * first, ad hoc version of this getting it wrong).
 */
export function withResolvedTest(
  input: Record<string, unknown>,
  trip: Pick<TripFile, "test">,
  day: Pick<DayFile, "test">,
): Record<string, unknown> {
  const test = resolveDayTest(trip, day);
  return test === undefined ? input : { ...input, test };
}

/**
 * v2's slug → the slug v1's day functions match on.
 *
 * The two conventions differ and both are deliberate. v2 addresses a day by
 * its whole filename stem — `2026-01-11-da-lat` — because that is the id a
 * client chooses and the thing the URL carries. v1's `Entry.slug` is the same
 * stem with the date prefix stripped (`entrySlugFromFile`, lib/entries.ts),
 * and `getEntryBySlug` matches on that shorter form.
 *
 * So every v2 route reaching into a v1 day function has to convert, and the
 * failure when it does not is quiet in the worst way: `sendDayLetter` simply
 * finds no day and answers `unknown_day`, so **every real send through
 * publish and through the send door was refused** while both routes looked
 * correct and their own tests passed. B1618, found when `day-mail.test.ts`
 * was repointed.
 *
 * One function rather than a `.replace()` at each call site, because this is
 * exactly the kind of convention that two copies of get wrong differently.
 *
 * This conversion is temporary in principle: once the render layer reads v2
 * JSON days (B1598), the v1 readers these functions use go away and the
 * shorter form with them. It is not temporary in practice until then — an
 * unconverted slug is a refusal, not a fallback.
 */
export function v1Slug(slug: string): string {
  return slug.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

/**
 * The mirror of `v1Slug` — B1633. A v1 reader (`listDrafts`) hands back the
 * bare slug; a v2 document is addressed by the whole filename stem
 * (`YYYY-MM-DD-slug`), the id `GET .../days/{slug}` actually matches on. A
 * caller handed the bare form off `/status` and passing it straight to that
 * route the obvious way gets a 404 — the same convention split as `v1Slug`,
 * crossed the other direction.
 *
 * Needs the day's own `date`, which every v1 reader already carries
 * alongside the bare slug (`listDrafts`'s own return shape) — there is
 * nothing to derive this from otherwise, since the date prefix `v1Slug`
 * strips is gone once it has been stripped.
 */
export function v2Slug(date: string, bareSlug: string): string {
  return `${date}-${bareSlug}`;
}


/**
 * Whether a day's `weather: true` must be refused outright — B1617.
 *
 * `weather: true` is the one field on a day that asks the server to *do*
 * something rather than store what it was sent. An instance that cannot reach
 * the archive would never service it, so the
 * request is refused rather than banked: "absent rather than broken when
 * disabled" (AGENTS.md).
 *
 * **Asked of the instance, never of the journal** — v2 decision 5. A
 * capability answers "is the plumbing configured", which is the operator's
 * fact; an archive this server cannot reach is unreachable for everybody on
 * it. The per-journal `features` block is gone in v2
 * (`lib/api/v2/schemas/journal.ts` says so in its own header).
 *
 * Lives here rather than in `lib/api/weather.ts` because what that module
 * returned was a v1-shaped `{error, message}` body, of which a v2 route used
 * only the sentence — and the import boundary refuses v1 route glue for
 * exactly that reason. The lookup itself (`fillDayWeatherQuietly`) is domain
 * and stays where it is.
 *
 * Only a caller's `true`. Declining weather asks for nothing, so it is never
 * refused here — `declined.weather` is how a day says it has none.
 */
export function weatherLookupRefused(body: { weather?: unknown }): string | null {
  if (body.weather !== true || isEnabled("weather")) return null;
  return (
    "weather: true asks this server to look the day up in a public archive, and this " +
    "server does not do weather — no lookup would happen at all, so " +
    "nothing was written rather than accepting a request nobody will service. /api/health " +
    "says which capabilities this instance has and why each is off. Send the day without " +
    "the field, or decline it (declined.weather) if there is simply none to record. A " +
    "reading somebody actually took goes in `weather` as an object with its own source — " +
    "never one you believe."
  );
}

/** ── attach/detach: the narrow media door — B1656 ───────────────────── */

type WireItem = { src: string; caption?: string; visibility?: PhotoVisibility };

/**
 * Whether `src` names a photograph actually stored inside THIS trip's own
 * media directory — the check that stands in for the width/height-must-be-
 * numbers guard `attachGallery` (lib/api/entries.ts, v1) needed for a reason
 * that no longer applies here: v2's wire item is only `{src, caption?,
 * visibility?}`, so there is no dimension to arrive malformed. What a v2
 * item CAN get wrong that the schema cannot catch is `src` itself — a string
 * this server never stored, or one belonging to a different trip — and
 * writing that into a day would be exactly B540's failure: an attach that
 * answers success while the day now names a photograph that resolves to
 * nothing. `resolveMediaFile` is the same guarded resolve the read route and
 * `deleteMediaV2` (./media.ts) already use; an `inbox:` src is refused
 * outright, since a photo has to be placed inside a trip before a day may
 * point at it (the same order v1's own attach required — the media route
 * writes the bytes first, and only then can a day be told where they are).
 */
function srcStoredInTrip(username: string, tripId: string, src: string): boolean {
  if (src.startsWith("inbox:")) return false;
  const segments = mediaKey(src).split("/");
  if (segments[0] !== tripId) return false;
  return resolveMediaFile(username, segments) !== null;
}

function existingWireItems(day: DayFile): WireItem[] {
  return (day.media ?? []).map((m) => ({
    src: m.src,
    ...(m.caption !== undefined ? { caption: m.caption } : {}),
    ...(m.visibility !== undefined ? { visibility: m.visibility } : {}),
  }));
}

/** `declined.media` off the document, or the document unchanged if it was
 * never there — T6's retraction rule, applied to the one field this door
 * ever touches rather than the whole `declined` map a full patch handles. */
function withoutDeclinedMedia(day: DayFile): DayFile["declined"] {
  if (!day.declined || day.declined.media === undefined) return day.declined;
  const { media: _media, ...rest } = day.declined;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export type DayMediaAttachOutcome =
  | { ok: true; day: DayFile }
  | { ok: false; error: "unknown_day" }
  | { ok: false; error: "not_this_trip"; problems: ProblemRow[] };

/**
 * Append already-stored photographs to a day's own gallery — the gap this
 * ticket exists to close: nothing before this wrote a `src` into a v2 day's
 * `media` array at all (./media.ts's own header comment used to say so in
 * as many words).
 *
 * Deliberately NOT `dayWrite.safeParse` on the merged document — see D20,
 * 06-contract-deltas.md, for why: a day that has never answered its other 13
 * declinables must still be able to take a photograph, and re-running full
 * completeness here would refuse that with fields nobody just asked about
 * (B1650's wall, one door over). This only ever touches `media` and, when
 * photographs arrive, retracts a stale `declined.media` (T6) — every other
 * field on the stored document passes through untouched.
 *
 * A `src` already on the day is left alone rather than duplicated — the
 * ordinary retry-safety this whole contract promises elsewhere (a second
 * call with the same body changes nothing further), not a feature of v1's
 * `attachGallery`, which this replaces for v2-native days.
 *
 * The compare-and-swap that keeps this safe against a second writer is the
 * caller's `If-Match` (checked at the route, against the same ETag every
 * other day write already uses) — not `fileUnchangedSince`, which has no v2
 * equivalent (`lib/api/v2/store.ts` keeps none): v2's whole write path is
 * built on ETags, and a second CAS mechanism beside it would be a second
 * thing that could disagree with the first about whether a write is stale.
 */
export function attachDayMedia(
  username: string,
  tripId: string,
  slug: string,
  items: readonly WireItem[],
): DayMediaAttachOutcome {
  const stored = readDayFile(username, tripId, slug);
  if (!stored) return { ok: false, error: "unknown_day" };

  const problems = items
    .filter((item) => !srcStoredInTrip(username, tripId, item.src))
    .map((item) => ({
      field: "src",
      problem:
        `"${item.src}" is not a photograph this trip's own stored media has — upload it first ` +
        `with POST /api/v2/${username}/media, then attach the src it answers with.`,
    }));
  if (problems.length > 0) return { ok: false, error: "not_this_trip", problems };

  const already = new Set((stored.media ?? []).map((m) => m.src));
  const toAdd = items.filter((item) => !already.has(item.src));
  const media = toStoredMedia([...existingWireItems(stored), ...toAdd], stored.media);

  const next: DayFile = { ...stored, media, declined: withoutDeclinedMedia(stored) };
  writeDayFile(username, tripId, slug, next);
  return { ok: true, day: next };
}

export type DayMediaDetachOutcome =
  | { ok: true; day: DayFile }
  | { ok: false; error: "unknown_day" }
  | { ok: false; error: "unknown_media"; problems: ProblemRow[] };

/**
 * Take photographs off a day's own gallery, by the `src` they were attached
 * with. Deliberately does not delete the underlying bytes or the sidecar —
 * that is `DELETE /api/v2/{user}/media` (./media.ts's `deleteMediaV2`,
 * which already best-effort-detaches from every day that names the removed
 * src): this door is the reversible half, for a photograph moving to
 * another day or coming off a gallery that named it by mistake, and the
 * destructive half already exists and is not duplicated here.
 *
 * `declined.media` is left untouched either way — detaching the day's last
 * photograph leaves `media` absent with no decline recorded, which is
 * exactly the state `dayWrite`'s own completeness check already knows how
 * to ask about the next time this day goes through a full write (PATCH or
 * publish): this door does not need to anticipate that question itself.
 */
export function detachDayMedia(
  username: string,
  tripId: string,
  slug: string,
  srcs: readonly string[],
): DayMediaDetachOutcome {
  const stored = readDayFile(username, tripId, slug);
  if (!stored) return { ok: false, error: "unknown_day" };

  const have = new Set((stored.media ?? []).map((m) => m.src));
  const problems = srcs
    .filter((src) => !have.has(src))
    .map((src) => ({
      field: "src",
      problem: `"${src}" is not a photograph this day's own gallery has — see GET .../days/${slug}.`,
    }));
  if (problems.length > 0) return { ok: false, error: "unknown_media", problems };

  const remove = new Set(srcs);
  const remaining = (stored.media ?? []).filter((m) => !remove.has(m.src));
  const next: DayFile = { ...stored, media: remaining.length > 0 ? remaining : undefined };
  writeDayFile(username, tripId, slug, next);
  return { ok: true, day: next };
}
