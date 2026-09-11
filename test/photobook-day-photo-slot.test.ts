import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec } from "@/lib/photobook/spec";

/**
 * B1407. The day page's photo slot bleeds off the bottom edge on purpose, so
 * a full-resolution photograph can run under the folio — but centring a
 * *shrunk* photograph (one without the pixels to cover that slot, B641)
 * inside the same oversized box could put its lower edge on, or past, the
 * running foot.
 */

const SPEC = defaultSpec(BOOK_SIZES["square"]); // trim 200×200, bleed 3, safe 10

function photo(n: number, over: Partial<BookPhoto> = {}): BookPhoto {
  return { file: `p${n}.jpg`, webSrc: `/alex/media/asia-2026/day/${n}.jpg`, width: 4000, height: 3000, ...over };
}

function day(over: Partial<BookDay> = {}): BookDay {
  return {
    date: "2026-01-01",
    title: "Day one",
    location: "Somewhere",
    country: "Portugal",
    countryCode: "PT",
    lat: 37.5,
    lng: -8.5,
    paragraphs: ["A day that happened, with a photograph too small for its slot."],
    photos: [photo(1)],
    ...over,
  };
}

function source(d: BookDay): BookSource {
  return {
    trip: { id: "test-trip", title: "A test trip", start: d.date, end: d.date, intro: "The plan." },
    travellers: ["A"],
    figures: [],
    days: [d],
    route: [],
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
  };
}

function dayPagePhoto(d: BookDay) {
  const book = planBook(source(d), SPEC);
  const page = book.volumes[0].pages.find((p) => p.kind === "day" && p.photo);
  if (!page || page.kind !== "day" || !page.photo) throw new Error("no day photo page");
  return page.photo;
}

describe("the day page's photo slot", () => {
  test("a photograph without the resolution to cover the slot stays clear of the running foot", () => {
    // 950×713 (4:3-ish) — squarely in the band where the slot's shrink
    // fallback engages but the result is still tall enough that centring it
    // in the old, bleed-extended box put its lower edge inside the safe
    // margin the folio prints in.
    const placed = dayPagePhoto(day({ photos: [photo(1, { width: 950, height: 713 })] }));
    expect(placed.draw.y).toBeGreaterThanOrEqual(SPEC.safeMm);
    expect(placed.clip.y).toBeGreaterThanOrEqual(SPEC.safeMm);
    // And it did actually shrink — otherwise this proves nothing.
    expect(placed.draw.height).toBeLessThan(SPEC.size.trimHeightMm * 0.52 + SPEC.bleedMm);
  });

  test("a photograph with the resolution to cover the slot still bleeds to the edge, unmoved", () => {
    const placed = dayPagePhoto(day({ photos: [photo(1, { width: 4000, height: 3000 })] }));
    // Unchanged from before this fix: the slot itself bleeds past the trim.
    expect(placed.clip.y).toBeLessThan(0);
    expect(placed.clip.height).toBe(SPEC.size.trimHeightMm * 0.52 + SPEC.bleedMm);
  });
});
