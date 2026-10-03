import { editEntry } from "@/lib/api/entries";
import { AS_AUTHOR, getDays } from "@/lib/entries";
import { tripRef } from "@/lib/trips";
import { placeForDay } from "./api";

/**
 * B2303 — "Days without a place". Days that already exist on a trip and name
 * no place, offered the place `placeForDay` (B2200) works out from the
 * owner's own history. Only ever an existing day: a date with no day gets
 * nothing, and a day that already names a place is never touched.
 *
 * This file reads no position itself — `placeForDay` is the one door, and
 * what leaves here is `{ name, country }`, never a coordinate. Callers are
 * owner-cookie doors only (`app/api/helper/[user]/gps/name-days/route.ts`,
 * the trip's route page, the import's commit); a bearer token never reaches
 * a proposed place, only `unplacedDates`'s bare dates.
 */

export type UnplacedDay = { date: string; slug: string; published: boolean };

/** One row per date, the lead entry — the one a fill would write to. */
export function unplacedDays(username: string, tripId: string): UnplacedDay[] {
  return getDays(tripRef(username, tripId), AS_AUTHOR)
    .filter((d) => d.entries.every((e) => e.location.trim() === ""))
    .map((d) => ({ date: d.date, slug: d.lead.slug, published: !d.lead.draft }));
}

export type ProposedDay = UnplacedDay & { name: string; country: string };

/** Only days the history can name — a day with no positions left after
 * private places and hidden stretches are removed is simply not listed. */
export function proposeDays(username: string, tripId: string): ProposedDay[] {
  return unplacedDays(username, tripId).flatMap((day) => {
    const place = placeForDay(username, tripId, day.date);
    return place ? [{ ...day, name: place.name, country: place.country }] : [];
  });
}

/** Writes the place of each ticked date — recomputed here, never taken from
 * the client, and skipped when the day no longer lacks one. */
export function fillDays(username: string, tripId: string, dates: string[]): { filled: string[]; skipped: string[] } {
  const ref = tripRef(username, tripId);
  const wanted = new Set(dates);
  const filled: string[] = [];
  const skipped: string[] = [];
  for (const day of proposeDays(username, tripId)) {
    if (!wanted.has(day.date)) continue;
    const written = editEntry(ref, day.slug, { location: day.name, ...(day.country ? { country: day.country } : {}) });
    (written.ok ? filled : skipped).push(day.date);
  }
  for (const date of wanted) if (!filled.includes(date) && !skipped.includes(date)) skipped.push(date);
  return { filled, skipped };
}
