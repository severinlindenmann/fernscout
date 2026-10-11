import { describe, expect, test } from "vitest";
import { placeEntry } from "@/lib/entries";
import type { Day, Entry } from "@/lib/types";

const e = (slug: string, lat?: number, lng?: number) => ({ slug, lat, lng }) as unknown as Entry;

describe("placeEntry (B-2980)", () => {
  test("takes the first entry of the day that has coordinates, not blindly the lead", () => {
    const a = e("a", NaN, NaN);
    const b = e("b", 46.9, 7.4);
    const day = { date: "2026-10-02", entries: [a, b], lead: a } as Day;
    expect(placeEntry(day)).toBe(b);
  });
  test("falls back to the lead when nothing has coordinates", () => {
    const a = e("a", NaN, NaN);
    expect(placeEntry({ date: "x", entries: [a, e("b")], lead: a } as Day)).toBe(a);
  });
});
