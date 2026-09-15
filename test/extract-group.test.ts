import { describe, expect, test } from "vitest";
import { groupIntoDays } from "@/lib/extract/group";
import type { PhotoRow } from "@/lib/staging/manifest";

const p = (id: string, takenAt?: string, lat?: number, lng?: number): PhotoRow => ({
  id, filename: id, bytes: 1, kind: "image", takenAt, date: takenAt?.slice(0, 10), lat, lng,
});

describe("grouping staged photographs into days", () => {
  test("one day's photographs make one group", () => {
    const groups = groupIntoDays([
      p("a", "2019-07-02T10:07:00", 15.88, 108.33),
      p("b", "2019-07-02T10:09:00", 15.88, 108.33),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2019-07-02");
    expect(groups[0].photoIds).toEqual(["a", "b"]);
  });

  test("photographs with no date land in one undated group, not on today", () => {
    const groups = groupIntoDays([p("a"), p("b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].undated).toBe(true);
    expect(groups[0].date).toBe("");
  });

  test("a group with no coordinate anywhere has no coordinate", () => {
    const groups = groupIntoDays([p("a", "2019-07-05T12:00:00")]);
    expect(groups[0].lat).toBeUndefined();
  });

  test("R18 — two clusters sharing a date merge into one group", () => {
    // A museum morning and a dinner across town: same date but ten hours
    // apart, past DEFAULT_GAP_HOURS (5h), so `clusterMedia` splits them into
    // two clusters on its own — exactly what a day board must not show as
    // two rows.
    const groups = groupIntoDays([
      p("morning1", "2019-07-02T09:00:00", 15.88, 108.33),
      p("morning2", "2019-07-02T09:10:00", 15.88, 108.33),
      p("evening1", "2019-07-02T19:00:00", 16.05, 108.2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2019-07-02");
    // Chronological order preserved across the merged clusters.
    expect(groups[0].photoIds).toEqual(["morning1", "morning2", "evening1"]);
    // The coordinate comes from the larger cluster (the two morning photos),
    // not a mean of the two places.
    expect(groups[0].lat).toBeCloseTo(15.88, 3);
  });
});
