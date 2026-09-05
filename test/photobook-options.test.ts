import { describe, expect, test } from "vitest";
import {
  planBook,
  type BookCosts,
  type BookDay,
  type BookPhoto,
  type BookSource,
} from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec, SADDLE_STITCH, fitsRule } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS, type BookOptions } from "@/lib/photobook/options";

const SPEC = defaultSpec(BOOK_SIZES["square-210"]);

function photo(over: Partial<BookPhoto> = {}): BookPhoto {
  return { file: "a.jpg", width: 4000, height: 3000, ...over };
}

function day(index: number, over: Partial<BookDay> = {}): BookDay {
  const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    date,
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: index > 2 ? "Laos" : "Thailand",
    countryCode: index > 2 ? "LA" : "TH",
    lat: 13.7 + index * 0.01,
    lng: 100.5 + index * 0.01,
    paragraphs: ["We walked a long way and ate something we could not name."],
    photos: [photo({ file: `p${index}-a.jpg`, caption: "A caption" }), photo({ file: `p${index}-b.jpg` })],
    ...over,
  };
}

const COSTS: BookCosts = {
  baseCurrency: "CHF",
  total: 1200,
  preparation: 300,
  onTheRoad: 900,
  perDay: 240,
  byCategory: [{ category: "Food", amount: 400 }],
  byCountry: [{ country: "Thailand", amount: 1200, nights: 5 }],
};

function source(days: BookDay[]): BookSource {
  return {
    trip: {
      id: "asia-2026",
      title: "A test trip",
      tagline: "Somewhere and back",
      start: days[0].date,
      end: days[days.length - 1].date,
      intro: "The plan was simple and it stayed simple.",
    },
    travellers: ["Alex"],
    days,
    route: days.map((d) => ({ location: d.location, country: d.country, lat: d.lat, lng: d.lng })),
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
    costs: COSTS,
  };
}

const DAYS = [day(0), day(1), day(2), day(3), day(4)];
const kinds = (options: BookOptions) =>
  planBook(source(DAYS), SPEC, options).volumes.flatMap((v) => v.pages.map((p) => p.kind));

describe("BookOptions", () => {
  test("the defaults plan the same book the CLI plans", () => {
    const withOptions = planBook(source(DAYS), SPEC, DEFAULT_OPTIONS);
    const without = planBook(source(DAYS), SPEC);
    expect(JSON.stringify(withOptions)).toBe(JSON.stringify(without));
  });

  test("includeMap: false removes the route spread and nothing else", () => {
    expect(kinds(DEFAULT_OPTIONS)).toContain("route");
    expect(kinds({ ...DEFAULT_OPTIONS, includeMap: false })).not.toContain("route");
  });

  test("includeChapters: false removes the dividers but keeps the days", () => {
    const off = kinds({ ...DEFAULT_OPTIONS, includeChapters: false });
    expect(off).not.toContain("chapter");
    expect(off).toContain("day");
  });

  test("includeCosts: false removes the cost page", () => {
    expect(kinds(DEFAULT_OPTIONS)).toContain("costs");
    expect(kinds({ ...DEFAULT_OPTIONS, includeCosts: false })).not.toContain("costs");
  });

  test("includeText: false keeps the day page but empties its prose and captions", () => {
    const book = planBook(source(DAYS), SPEC, { ...DEFAULT_OPTIONS, includeText: false });
    const days = book.volumes.flatMap((v) => v.pages).filter((p) => p.kind === "day");
    expect(days.length).toBeGreaterThan(0);
    for (const page of days) {
      if (page.kind !== "day") continue;
      expect(page.lines).toEqual([]);
      expect(page.captions).toEqual([]);
    }
  });

  test("every toggle still yields a plan the binder accepts", () => {
    const combinations: BookOptions[] = [
      DEFAULT_OPTIONS,
      { ...DEFAULT_OPTIONS, includeText: false, includeMap: false },
      { ...DEFAULT_OPTIONS, includeChapters: false, includeCosts: false },
      { ...DEFAULT_OPTIONS, includeText: false, includeMap: false, includeChapters: false, includeCosts: false },
    ];
    for (const options of combinations) {
      const book = planBook(source(DAYS), SPEC, options);
      for (const volume of book.volumes) {
        expect(fitsRule(volume.interiorPages, SPEC.pageCount)).toBe(true);
      }
    }
  });

  test("saddle stitch plans a legal short book", () => {
    const spec = { ...defaultSpec(BOOK_SIZES["square-210"]), pageCount: SADDLE_STITCH };
    const book = planBook(source([day(0)]), spec, DEFAULT_OPTIONS);
    for (const volume of book.volumes) {
      expect(fitsRule(volume.interiorPages, SADDLE_STITCH)).toBe(true);
    }
  });
});
