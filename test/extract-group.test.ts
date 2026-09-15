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
});
