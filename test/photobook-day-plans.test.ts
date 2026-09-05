import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS, parseOptions, type BookOptions } from "@/lib/photobook/options";

/**
 * Shaping one day by hand — B504.
 *
 * The promise that matters most is the one about days nobody touched: this is
 * an override, not a format, and a book whose owner arranged one day must plan
 * every other day exactly as it did before the feature existed.
 */

const SPEC = defaultSpec(BOOK_SIZES["square-210"]);
const SIZES = Object.keys(BOOK_SIZES);

function photo(n: number, over: Partial<BookPhoto> = {}): BookPhoto {
  return {
    file: `p${n}.jpg`,
    webSrc: `/alex/media/asia-2026/day/${n}.jpg`,
    width: 4000,
    height: 3000,
    ...over,
  };
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
      intro: "The plan was simple.",
    },
    travellers: ["A"],
    // Nobody described, so the book draws nobody — B497's rule, and not a
    // thing these tests are about.
    figures: [],
    days,
    route: [],
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
  };
}

const DAYS = [
  day(0, [photo(1), photo(2), photo(3), photo(4)]),
  day(1, [photo(5), photo(6), photo(7), photo(8)]),
  day(2, [photo(9), photo(10)]),
];

const plan = (options: Partial<BookOptions>) =>
  planBook(source(DAYS), SPEC, { ...DEFAULT_OPTIONS, ...options });

/** Every photo layout in the book, in page order. */
const layouts = (options: Partial<BookOptions>) =>
  plan(options)
    .volumes.flatMap((v) => v.pages)
    .filter((p) => p.kind === "photos")
    .map((p) => (p.kind === "photos" ? p.layout : ""));

/** The `file` of every photograph printed, in page order, day pages included. */
const printed = (options: Partial<BookOptions>) =>
  plan(options)
    .volumes.flatMap((v) => v.pages)
    .flatMap((p) =>
      p.kind === "photos"
        ? p.placements.map((x) => x.photo.file)
        : p.kind === "day" && p.photo
          ? [p.photo.photo.file]
          : [],
    );

describe("a day the owner never touched", () => {
  test("plans exactly as it did before per-day plans existed", () => {
    // The whole promise of an override: `days: {}` and the feature might as
    // well not be there.
    expect(JSON.stringify(plan({ days: {} }))).toBe(JSON.stringify(plan({})));
  });

  test("is unaffected by another day being arranged", () => {
    const untouched = layouts({});
    const one = layouts({ days: { "2026-01-02": { layout: "single" } } });
    // Day three's pages are the tail of both, and identical.
    expect(one.slice(-1)).toEqual(untouched.slice(-1));
  });
});

describe("choosing the photographs for a day", () => {
  test("prints exactly those, in the order given", () => {
    const files = printed({
      days: {
        "2026-01-01": {
          photos: [
            "/alex/media/asia-2026/day/3.jpg",
            "/alex/media/asia-2026/day/1.jpg",
          ],
        },
      },
    });
    // Day one contributes p3 and p1 and nothing else. They arrive in page
    // order rather than in list order: day one is a hero day, so the first
    // photograph chosen (p3) runs across the paper and the next (p1) goes on
    // the day's own page, which is printed before it.
    expect(files.slice(0, 2).sort()).toEqual(["p1.jpg", "p3.jpg"]);
    expect(files).not.toContain("p2.jpg");
    expect(files).not.toContain("p4.jpg");
    expect(files).toContain("p5.jpg");
  });

  test("a photograph that no longer exists is dropped, not invented", () => {
    // The arrangement outlives an entry being edited. Printing a picture that
    // is not there is the one outcome that must not happen.
    const files = printed({
      days: {
        "2026-01-01": {
          photos: ["/alex/media/asia-2026/day/1.jpg", "/alex/media/asia-2026/day/999.jpg"],
        },
      },
    });
    expect(files.slice(0, 1)).toEqual(["p1.jpg"]);
    expect(files.some((f) => f.includes("999"))).toBe(false);
  });

  test("an empty list is a day emptied on purpose, not a day left alone", () => {
    const files = printed({ days: { "2026-01-01": { photos: [] } } });
    for (const n of [1, 2, 3, 4]) expect(files).not.toContain(`p${n}.jpg`);
    expect(files).toContain("p5.jpg");
  });
});

describe("choosing the layout for a day", () => {
  test("text prints the day's words and none of its photographs", () => {
    const files = printed({ days: { "2026-01-01": { layout: "text" } } });
    for (const n of [1, 2, 3, 4]) expect(files).not.toContain(`p${n}.jpg`);
  });

  test("single gives each photograph its own page", () => {
    const got = layouts({ days: { "2026-01-02": { layout: "single" } } });
    // Day two is not a hero day by the automatic rhythm, so its first
    // photograph goes beside the words and the other three take a page each.
    expect(got.filter((l) => l === "feature").length).toBeGreaterThanOrEqual(3);
  });

  test("hero runs one photograph across the paper on a day that would not have", () => {
    const auto = layouts({});
    const forced = layouts({ days: { "2026-01-02": { layout: "hero" } } });
    expect(forced.filter((l) => l === "full-bleed").length).toBeGreaterThan(
      auto.filter((l) => l === "full-bleed").length,
    );
  });

  test("grid puts four to a page when the shapes allow it", () => {
    // Five, not four: the day's own page takes the first photograph — that is
    // B496's rule and it holds for chosen layouts too, because the
    // alternative is the empty prose page it was written to remove. The
    // layout applies to what is left.
    const five = day(1, [photo(5), photo(6), photo(7), photo(8), photo(9)]);
    const got = planBook(source([DAYS[0], five]), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { "2026-01-02": { layout: "grid" } },
    })
      .volumes.flatMap((v) => v.pages)
      .filter((p) => p.kind === "photos")
      .map((p) => (p.kind === "photos" ? p.layout : ""));
    expect(got).toContain("quad");
  });

  test("a chosen arrangement survives the page-count minimum", () => {
    // A short trip is grown to the binder's thirty-two pages by splitting
    // multi-photo pages apart. That must not undo a grid somebody chose: the
    // symptom is pressing the button and seeing nothing change, which reads as
    // the feature being broken rather than as a page-count rule.
    const five = day(1, [photo(5), photo(6), photo(7), photo(8), photo(9)]);
    const book = planBook(source([DAYS[0], five]), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { "2026-01-02": { layout: "grid" } },
    });
    const [volume] = book.volumes;
    // Genuinely short: the padding rule had to run for this to be a test.
    expect(volume.interiorPages).toBeGreaterThanOrEqual(SPEC.pageCount.min);
    expect(
      volume.pages.filter((p) => p.kind === "photos").map((p) => (p.kind === "photos" ? p.layout : "")),
    ).toContain("quad");
  });

  test("hero picks the photograph the owner starred, not the first", () => {
    // Day one is a hero day by the automatic rhythm, so one photograph runs
    // across the paper either way. Which one is the owner's to say.
    const heroOf = (options: Partial<BookOptions>) => {
      const page = plan(options)
        .volumes.flatMap((v) => v.pages)
        .find((p) => p.kind === "photos" && p.layout === "full-bleed");
      return page?.kind === "photos" ? page.placements[0].photo.file : undefined;
    };
    expect(heroOf({})).toBe("p1.jpg");
    expect(heroOf({ days: { "2026-01-01": { hero: "/alex/media/asia-2026/day/3.jpg" } } })).toBe(
      "p3.jpg",
    );
  });

  test("a starred photograph that is gone falls back rather than losing the hero", () => {
    const page = plan({ days: { "2026-01-01": { hero: "/alex/media/asia-2026/day/999.jpg" } } })
      .volumes.flatMap((v) => v.pages)
      .find((p) => p.kind === "photos" && p.layout === "full-bleed");
    expect(page?.kind === "photos" && page.placements[0].photo.file).toBe("p1.jpg");
  });

  test("the starred photograph is not also printed among the rest", () => {
    const files = printed({ days: { "2026-01-01": { hero: "/alex/media/asia-2026/day/3.jpg" } } });
    // Day one has four photographs; p3 is the hero and must appear once.
    expect(files.filter((f) => f === "p3.jpg")).toHaveLength(1);
  });

  test("grid falls back rather than cropping a panorama to a strip", () => {
    const wide = [photo(20, { width: 6000, height: 1500 }), photo(21), photo(22), photo(23)];
    const got = planBook(source([day(0, wide)]), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { "2026-01-01": { layout: "grid" } },
    })
      .volumes.flatMap((v) => v.pages)
      .filter((p) => p.kind === "photos")
      .map((p) => (p.kind === "photos" ? p.layout : ""));
    expect(got).not.toContain("quad");
  });
});

describe("what a request body may say", () => {
  const base = {
    size: "square-210",
    locale: "en",
    binding: "perfect",
    excludePhotos: [],
    includeText: true,
    includeMap: true,
    includeChapters: true,
    includeNames: true,
    includeCosts: true,
  };

  test("a valid arrangement survives the boundary", () => {
    const parsed = parseOptions(
      { ...base, days: { "2026-01-01": { layout: "grid", photos: ["/a.jpg"] } } },
      SIZES,
    );
    expect(parsed?.days["2026-01-01"]).toEqual({ layout: "grid", photos: ["/a.jpg"] });
  });

  test("no days at all is an empty arrangement, not a refusal", () => {
    expect(parseOptions(base, SIZES)?.days).toEqual({});
  });

  test("a key that is not a date is refused outright", () => {
    // It never reaches a filesystem, but a loose record from a request body is
    // the shape that later grows into one.
    for (const key of ["../../etc", "2026-1-1", "not-a-date", ""]) {
      expect(parseOptions({ ...base, days: { [key]: { layout: "grid" } } }, SIZES), key).toBeNull();
    }
  });

  test("a layout the book cannot draw is refused rather than ignored", () => {
    expect(parseOptions({ ...base, days: { "2026-01-01": { layout: "collage" } } }, SIZES)).toBeNull();
  });

  test("an arrangement is refused whole rather than half-honoured", () => {
    // One bad day must not leave the others silently applied: somebody spent
    // an evening on this and should be told, not quietly given three of five.
    const parsed = parseOptions(
      {
        ...base,
        days: { "2026-01-01": { layout: "grid" }, "2026-01-02": { layout: "nonsense" } },
      },
      SIZES,
    );
    expect(parsed).toBeNull();
  });

  test("absurd sizes are refused", () => {
    // Distinct dates: `i % 28` repeated them and the object collapsed to
    // twenty-eight keys, which is a fixture bug rather than a bound.
    const many = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, i) => {
        const d = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
        return [d, { layout: "auto" as const }];
      }),
    );
    expect(parseOptions({ ...base, days: many }, SIZES)).toBeNull();
    expect(
      parseOptions(
        { ...base, days: { "2026-01-01": { photos: Array(501).fill("/a.jpg") } } },
        SIZES,
      ),
    ).toBeNull();
  });
});
