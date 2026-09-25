import "server-only";
import { getAllEntries, getDays, AS_AUTHOR } from "@/lib/entries";
import { getTrips, tripRef } from "@/lib/trips";
import { journalCurrencies } from "@/lib/rates";
import type { Day, Entry } from "@/lib/types";

/**
 * "Change a day" (E1, spec §6) — the picker's own list.
 *
 * B1881 — this used to list one row per *day*, showing only its lead entry.
 * D3 (spec §1) settled that several entries may share a date (the example
 * journal has two on 2025-11-15, Lisbon, separated by time), and this flow
 * can create a second one (B1830's own collision screen) — so a day's
 * second entry was never findable by its own title, and opening its row
 * edited both entries at once. This now lists entries, grouped by the date
 * they share, each with its own title and time — reusing `getDays`
 * (`lib/entries.ts`), itself built directly on `getAllEntries`, rather than
 * a second traversal of the content directory.
 */
type EditablePickerEntry = {
  /** The entry's own slug — never the day's lead slug once there is more
   *  than one entry on a date. See `dayForEdit`. */
  slug: string;
  title: string;
  /** Present once several entries share a date — what tells "Into Italy"
   *  apart from "We stayed for dinner" on the same row group. */
  time?: string;
  status: "draft" | "published";
};

type EditablePickerDay = {
  date: string;
  entries: EditablePickerEntry[];
};

export type EditablePickerTrip = {
  tripId: string;
  tripTitle: string;
  days: EditablePickerDay[];
};

// `entry.slug` throughout this module is the bare, app-facing slug
// (`entrySlugFromFile`, lib/entries.ts) — the date prefix is stripped off
// the on-disk filename before it ever reaches an `Entry`. That is also what
// `OwnerTools`' own deep link and `AddDayFlow`'s collision screen already
// address a day by (`?slug=…`), so this reads the same value rather than
// the v2 store's date-prefixed filename stem.
// B1954 — "most recent" here means the dates actually written, not a trip's
// own declared range: a journal filled in long after the fact has entries
// dated the same as the trip's own dates, so those two orders only disagree
// when a trip is still being *added to* — a correction, a day typed in
// today, is what this picker exists for (its own doc comment above), so
// that is the order that should surface the trip a person is about to use
// it on. `days` is already chronological (`getDays`), so a trip's own last
// day is its most recent.
function mostRecentDate(trip: EditablePickerTrip): string {
  return trip.days.at(-1)?.date ?? "";
}

export function daysForEditPicker(username: string): EditablePickerTrip[] {
  const trips = getTrips(username).map((trip) => {
    const ref = tripRef(username, trip.id);
    const days = getDays(ref, AS_AUTHOR).map((day) => ({
      date: day.date,
      entries: day.entries.map((entry) => ({
        slug: entry.slug,
        title: entry.title || day.date,
        time: entry.time,
        status: (entry.draft ? "draft" : "published") as "draft" | "published",
      })),
    }));
    return { tripId: trip.id, tripTitle: trip.title, days };
  });
  return trips.sort((a, b) => mostRecentDate(b).localeCompare(mostRecentDate(a)));
}

/**
 * The day itself, plus the trip it belongs to and the trip's own audience —
 * everything `EditDay` needs.
 *
 * B1881 — resolved by *entry* slug, not lead slug: the picker now links to
 * one entry at a time, and opening it edits that entry, not the whole day.
 * `day` still carries the shape `EditDay` expects (`entries`/`lead`), built
 * around the one matched entry alone rather than every entry that date has,
 * so a second entry on the same date is never silently pulled in and saved
 * alongside one a person did not open. Searches every trip because a slug
 * does not say which one it is in; a journal's entry count is small enough
 * that this is a few file reads, not a real cost.
 */
export type EditableDay = {
  tripId: string;
  tripTitle: string;
  /** The trip's own dates, for the date field's band (B2167). */
  tripStart?: string;
  tripEnd?: string;
  day: Day;
  /** B2233 — `journalCurrencies`, for a cost line. */
  currencies?: string[];
};

export function dayForEdit(username: string, entrySlug: string): EditableDay | null {
  for (const trip of getTrips(username)) {
    const ref = tripRef(username, trip.id);
    const entry = getAllEntries(ref, AS_AUTHOR).find((e) => e.slug === entrySlug);
    if (entry) {
      return {
        tripId: trip.id,
        tripTitle: trip.title,
        tripStart: trip.start,
        tripEnd: trip.end,
        day: dayOfOneEntry(entry),
        currencies: journalCurrencies(username),
      };
    }
  }
  return null;
}

function dayOfOneEntry(entry: Entry): Day {
  return { date: entry.date, entries: [entry], lead: entry };
}
