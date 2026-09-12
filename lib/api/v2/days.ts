// Domain assembly for a v2 day document — B1612 (phase 2 step 3, parcel B).
//
// The seam with the media door (a sibling parcel, not built yet as this
// lands): a day's `media` items on the wire are `{src, caption?,
// visibility?}` (dayWrite) and on disk additionally carry `type`/`width`/
// `height`/`poster`, derived once at upload by the media subsystem
// (documents.ts's own comment on `DayFile`). Until that door exists there is
// nothing here that can derive them, so this file fills them with the
// smallest honest placeholder (`type: "image"`, `url` = `src`) rather than
// inventing dimensions — flagged everywhere it happens so the next reader
// finds it before trusting a width or a served URL that were never measured.
import type { DayWrite } from "./schemas/day";
import { isEnabled } from "@/lib/capabilities";
import type { DayFile } from "./documents";

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
 * already attached keeps whatever `type`/`width`/`height`/`poster` it had;
 * a `src` new to this write gets the placeholder described at the top of
 * this file, since nothing here can measure real bytes.
 */
export function toStoredMedia(
  items: readonly WireMediaItem[] | undefined,
  existing: DayFile["media"],
): DayFile["media"] | undefined {
  if (!items) return undefined;
  const bySrc = new Map((existing ?? []).map((m) => [m.src, m]));
  return items.map((item) => {
    const prior = bySrc.get(item.src);
    return {
      ...item,
      type: prior?.type ?? "image",
      ...(prior?.width !== undefined ? { width: prior.width } : {}),
      ...(prior?.height !== undefined ? { height: prior.height } : {}),
      ...(prior?.poster !== undefined ? { poster: prior.poster } : {}),
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

/** A stored `DayFile` → what `dayDoc.parse` needs to see: every media item
 * needs a `url`, which nothing but the media door can genuinely resolve yet
 * (`DayFile` itself carries no such field — see the file comment) — passed
 * through as the `src` itself in the meantime. */
export function dayEchoInput(day: DayFile): Record<string, unknown> {
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
    })),
  };
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
 * Whether a day's `weather: true` must be refused outright — B1617.
 *
 * `weather: true` is the one field on a day that asks the server to *do*
 * something rather than store what it was sent. An instance that cannot reach
 * the archive would never service it, now or in the nightly sweep, so the
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
    "server does not do weather — no lookup would happen, now or in the nightly sweep, so " +
    "nothing was written rather than accepting a request nobody will service. /api/health " +
    "says which capabilities this instance has and why each is off. Send the day without " +
    "the field, or decline it (declined.weather) if there is simply none to record. A " +
    "reading somebody actually took goes in `weather` as an object with its own source — " +
    "never one you believe."
  );
}
