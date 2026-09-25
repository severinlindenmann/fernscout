import { describe, expect, it } from "vitest";
import { tripIdBase } from "@/lib/tripId";

// B2008 — a title that already ends in the start year must not get it twice.
const CASES: Array<{ title: string; start: string; want: string }> = [
  { title: "Asien 2027", start: "2027-02-12", want: "asien-2027" },
  { title: "Asien", start: "2027-02-12", want: "asien-2027" },
  { title: "Rückblick 2019", start: "2027-02-12", want: "ruckblick-2019-2027" },
];

describe("tripIdBase", () => {
  for (const { title, start, want } of CASES) {
    it(`("${title}", "${start}") -> "${want}"`, () => {
      expect(tripIdBase(title, start)).toBe(want);
    });
  }
});
