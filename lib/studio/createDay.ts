import "server-only";
import { createDraft, type CostInput, type DraftInput } from "@/lib/api/entries";
import { attachStagedFiles } from "@/lib/api/staged";
import { readDayFile, writeDayFile, deleteDayFile } from "@/lib/api/v2/store";
import { v2Slug } from "@/lib/api/v2/days";
import { DAY_DECLINABLE_KEYS, dayPatch } from "@/lib/api/v2/schemas/day";
import { declineReason } from "@/lib/api/v2/schemas/shared";
import { getTrip, tripRef } from "@/lib/trips";
import { NO_PROSE } from "@/lib/helper/draft";
import { fillDayWeatherQuietly } from "@/lib/api/weather";
import { autoVisibilityDecline } from "@/lib/studio/declinables";

/**
 * "Add a day", written as one transaction — B1830, C2.
 *
 * `createDraft` (`lib/api/entries.ts`) is the one function every door onto
 * this content already goes through to make a bare day, so this is not a
 * second writer: it is that function, called with only what this flow
 * actually gathered, followed by two corrections that `createDraft`'s own
 * input shape has no room for —
 *
 * 1. **D1's free-text declines.** `DraftInput` only ever accepts the older
 *    `false`/`"unknown"` pair for the seven fields `lib/tracks.ts` tracks,
 *    which `buildDeclined` turns into one fixed sentence per field — not a
 *    person's own words, and not the fourteen-field vocabulary
 *    `DAY_DECLINABLES` (v2, B1598) actually asks about. So this flow leaves
 *    every field it means to decline **absent** from the `createDraft` call
 *    entirely, and writes the real, free-text reasons straight into the
 *    stored `declined` map immediately afterward — a direct read-modify-
 *    write of the file `createDraft` just made, the same kind of correction
 *    `.../unpublish/route.ts` and `attachGallery` already make to a day on
 *    disk without going back through the v2 wire schema.
 * 2. **Photographs.** `storeUploads` (behind `attachStagedFiles`) refuses to
 *    run until the day it is attaching to already exists, so `media` cannot
 *    be part of the first write when photographs are being attached in the
 *    same breath. It is attached right after, in the same call.
 *
 * **Why this is "one transaction" despite being three file operations.**
 * Nothing here is a database and there is no transaction log to roll back —
 * the guarantee is built the way the rest of this codebase already builds
 * one (`write-day/route.ts`'s own spend/refund pair is the same shape): do
 * the step that can still fail *last*, and undo everything before it if it
 * does. Attaching photographs is the only step downstream of this function
 * that can fail on something the caller does not fully control (a size
 * limit, a quota) — `storeUploads` itself already builds every file in a
 * staging directory and moves the whole batch into place only once it has
 * all succeeded, so a rejected batch leaves nothing on disk to clean up. The
 * one thing left standing on a rejection is the day file this function just
 * wrote, and this function deletes it before answering — so from a caller's
 * point of view nothing was kept, which is the claim C2 exists to check.
 */
export type CreateDayInput = {
  tripId: string;
  date: string;
  time?: string;
  title?: string;
  content?: string;
  location?: string;
  country?: string;
  lat?: number;
  lng?: number;
  /** Ids already resolved against the inbox — the caller (the route) is
   *  what checks they exist and belong to this owner; nothing here trusts a
   *  filename off the wire. Empty/absent means "none", which must already
   *  carry its own reason in `declined.media`. */
  mediaInboxIds?: string[];
  /** The one declinable this flow answers with a real action rather than a
   *  typed value — "look it up" (`DAY_DECLINABLES`' own words for `weather`)
   *  is a request the server can actually fulfil, so it is offered as the
   *  primary answer rather than folded into the decline screen. */
  weather?: boolean;
  /** B2233 — real values only, checked by `createDraft`'s own validator. */
  costs?: CostInput[];
  transportMode?: string;
  tags?: string[];
  /** Every field this flow means to answer as "no" (D1) — free text,
   *  checked against the same floor the v2 API itself enforces
   *  (`declineReason`, at least 10 characters) so a decline typed here can
   *  never be weaker than one sent by an agent. */
  declined: Partial<Record<(typeof DAY_DECLINABLE_KEYS)[number], string>>;
  /** `test: true` only — see AGENTS.md's one exception for invented
   *  content, and `lib/types.ts` for why the system owns this flag rather
   *  than the prose declaring itself fictional. */
  test?: boolean;
};

export type CreateDayResult =
  | { ok: true; tripId: string; slug: string }
  | { ok: false; error: "unknown_trip" | "invalid_entry" | "day_write_failed" | "invalid_media" | "unknown_inbox_file" | "not_attached"; detail?: unknown };

export async function createDayTransactional(username: string, input: CreateDayInput): Promise<CreateDayResult> {
  const ref = tripRef(username, input.tripId);
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  // B2233 — `createDraft` does not check these itself; the v2 day schema's
  // own shapes do, so the studio can never write what an agent could not.
  const extras = {
    ...(input.costs?.length ? { costs: input.costs } : {}),
    ...(input.transportMode ? { transportMode: input.transportMode } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };
  const checked = dayPatch.safeParse(extras);
  if (!checked.success) return { ok: false, error: "invalid_entry", detail: checked.error.issues };

  const draftInput: DraftInput = {
    date: input.date,
    // NO_PROSE ("…") is this codebase's own way of writing "nothing here
    // yet" — B1442's placeholder, not a word this flow invented. A real,
    // empty string is refused by `validateDraft` ("content is required"),
    // so an honestly empty body has to be spelled this way to be written at
    // all; every reader that already understands NO_PROSE treats it exactly
    // as blank.
    content: input.content && input.content.trim() !== "" ? input.content : NO_PROSE,
    ...(input.title && input.title.trim() !== "" ? { title: input.title.trim() } : {}),
    ...(input.time ? { time: input.time } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.country ? { country: input.country } : {}),
    ...(input.lat !== undefined ? { lat: input.lat } : {}),
    ...(input.lng !== undefined ? { lng: input.lng } : {}),
    ...(input.weather ? { weather: true } : {}),
    // The schema's own output, so a cost label arrives trimmed as it would
    // through the v2 door.
    ...(checked.data as typeof extras),
    ...(input.test ? { test: true } : {}),
  };

  const written = createDraft(ref, draftInput);
  if (!written.ok) return { ok: false, error: "day_write_failed", detail: written };

  const slug = v2Slug(input.date, written.slug);

  // A request, serviced quietly — same call the legacy wizard's own
  // `POST /api/helper/[user]/day` already makes right after `createDraft`.
  // Awaited and its failure swallowed: the day is already on disk and
  // correctly still carries `weather: true` (a pending request) if the
  // lookup could not answer, which is the honest state either way.
  if (input.weather) {
    await fillDayWeatherQuietly(ref, written.slug).catch(() => undefined);
  }

  // Correction 1 — the real, free-text declines, checked against the same
  // floor v2 itself enforces before a single one is kept. `visibility`
  // rides along here too, always, whatever the caller sent for it — this
  // flow never has a "who sees this" question of its own (spec §5's gather
  // steps have no such screen), so it is declined with the system's own
  // true sentence about what that means (`autoVisibilityDecline`) rather
  // than left neither answered nor declined.
  const reasons = [
    ...Object.entries(input.declined).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string" && declineReason.safeParse(pair[1]).success,
    ),
    ["visibility", autoVisibilityDecline()] as [string, string],
  ];
  if (reasons.length > 0) {
    const stored = readDayFile(username, input.tripId, slug);
    if (stored) {
      const storedRecord = stored as unknown as Record<string, unknown>;
      const declined: Record<string, string> = { ...(stored.declined ?? {}) };
      for (const [field, reason] of reasons) {
        // A field the day already carries a real answer for is never
        // decline-worthy too — "both provided and declined" is exactly the
        // contradiction v2's own schema refuses. This flow's own gather
        // steps are what keep the two from colliding (a still-open field
        // that got answered elsewhere is removed from the still-open list
        // before it can reach a decline screen), and this is the belt this
        // braces itself against a caller that got that wrong.
        if (storedRecord[field] !== undefined) continue;
        declined[field] = reason;
      }
      writeDayFile(username, input.tripId, slug, { ...stored, declined });
    }
  }

  // Correction 2 — photographs, the one step that can still fail. Anything
  // it rejects unwinds the whole day, per the doc comment above.
  const ids = (input.mediaInboxIds ?? []).filter((id) => id.trim() !== "");
  if (ids.length > 0) {
    const attached = await attachStagedFiles(username, ref, written.slug, ids);
    if (!attached.ok) {
      deleteDayFile(username, input.tripId, slug);
      return { ok: false, error: attached.error, detail: attached };
    }
    if (!attached.attached.ok) {
      deleteDayFile(username, input.tripId, slug);
      return { ok: false, error: "not_attached", detail: attached.attached };
    }
  }

  return { ok: true, tripId: input.tripId, slug };
}
