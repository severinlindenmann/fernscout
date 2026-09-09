import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";

/**
 * B534's drill-in reads a "photos" page's `date` straight off the plan
 * rather than reconstructing it on the client by scanning backwards for the
 * nearest preceding "day" page — the ticket calls that out by name as the
 * bug to avoid, because it silently reattaches to the wrong day the first
 * time the page order changes. This pins the promise the other end of that
 * relies on: the date survives exactly the kind of renumbering B534 worried
 * about — `expandToMinimum` splitting a multi-photo page into several.
 */

const SPEC = defaultSpec(BOOK_SIZES["square"]);

function photo(n: number): BookPhoto {
  return { file: `p${n}.jpg`, webSrc: `/alex/media/asia-2026/day/${n}.jpg`, width: 4000, height: 3000 };
}

function day(index: number, photos: BookPhoto[]): BookDay {
  return {
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: "Thailand",
    countryCode: "TH",
    lat: 13.7,
    lng: 100.5,
    paragraphs: ["A day that happened."],
    photos,
  };
}

function source(days: BookDay[]): BookSource {
  return {
    trip: {
      id: "test-trip",
      title: "A test trip",
      start: days[0].date,
      end: days[days.length - 1].date,
      intro: "",
    },
    travellers: ["A"],
    figures: [],
    days,
    route: [],
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
  };
}

describe("a 'photos' page's date (B534)", () => {
  test("names the day it prints, not the day before it in page order", () => {
    const days = [
      day(0, [photo(1), photo(2)]),
      day(1, [photo(3), photo(4)]),
    ];
    const book = planBook(source(days), SPEC, DEFAULT_OPTIONS);
    const pages = book.volumes.flatMap((v) => v.pages).filter((p) => p.kind === "photos");
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.kind === "photos" && p.date).toBeTruthy();
    }
    // At least one page is attributed to each day — not both to whichever
    // day happens to come first.
    const dates = new Set(pages.map((p) => (p.kind === "photos" ? p.date : undefined)));
    expect(dates).toEqual(new Set([days[0].date, days[1].date]));
  });

  test("survives expandToMinimum splitting a page into several", () => {
    // One short day, forced well under the binder's minimum page count so
    // `expandToMinimum` has to break its grouped photos apart to pad the
    // book — the exact renumbering B534 says a page-keyed edit cannot
    // survive.
    const days = [day(0, [photo(1), photo(2), photo(3), photo(4)])];
    const book = planBook(source(days), SPEC, { ...DEFAULT_OPTIONS, includeChapters: false, includeMap: false });
    const photoPages = book.volumes.flatMap((v) => v.pages).filter((p) => p.kind === "photos");
    expect(photoPages.length).toBeGreaterThan(1);
    for (const p of photoPages) {
      expect(p.kind === "photos" && p.date).toBe(days[0].date);
    }
  });

  test("front matter carries no date — it belongs to no day", () => {
    const days = [day(0, [photo(1)]), day(1, [photo(2)])];
    const book = planBook(source(days), SPEC, DEFAULT_OPTIONS);
    const front = book.volumes
      .flatMap((v) => v.pages)
      .filter((p) => p.kind === "title" || p.kind === "colophon");
    expect(front.length).toBeGreaterThan(0);
    for (const p of front) {
      expect("date" in p).toBe(false);
    }
  });
});
