import { describe, expect, test } from "vitest";
import { groupWaitingDays, photoDay, photosInGroup, splitDayPhotos, tripForDate } from "@/lib/studio/dayCards";

/** B2193 — waiting photographs become one card per day they were taken on. */

const TRIPS = [{ id: "porto", title: "Porto", start: "2026-09-22", end: "2026-09-23" }];

describe("groupWaitingDays", () => {
  test("three dates are three cards, oldest first, each with its own photographs", () => {
    const photos = [
      { id: "c", takenAt: "2026-09-24T09:00:00" },
      { id: "a2", takenAt: "2026-09-22T18:00:00", location: "Porto", country: "Portugal" },
      { id: "a1", takenAt: "2026-09-22T08:00:00", location: "Porto", country: "Portugal" },
      { id: "b", takenAt: "2026-09-23T12:00:00", location: "Pinhão", country: "Portugal" },
    ];
    const { cards, undatedIds } = groupWaitingDays(photos, TRIPS);
    expect(cards.map((c) => [c.date, c.photoIds])).toEqual([
      ["2026-09-22", ["a1", "a2"]],
      ["2026-09-23", ["b"]],
      ["2026-09-24", ["c"]],
    ]);
    expect(cards[0].place).toBe("Porto");
    expect(undatedIds).toEqual([]);
  });

  test("two photographs either side of midnight stay on their own local days", () => {
    const { cards } = groupWaitingDays(
      [
        { id: "late", takenAt: "2026-09-22T23:50:00" },
        { id: "early", takenAt: "2026-09-23T00:10:00" },
      ],
      TRIPS,
    );
    expect(cards.map((c) => [c.date, c.photoIds])).toEqual([
      ["2026-09-22", ["late"]],
      ["2026-09-23", ["early"]],
    ]);
  });

  test("a photograph WhatsApp stripped of its date is listed apart, never filed onto a day", () => {
    const { cards, undatedIds } = groupWaitingDays([{ id: "wa" }, { id: "junk", takenAt: "nonsense" }, { id: "d", takenAt: "2026-09-22T10:00:00" }], TRIPS);
    expect(undatedIds).toEqual(["wa", "junk"]);
    expect(cards.flatMap((c) => c.photoIds)).toEqual(["d"]);
  });

  test("a covered day names its trip; uncovered days propose one trip over their run", () => {
    const { cards } = groupWaitingDays(
      [
        { id: "1", takenAt: "2026-09-20T10:00:00" },
        { id: "2", takenAt: "2026-09-22T10:00:00" },
        { id: "3", takenAt: "2026-09-25T10:00:00" },
        { id: "4", takenAt: "2026-09-27T10:00:00" },
        { id: "5", takenAt: "2026-10-15T10:00:00" },
      ],
      [{ id: "t", title: "T", start: "2026-09-21", end: "2026-09-22" }],
    );
    expect(cards.map((c) => [c.date, c.trip?.id ?? null, c.newTrip])).toEqual([
      ["2026-09-20", null, { start: "2026-09-20", end: "2026-09-20" }],
      ["2026-09-22", "t", null],
      ["2026-09-25", null, { start: "2026-09-25", end: "2026-09-27" }],
      ["2026-09-27", null, { start: "2026-09-25", end: "2026-09-27" }],
      ["2026-10-15", null, { start: "2026-10-15", end: "2026-10-15" }],
    ]);
  });

  test("no waiting photographs, no cards", () => {
    expect(groupWaitingDays([], TRIPS)).toEqual({ cards: [], undatedIds: [] });
  });
});

test("photosInGroup reads the same day rule as the cards", () => {
  const photos = [{ takenAt: "2026-09-22T23:59:00" }, { takenAt: undefined }, { takenAt: "2026-09-23T00:00:00" }];
  expect(photosInGroup(photos, "2026-09-22")).toEqual([photos[0]]);
  expect(photosInGroup(photos, "undated")).toEqual([photos[1]]);
  expect(photoDay("2026-09-22T10:00:00+02:00")).toBe("2026-09-22");
});

/** B2231 — a short trip inside a long ongoing one owns its own days. */
describe("tripForDate", () => {
  const LONG = { id: "usa-2026", title: "Across and back", start: "2026-06-01", end: "2026-12-31" };
  const SHORT = { id: "test-croatia-family", title: "Croatia", start: "2026-09-19", end: "2026-09-20" };

  test("two trips cover a date: the shorter one wins, whichever is listed first", () => {
    expect(tripForDate("2026-09-19", [LONG, SHORT])?.id).toBe("test-croatia-family");
    expect(tripForDate("2026-09-19", [SHORT, LONG])?.id).toBe("test-croatia-family");
    expect(tripForDate("2026-09-21", [LONG, SHORT])?.id).toBe("usa-2026");
    expect(tripForDate("2027-01-01", [LONG, SHORT])).toBeUndefined();
  });

  test("equal lengths keep the list's order (getTrips: current first, then latest ended)", () => {
    const a = { id: "b", title: "", start: "2026-09-18", end: "2026-09-20" };
    const b = { id: "a", title: "", start: "2026-09-19", end: "2026-09-21" };
    expect(tripForDate("2026-09-19", [a, b])?.id).toBe("b");
    expect(tripForDate("2026-09-19", [b, a])?.id).toBe("a");
  });

  test("the day card names the shorter trip", () => {
    const { cards } = groupWaitingDays([{ id: "p", takenAt: "2026-09-19T10:00:00" }], [LONG, SHORT]);
    expect(cards[0].trip?.id).toBe("test-croatia-family");
    expect(cards[0].newTrip).toBeNull();
  });
});

/** B2232 — the grid holds this day's photographs; the rest wait behind a disclosure. */
describe("splitDayPhotos", () => {
  test("3 photos for this day and 5 others: only the 3 are the day's", () => {
    const day = ["a", "b", "c"].map((id, i) => ({ id, takenAt: `2026-09-19T1${i}:00:00` }));
    const rest = [
      { id: "x1", takenAt: "2026-09-18T10:00:00" },
      { id: "x2", takenAt: "2026-09-20T10:00:00" },
      { id: "x3", takenAt: "2025-01-01T10:00:00" },
      { id: "undated" },
      { id: "junk", takenAt: "nonsense" },
    ];
    const { own, others } = splitDayPhotos([...rest, ...day], "2026-09-19", new Set());
    expect(own.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(others.map((p) => p.id)).toEqual(["x1", "x2", "x3", "undated", "junk"]);
  });

  test("a photograph chosen or brought in for the day stays, whatever its date; no date means none match", () => {
    const photos = [{ id: "a", takenAt: "2026-09-19T10:00:00" }, { id: "up" }, { id: "other", takenAt: "2026-09-18T10:00:00" }];
    expect(splitDayPhotos(photos, "2026-09-19", new Set(["up", "other"])).others).toEqual([]);
    expect(splitDayPhotos(photos, "", new Set()).own).toEqual([]);
  });
});
