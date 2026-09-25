// Move, split and merge a day — B1903, v2's own door onto
// lib/studio/reshapeDay.ts (B1832). See that module's header for the shape
// this wraps: a day's public address is trip id + bare slug, never the date,
// so a same-trip date-only move is invisible to a reader while a trip
// change is the one case that moves an already-published address.
import { z } from "zod";
import { ID_RE } from "../../../tripWrite";
import { isoDate } from "./shared";
import { daySlug } from "./day";

/** Same pattern `dayWrite`'s own `time` field validates against (day.ts) —
 * duplicated rather than imported because that field is not exported on its
 * own; both must keep matching HH:MM, 24-hour. */
const timeOfDay = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dayMoveRequest = z.strictObject({
  /** The trip to move the day INTO. Same trip as the URL's `{trip}` is a
   * same-trip, date-only move — real, and now documented rather than only
   * composable (B1903's own "Why"). */
  toTripId: z.string().regex(ID_RE),
  date: isoDate,
});

export const dayMoveResult = z.strictObject({
  ok: z.literal(true),
  /** Where the day now lives — GET it from here. */
  tripId: z.string(),
  slug: z.string().regex(daySlug),
  /** Whether this move changed the day's public permalink — only a trip
   * change on an already-published day does (moveDayTransactional's own
   * doc comment: the date never appears in the address). */
  addressChanged: z.boolean(),
  dryRun: z.boolean().optional(),
});

export const daySplitRequest = z.strictObject({
  /** How many of the day's photographs, in stored order, stay on the first
   * half — never proposed from EXIF, see reshapeDay.ts's own `SplitInput`. */
  photoCutIndex: z.number().int().nonnegative(),
  firstContent: z.string(),
  // Not `.min(1)` here — `splitDayTransactional` is the one place that
  // decides whether a title is usable (it also refuses one that slugifies
  // to nothing, e.g. "!!!"), and this schema must not duplicate that
  // judgement with a looser rule that could drift from it. An empty string
  // reaches the domain function and comes back `title_required`, same as
  // the studio's own door.
  secondTitle: z.string(),
  secondContent: z.string(),
  secondTime: z.string().regex(timeOfDay).optional(),
});

export const daySplitResult = z.strictObject({
  ok: z.literal(true),
  /** Unchanged — the URL's own `{slug}`, kept by the half that keeps the
   * original address. */
  firstSlug: z.string().regex(daySlug),
  /** The new half, always a draft — GET it to see it. */
  secondSlug: z.string().regex(daySlug),
  dryRun: z.boolean().optional(),
});

export const dayMergeRequest = z.strictObject({
  /** Absent = the URL's own `{trip}` — the ordinary case, one trip, two
   * updates on it. Present and DIFFERENT from the URL's `{trip}` is a
   * cross-trip merge, refused (M6✗, `cross_trip`) rather than silently
   * picking a winning trip — the same shape `mergeDaysTransactional` itself
   * checks, and the same reasoning the studio's own door gives. */
  withTripId: z.string().regex(ID_RE).optional(),
  /** The other update to fold in. */
  withSlug: z.string().regex(daySlug),
});

export const dayMergeResult = z.strictObject({
  ok: z.literal(true),
  /** The survivor's own slug — whichever of the two was earlier keeps its
   * address; GET it to see the merged content. */
  slug: z.string().regex(daySlug),
  dryRun: z.boolean().optional(),
});
