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
    media: day.media?.map((m) => ({ ...m, url: m.src })),
  };
}
