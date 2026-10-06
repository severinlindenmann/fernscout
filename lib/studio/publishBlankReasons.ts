import "server-only";

/**
 * B2674 — what the studio itself can honestly say about a field it is
 * declining on the owner's behalf at publish time.
 *
 * Before this, every field the owner left blank when sharing a day was
 * recorded with one shared reason — "left blank when the owner shared this
 * day from the studio (not asked field by field)" — as if the owner had
 * been asked and chosen to say nothing. For most of these fields the studio
 * has no control to ask with at all yet (position, time zone, country,
 * weather, other languages), so that reason was a small fiction. This gives
 * each field its own honest sentence instead.
 *
 * Keyed on exactly the fields the studio may answer this way: every
 * `DAY_DECLINABLE_KEYS` (`lib/api/v2/schemas/day.ts`) except `visibility`
 * (never left blank from here — a blank `visibility` stays a hard 422) and
 * `status` (never actually blank at publish — `missingAtPublish` always
 * resolves the candidate to `"draft"` before checking).
 *
 * Not `lib/studio/declineReasons.ts` — that file is deliberately import-free
 * so a client component can bundle it without dragging the server's real
 * database drivers along; this one is a server-only publish-time helper and
 * a different field of work (a studio DOOR deciding what the OWNER left
 * blank, not a client screen's canned-reason parser), so it gets its own
 * name rather than widening that file's narrow contract.
 */
export const REASONS: Readonly<Record<string, string>> = {
  coordinates: "not known — no position in the photos and no place picked from the place list",
  timezone: "not known — no position in the photos and no place picked from the place list",
  country: "not known — no position in the photos and no place picked from the place list",
  countryCode: "not known — no position in the photos and no place picked from the place list",
  location: "not known — no position in the photos and no place picked from the place list",
  time: "no time given",
  tags: "no tags chosen",
  media: "no photographs",
  costs: "no costs given",
  transportMode: "no way of travelling given",
  // Only true once the owner has actually made that choice somewhere real —
  // today that is nowhere, so this is the one reason this file states a
  // claim ahead of the feature that will make it true (B2675's translate
  // mode). It is still truer than the shared reason it replaces: the day
  // genuinely has no translation, and this is why.
  translations: "the owner shows the original language to readers of other languages",
} as const;

/**
 * `weather` alone depends on whether there was anywhere to look it up — the
 * archive lookup needs a place, and a day with neither a position nor a
 * named location never had one to ask.
 */
export function publishBlankReasonFor(field: string, day: { coordinates?: unknown; location?: string }): string {
  if (field === "weather") {
    return day.coordinates || day.location
      ? "not known — no answer from the weather archive"
      : "not known — no place to look the weather up for";
  }
  const reason = REASONS[field];
  if (!reason) {
    throw new Error(
      `lib/studio/publishBlankReasons.ts has no reason for "${field}" — add one rather than falling back to a vague shared reason.`,
    );
  }
  return reason;
}
