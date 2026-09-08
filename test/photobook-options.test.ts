import { describe, expect, test } from "vitest";
import {
  planBook,
  type BookCosts,
  type BookDay,
  type BookPhoto,
  type BookSource,
} from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec, fitsRule } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS, initialBookOptions, parseOptions, type BookOptions } from "@/lib/photobook/options";

const SPEC = defaultSpec(BOOK_SIZES["square"]);

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
  byDay: [
    { date: "2026-01-01", amount: 600, cumulative: 600 },
    { date: "2026-01-02", amount: 600, cumulative: 1200 },
  ],
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
    figures: [],
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

  test("excluded: true drops a day's page and photographs, but not the route", () => {
    // Enough days that the book sits well above the binder's page-count
    // minimum — with only a handful, dropping one still gets padded back up
    // to the minimum and the page count would not visibly follow.
    const BIG = Array.from({ length: 40 }, (_, i) => day(i, { country: "Laos", countryCode: "LA" }));
    const withDay = planBook(source(BIG), SPEC, DEFAULT_OPTIONS);
    const withoutDay = planBook(source(BIG), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [BIG[1].date]: { excluded: true } },
    });
    const datesOf = (book: typeof withDay) =>
      book.volumes.flatMap((v) => v.pages).flatMap((p) => (p.kind === "day" ? [p.date] : []));
    expect(datesOf(withDay)).toContain(BIG[1].date);
    expect(datesOf(withoutDay)).not.toContain(BIG[1].date);
    expect(withoutDay.volumes[0].interiorPages).toBeLessThan(withDay.volumes[0].interiorPages);
    // The route is the whole trip, not the printed book — an excluded day
    // did not stop happening.
    const kindsOf = (book: typeof withDay) =>
      book.volumes.flatMap((v) => v.pages.map((p) => p.kind));
    expect(kindsOf(withoutDay)).toContain("route");
  });

  test("excluding every day of a country prints no chapter divider for it", () => {
    const excludeThailand = Object.fromEntries(
      DAYS.filter((d) => d.country === "Thailand").map((d) => [d.date, { excluded: true }]),
    );
    const book = planBook(source(DAYS), SPEC, { ...DEFAULT_OPTIONS, days: excludeThailand });
    const dividers = book.volumes
      .flatMap((v) => v.pages)
      .filter((p) => p.kind === "chapter")
      .map((p) => (p.kind === "chapter" ? p.country : null));
    expect(dividers).not.toContain("Thailand");
    expect(dividers).toContain("Laos");
  });

});

// B642 — the order page's first visit turns includeCosts/includeCharts on
// or off from what the trip actually recorded, rather than always starting
// from DEFAULT_OPTIONS's constant answer.
describe("initialBookOptions", () => {
  test("starts both off for a trip with neither a budget nor weather", () => {
    const options = initialBookOptions("en", false, false);
    expect(options.includeCosts).toBe(false);
    expect(options.includeCharts).toBe(false);
  });

  test("turns on costs alone for a trip with a budget but no weather", () => {
    const options = initialBookOptions("en", true, false);
    expect(options.includeCosts).toBe(true);
    expect(options.includeCharts).toBe(false);
  });

  test("turns on both for a trip with a budget and measured weather", () => {
    const options = initialBookOptions("en", true, true);
    expect(options.includeCosts).toBe(true);
    expect(options.includeCharts).toBe(true);
  });

  test("weather alone never turns charts on — there is nothing to chart without a budget too", () => {
    const options = initialBookOptions("en", false, true);
    expect(options.includeCharts).toBe(false);
  });

  test("carries every other DEFAULT_OPTIONS value and the requested locale unchanged", () => {
    const options = initialBookOptions("de", true, true);
    expect(options).toEqual({ ...DEFAULT_OPTIONS, locale: "de", includeCosts: true, includeCharts: true });
  });
});

/**
 * B756 — the two drawings start on where there is something to draw.
 *
 * They shipped off, and the owner who had asked for them went through the
 * questions, was shown both tiles, and reported the vehicles did not work.
 * A switch somebody has to find is a feature they do not have.
 */
describe("the figures and the vehicles on a first visit", () => {
  test("on when the journal has described somebody and the trip says how it moved", () => {
    const options = initialBookOptions("en", false, false, true, true);
    expect(options.includeFigureMarks).toBe(true);
    expect(options.includeVehicles).toBe(true);
  });

  test("off when there is nothing to draw, rather than on and silent", () => {
    const options = initialBookOptions("en", false, false, false, false);
    expect(options.includeFigureMarks).toBe(false);
    expect(options.includeVehicles).toBe(false);
  });

  test("the constant itself is unchanged — a caller with no trip to look at", () => {
    expect(DEFAULT_OPTIONS.includeFigureMarks).toBe(false);
    expect(DEFAULT_OPTIONS.includeVehicles).toBe(false);
  });
});


describe("choosing soft or hard — B900", () => {
  const SIZES = Object.keys(BOOK_SIZES);

  test("defaults to soft, which is what every book made before the choice was", () => {
    expect(DEFAULT_OPTIONS.coverType).toBe("soft");
  });

  test("reads an order stored before the cover could be chosen", () => {
    const { coverType: _gone, ...stored } = DEFAULT_OPTIONS;
    const parsed = parseOptions(stored, SIZES);
    expect(parsed?.coverType).toBe("soft");
  });

  test("refuses a cover that is not one of the two", () => {
    expect(parseOptions({ ...DEFAULT_OPTIONS, coverType: "leather" }, SIZES)).toBeNull();
  });

  test("a hardcover spec lays out a hardcover, and a softcover one does not", () => {
    const hard = defaultSpec(BOOK_SIZES.square, "hard");
    const soft = defaultSpec(BOOK_SIZES.square, "soft");
    expect(hard.cover).toBe("hard");
    expect(soft.cover).toBe("soft");
  });

  test("a size Gelato does not bind in the asked-for cover falls back rather than lying", () => {
    // There is no 280 mm softcover. A spec must never name a product that
    // cannot be ordered, so it resolves to the cover the size is made in.
    expect(defaultSpec(BOOK_SIZES["large-square"], "soft").cover).toBe("hard");
    expect(defaultSpec(BOOK_SIZES.pocket, "hard").cover).toBe("soft");
  });
});
