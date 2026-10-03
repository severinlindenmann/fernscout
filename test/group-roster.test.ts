import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { parseRoster } from "@/lib/groupRoster";
import { tripDays } from "@/lib/tripDays";

const lea = { id: "a1", name: " Lea " };
const noah = { id: "b2", name: "Noah" };

describe("B2435 group roster", () => {
  it("accepts names and duty, trims, drops empty days, keeps days outside the trip", () => {
    const r = parseRoster({ students: [lea, noah], duty: { "2026-07-14": ["a1"], "2030-01-01": ["b2"], "2026-07-15": [] } });
    expect(r).toEqual({
      ok: true,
      roster: { students: [{ id: "a1", name: "Lea" }, noah], duty: { "2026-07-14": ["a1"], "2030-01-01": ["b2"] } },
    });
  });
  it("refuses duplicates, unknown duty ids, bad dates and non-objects", () => {
    expect(parseRoster({ students: [lea, { id: "c3", name: "lea" }], duty: {} })).toEqual({ ok: false, error: "duplicate_name" });
    expect(parseRoster({ students: [lea], duty: { "2026-07-14": ["zz"] } })).toEqual({ ok: false, error: "invalid_duty" });
    expect(parseRoster({ students: [lea], duty: { tuesday: ["a1"] } })).toEqual({ ok: false, error: "invalid_duty" });
    expect(parseRoster({ students: [{ id: "../x", name: "A" }], duty: {} })).toEqual({ ok: false, error: "invalid_student" });
    expect(parseRoster(null)).toEqual({ ok: false, error: "invalid_roster" });
  });
  it("lists every day of a trip inclusive", () => {
    expect(tripDays("2026-07-13", "2026-07-15")).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
    expect(tripDays("2026-07-15", "2026-07-13")).toEqual([]);
  });
});
