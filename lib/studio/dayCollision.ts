/**
 * "Add this to it?" — B2676 (V2.1, decision D4). A date that already has a
 * day is asked about inline, once, rather than taking over the whole page
 * the way the old full-screen collision outcome did: the new content simply
 * becomes another part of that day, a second entry on the same date.
 *
 * Pure: no fetch, no store, no `useState`. `AddDayFlow` asks
 * `GET /api/helper/{user}/day/for-date` the moment a date is chosen (the
 * route exists for exactly this, `day/for-date/route.ts`'s own doc comment)
 * and hands the answer here; the server's own 409 at write time is still the
 * real guard — this only decides what the inline ask, and the save that
 * follows "Yes, add to that day", have to do.
 */

import { slugify } from "@/lib/slug.ts";

export type ExistingDayOnDate = { slug: string; title: string; status: "draft" | "published" };

/**
 * A typed title that would collide with the day already on this date: a
 * second entry's own address is `date + slugify(title)`, so a title that
 * slugifies to the same thing as `existing.slug` is not a second entry at
 * all — it is the same file. "Add this to it?" can answer every other case
 * on its own; only this one still needs a different title before it can
 * save.
 */
export function titleCollidesWithExisting(title: string, existing: ExistingDayOnDate): boolean {
  return title.trim() !== "" && slugify(title) === existing.slug;
}

/** One part's own save, in order — B2676 decision 7 (parts stacked on one
 *  page). The first part is a second entry exactly when the day was already
 *  accepted onto an existing date ("Yes, add to that day"); every part after
 *  it is always a second entry, onto the day the first part itself just
 *  created. `time` is each part's own first photo's time (`DayPart.from`),
 *  which is what a second entry's address needs to tell two entries on one
 *  date apart. */
export type PartCommitPlan = { index: number; secondEntry: boolean; time: string };

export function partCommitPlan(
  parts: readonly { from: string | null }[],
  addingToExistingDay: boolean,
): PartCommitPlan[] {
  return parts.map((part, index) => ({
    index,
    secondEntry: addingToExistingDay || index > 0,
    time: part.from ?? "",
  }));
}
