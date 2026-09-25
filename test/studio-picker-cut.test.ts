import { describe, expect, test } from "vitest";
import { cutEditPicker, editPickerHasMore, EDIT_PICKER_TRIP_LIMIT, EDIT_PICKER_ENTRY_LIMIT } from "@/lib/studio/pickerCut";
import type { EditablePickerTrip } from "@/lib/studio/editDay";

/**
 * B1954 — the day picker's own first screen listed every trip and every
 * entry the journal has ever had. `cutEditPicker` is the trim: the two most
 * recent trips (in whatever order `daysForEditPicker` itself hands over —
 * see its own doc comment for why that is "most recently written to"), the
 * two most recent entries within each, regardless of which day group they
 * land in.
 */

function entry(slug: string, title = slug) {
  return { slug, title, status: "published" as const };
}

function trip(tripId: string, days: { date: string; slugs: string[] }[]): EditablePickerTrip {
  return {
    tripId,
    tripTitle: tripId,
    days: days.map((d) => ({ date: d.date, entries: d.slugs.map((s) => entry(s)) })),
  };
}

describe("cutEditPicker — B1954's own trim", () => {
  test("keeps only the first two trips and, within each, the two most recent entries", () => {
    const picker: EditablePickerTrip[] = [
      trip("a", [
        { date: "2026-01-01", slugs: ["a1"] },
        { date: "2026-01-02", slugs: ["a2"] },
        { date: "2026-01-03", slugs: ["a3"] },
      ]),
      trip("b", [{ date: "2026-02-01", slugs: ["b1"] }]),
      trip("c", [{ date: "2026-03-01", slugs: ["c1"] }]),
    ];

    const cut = cutEditPicker(picker);

    expect(cut.map((t) => t.tripId)).toEqual(["a", "b"]);
    // Trip "a" had three entries; only the two most recent (a2, a3) survive
    // — a1, and the day it lived on, are gone entirely.
    const tripA = cut.find((t) => t.tripId === "a")!;
    expect(tripA.days.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-03"]);
    expect(tripA.days.flatMap((d) => d.entries.map((e) => e.slug))).toEqual(["a2", "a3"]);
  });

  test("several entries sharing a date are trimmed as individual entries, not by day group", () => {
    const picker: EditablePickerTrip[] = [
      trip("a", [
        { date: "2026-01-01", slugs: ["old"] },
        { date: "2026-01-02", slugs: ["mid-1", "mid-2"] },
      ]),
    ];
    const cut = cutEditPicker(picker);
    // Only room for two entries total, and both live on the same day — the
    // older, separate day is dropped entirely rather than half-shown.
    expect(cut[0].days).toEqual([{ date: "2026-01-02", entries: [entry("mid-1"), entry("mid-2")] }]);
  });

  test("editPickerHasMore is false once the picker already fits inside the limits", () => {
    const picker: EditablePickerTrip[] = [trip("a", [{ date: "2026-01-01", slugs: ["a1"] }])];
    expect(picker.length).toBeLessThanOrEqual(EDIT_PICKER_TRIP_LIMIT);
    expect(editPickerHasMore(picker)).toBe(false);
  });

  test("editPickerHasMore is true when a third trip or a third entry is hidden", () => {
    const threeTrips: EditablePickerTrip[] = [
      trip("a", [{ date: "2026-01-01", slugs: ["a1"] }]),
      trip("b", [{ date: "2026-02-01", slugs: ["b1"] }]),
      trip("c", [{ date: "2026-03-01", slugs: ["c1"] }]),
    ];
    expect(editPickerHasMore(threeTrips)).toBe(true);

    const threeEntriesOneTrip: EditablePickerTrip[] = [
      trip("a", [
        { date: "2026-01-01", slugs: ["a1"] },
        { date: "2026-01-02", slugs: ["a2"] },
        { date: "2026-01-03", slugs: ["a3"] },
      ]),
    ];
    expect(editPickerHasMore(threeEntriesOneTrip)).toBe(true);
  });

  // Documents the limits rather than hard-coding "2" everywhere a test
  // wants it — if the shape ever changes, this is the one place that says
  // by how much.
  test("the limits are two trips of two entries each", () => {
    expect(EDIT_PICKER_TRIP_LIMIT).toBe(2);
    expect(EDIT_PICKER_ENTRY_LIMIT).toBe(2);
  });
});
