import type { EditablePickerTrip } from "@/lib/studio/editDay";

/**
 * B1954 — the day picker's own first screen: `daysForEditPicker` lists
 * *every* trip and every entry, which B1881 made correct (one row per
 * entry) and, as a side effect, long — a journal with any history renders
 * its whole life before a person can choose the day from yesterday they
 * actually came for.
 *
 * This trims to the two most recent trips (in `daysForEditPicker`'s own
 * order — see its doc comment for why that order is "most recently
 * written to", not "most recently happened") and, within each, the two most
 * recent entries — regardless of which day groups they land in, so a day
 * that shares a date with an older one is not dragged along for free and a
 * lone recent entry is not padded out with a stale sibling.
 *
 * Shared by "Change a day" (`EditDayFlow`) and "Something is filed wrong"
 * (`ReshapeDayFlow`) — both read `daysForEditPicker`, and B1881 found the
 * same growth in both, so this is fixed once rather than twice.
 *
 * Deliberately plain — no "server-only" import like `lib/studio/editDay.ts`
 * itself, so both client components can call it directly on the full
 * picker they already hold, rather than a second server round trip.
 */
export const EDIT_PICKER_TRIP_LIMIT = 2;
export const EDIT_PICKER_ENTRY_LIMIT = 2;

export function cutEditPicker(trips: EditablePickerTrip[]): EditablePickerTrip[] {
  return trips.slice(0, EDIT_PICKER_TRIP_LIMIT).map((trip) => {
    const flatEntries = trip.days.flatMap((day) => day.entries.map((entry) => ({ date: day.date, entry })));
    const kept = new Set(flatEntries.slice(-EDIT_PICKER_ENTRY_LIMIT).map(({ entry }) => entry.slug));
    return {
      ...trip,
      days: trip.days
        .map((day) => ({ ...day, entries: day.entries.filter((entry) => kept.has(entry.slug)) }))
        .filter((day) => day.entries.length > 0),
    };
  });
}

/** Whether trimming actually hid anything — so "Show more" only appears
 *  when there is more to show. */
export function editPickerHasMore(trips: EditablePickerTrip[]): boolean {
  const total = trips.reduce((n, trip) => n + trip.days.reduce((m, day) => m + day.entries.length, 0), 0);
  const shown = cutEditPicker(trips).reduce((n, trip) => n + trip.days.reduce((m, day) => m + day.entries.length, 0), 0);
  return shown < total;
}
