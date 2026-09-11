import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS, parseOptions, type BookOptions } from "@/lib/photobook/options";
import { bookStrings, fill } from "@/lib/photobook/strings";

/**
 * Shaping one day by hand — B504.
 *
 * The promise that matters most is the one about days nobody touched: this is
 * an override, not a format, and a book whose owner arranged one day must plan
 * every other day exactly as it did before the feature existed.
 */

const SPEC = defaultSpec(BOOK_SIZES["square"]);
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

describe("choosing the front cover — B512", () => {
  const coverOf = (options: Partial<BookOptions>) => plan(options).volumes[0].cover.frontPhoto?.file;

  test("an untouched book keeps today's choice: the first photograph", () => {
    expect(coverOf({})).toBe("p1.jpg");
  });

  test("a chosen photograph runs on the cover instead", () => {
    expect(coverOf({ cover: "/alex/media/asia-2026/day/9.jpg" })).toBe("p9.jpg");
  });

  test("a cover naming a photograph no longer in the book falls back rather than printing a gap", () => {
    expect(coverOf({ cover: "/alex/media/asia-2026/day/999.jpg" })).toBe("p1.jpg");
  });
});

describe("cropping from a focal point — B513", () => {
  const src = (n: number) => `/alex/media/asia-2026/day/${n}.jpg`;

  test("a photograph nobody has touched crops exactly as it did before", () => {
    // The whole promise, same shape as the untouched-day test above:
    // `focalPoints: {}` and the feature might as well not be there.
    expect(JSON.stringify(plan({ focalPoints: {} }))).toBe(JSON.stringify(plan({})));
  });

  test("keeps a subject near the top of the photograph in a hero (full-bleed) slot", () => {
    // Day one is a hero day by the automatic rhythm, and p1 is its hero. A
    // full-bleed slot is square (the trim is), so a landscape hero — wider
    // than it is tall — is scaled to fill the slot's height exactly and has
    // no vertical crop margin to move a focal point within: only a portrait
    // photograph, taller than the slot after scaling, has one.
    const tallDays = [
      day(0, [photo(1, { width: 3000, height: 4000 }), photo(2), photo(3), photo(4)]),
      ...DAYS.slice(1),
    ];
    const drawOf = (options: Partial<BookOptions>) => {
      const page = planBook(source(tallDays), SPEC, { ...DEFAULT_OPTIONS, ...options })
        .volumes.flatMap((v) => v.pages)
        .find((p) => p.kind === "photos" && p.layout === "full-bleed");
      return page?.kind === "photos" ? page.placements[0].draw : undefined;
    };
    const centred = drawOf({});
    const top = drawOf({ focalPoints: { [src(1)]: { x: 0.5, y: 0 } } });
    const bottom = drawOf({ focalPoints: { [src(1)]: { x: 0.5, y: 1 } } });
    expect(centred).toBeDefined();
    expect(top).toBeDefined();
    expect(bottom).toBeDefined();
    // x is untouched — only the vertical anchor moved.
    expect(top!.x).toBe(centred!.x);
    // Asking to keep the top and the bottom must move the crop in opposite
    // directions, with the untouched centre in between.
    expect(top!.y).not.toBe(centred!.y);
    expect(bottom!.y).not.toBe(centred!.y);
    expect(top!.y).not.toBe(bottom!.y);
  });

  test("keeps a subject near an edge in a grid slot too", () => {
    // The same fixture "grid puts four to a page" uses: day two's photographs
    // after its own page's first (p5) go four to a page as a quad.
    const five = day(1, [photo(5), photo(6), photo(7), photo(8), photo(9)]);
    const quadOf = (options: Partial<BookOptions>) =>
      planBook(source([DAYS[0], five]), SPEC, { ...DEFAULT_OPTIONS, ...options })
        .volumes.flatMap((v) => v.pages)
        .find((p) => p.kind === "photos" && p.layout === "quad");
    const withDefault = { days: { "2026-01-02": { layout: "grid" as const } }, focalPoints: {} };
    const withFocal = {
      days: { "2026-01-02": { layout: "grid" as const } },
      focalPoints: { [src(6)]: { x: 0, y: 0 } },
    };
    const before = quadOf(withDefault);
    const after = quadOf(withFocal);
    expect(before?.kind === "photos" && before.placements[0].photo.file).toBe("p6.jpg");
    const beforeDraw = before?.kind === "photos" ? before.placements[0].draw : undefined;
    const afterDraw = after?.kind === "photos" ? after.placements[0].draw : undefined;
    expect(beforeDraw).not.toEqual(afterDraw);
    // The other three photographs in the same grid are untouched.
    const beforeRest = before?.kind === "photos" ? before.placements.slice(1) : [];
    const afterRest = after?.kind === "photos" ? after.placements.slice(1) : [];
    expect(afterRest).toEqual(beforeRest);
  });

  test("changes nothing on a photograph that is printed uncropped", () => {
    // A square photograph in the (square, 216×216mm) full-bleed slot scales
    // to fill it exactly on both axes — there is no overflow for a focal
    // point to redistribute.
    const square = day(0, [photo(1, { width: 3000, height: 3000 })]);
    const drawOf = (options: Partial<BookOptions>) =>
      planBook(source([square]), SPEC, { ...DEFAULT_OPTIONS, ...options })
        .volumes.flatMap((v) => v.pages)
        .find((p) => p.kind === "photos" && p.layout === "full-bleed");
    const centred = drawOf({});
    const corner = drawOf({ focalPoints: { [src(1)]: { x: 0, y: 1 } } });
    expect(centred).toEqual(corner);
  });
});

describe("what a request body may say", () => {
  const base = {
    size: "square",
    locale: "en",
    binding: "perfect",
    excludePhotos: [],
    includeText: true,
    includeMap: true,
    includeChapters: true,
    includeNames: true,
    includeCosts: true,
        includeCharts: false,
  };

  test("reads an order stored before binding was removed", () => {
    const parsed = parseOptions(base, SIZES);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("binding");
  });

  test("still refuses an object missing a field that matters", () => {
    const { locale: _omitted, ...withoutLocale } = base;
    expect(parseOptions(withoutLocale, SIZES)).toBeNull();
  });

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

  test("a run-on flag survives the boundary", () => {
    const parsed = parseOptions({ ...base, days: { "2026-01-01": { runOn: true } } }, SIZES);
    expect(parsed?.days["2026-01-01"]).toEqual({ runOn: true });
  });

  test("a run-on flag that is not a boolean is refused rather than coerced", () => {
    expect(
      parseOptions({ ...base, days: { "2026-01-01": { runOn: "true" } } }, SIZES),
    ).toBeNull();
  });

  test("excluded survives the boundary", () => {
    const parsed = parseOptions({ ...base, days: { "2026-01-01": { excluded: true } } }, SIZES);
    expect(parsed?.days["2026-01-01"]).toEqual({ excluded: true });
  });

  test("excluded that is not a boolean is refused rather than coerced", () => {
    expect(
      parseOptions({ ...base, days: { "2026-01-01": { excluded: "true" } } }, SIZES),
    ).toBeNull();
  });

  // B727. Every other flag is required; this one arrived late, and refusing
  // every body written before it existed would break stored arrangements and
  // agents alike over a decoration that is off by default.
  test("a body from before the figures switch existed is accepted, with it off", () => {
    expect(parseOptions(base, SIZES)?.includeFigureMarks).toBe(false);
  });

  test("but a figures switch that is not a boolean is still refused", () => {
    expect(parseOptions({ ...base, includeFigureMarks: "yes" }, SIZES)).toBeNull();
  });

  test("a day's own text flag survives the boundary — B703", () => {
    const parsed = parseOptions({ ...base, days: { "2026-01-01": { text: false } } }, SIZES);
    expect(parsed?.days["2026-01-01"]).toEqual({ text: false });
  });

  test("a text flag that is not a boolean is refused rather than coerced", () => {
    expect(parseOptions({ ...base, days: { "2026-01-01": { text: 0 } } }, SIZES)).toBeNull();
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

  test("a cover is optional, and a valid one survives the boundary", () => {
    expect(parseOptions({ ...base, days: {} }, SIZES)?.cover).toBeUndefined();
    expect(parseOptions({ ...base, days: {}, cover: "/a.jpg" }, SIZES)?.cover).toBe("/a.jpg");
  });

  test("a cover past the length ceiling is refused rather than truncated", () => {
    expect(
      parseOptions({ ...base, days: {}, cover: "/a".repeat(200) }, SIZES),
    ).toBeNull();
  });

  test("no focal points at all is an empty arrangement, not a refusal", () => {
    expect(parseOptions({ ...base, days: {} }, SIZES)?.focalPoints).toEqual({});
  });

  test("a valid focal point survives the boundary", () => {
    const parsed = parseOptions(
      { ...base, days: {}, focalPoints: { "/a.jpg": { x: 0.2, y: 0.9 } } },
      SIZES,
    );
    expect(parsed?.focalPoints).toEqual({ "/a.jpg": { x: 0.2, y: 0.9 } });
  });

  test("a focal point outside 0–1 is refused rather than clamped", () => {
    for (const bad of [{ x: -0.1, y: 0.5 }, { x: 0.5, y: 1.1 }, { x: Number.NaN, y: 0.5 }]) {
      expect(
        parseOptions({ ...base, days: {}, focalPoints: { "/a.jpg": bad } }, SIZES),
        JSON.stringify(bad),
      ).toBeNull();
    }
  });

  test("a focal point missing an axis is refused rather than defaulted", () => {
    expect(
      parseOptions({ ...base, days: {}, focalPoints: { "/a.jpg": { x: 0.5 } } }, SIZES),
    ).toBeNull();
  });

  test("an arrangement of focal points is refused whole rather than half-honoured", () => {
    const parsed = parseOptions(
      {
        ...base,
        days: {},
        focalPoints: { "/a.jpg": { x: 0.2, y: 0.2 }, "/b.jpg": { x: 2, y: 0.2 } },
      },
      SIZES,
    );
    expect(parsed).toBeNull();
  });

  test("more focal points than the ceiling allows are refused", () => {
    const many = Object.fromEntries(
      Array.from({ length: 20_001 }, (_, i) => [`/${i}.jpg`, { x: 0.5, y: 0.5 }]),
    );
    expect(parseOptions({ ...base, days: {}, focalPoints: many }, SIZES)).toBeNull();
  });
});

describe("letting a day run on — B517", () => {
  // Long enough to overflow the column beside a shared photograph on a
  // square page (about 11 lines fit there, this wraps to about 16) but
  // not so long that a second page of the same size could not hold the rest.
  const LONG_PARAGRAPH = Array.from({ length: 200 }, (_, i) => `Word${i}`).join(" ");

  function longDay(index: number, photos: BookPhoto[]): BookDay {
    return { ...day(index, photos), paragraphs: [LONG_PARAGRAPH] };
  }

  // Day index 1: not a hero day by the automatic rhythm (that is index 0 and
  // every third after it), so its first photograph shares the day's own page
  // rather than running full-bleed, which is the case B517 is about.
  const DATE = day(1, []).date;
  const overflowing = [day(0, [photo(1)]), longDay(1, [photo(2), photo(3)])];

  test("a day nobody has asked about still truncates and still says so", () => {
    const book = planBook(source(overflowing), SPEC, DEFAULT_OPTIONS);
    const warning = book.warnings.find((w) => w.code === "text-truncated");
    expect(warning).toBeDefined();
    // The day this warning is about is a structured field, not something a
    // reader has to parse out of `detail` — B517.
    expect(warning?.date).toBe(DATE);
    const dayPages = book.volumes[0].pages.filter((p) => p.kind === "day" && p.date === DATE);
    expect(dayPages).toHaveLength(1);
    expect(dayPages[0].kind === "day" && dayPages[0].truncated).toBe(true);
  });

  test("runOn gives the day the room, and the warning stops", () => {
    const book = planBook(source(overflowing), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DATE]: { runOn: true } },
    });
    expect(book.warnings.some((w) => w.code === "text-truncated")).toBe(false);
    const dayPages = book.volumes[0].pages.filter((p) => p.kind === "day" && p.date === DATE);
    // The words that overflowed the first page are on the second, not gone.
    expect(dayPages).toHaveLength(2);
    const [first, second] = dayPages;
    expect(first.kind === "day" && first.truncated).toBe(false);
    expect(second.kind === "day" && second.truncated).toBe(false);
    const allLines = dayPages.flatMap((p) => (p.kind === "day" ? p.lines : []));
    expect(allLines.some((l) => l.includes("Word0"))).toBe(true);
    expect(allLines.some((l) => l.includes("Word199"))).toBe(true);
  });

  test("the continuation page says it is one, and does not repeat the date", () => {
    const book = planBook(source(overflowing), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DATE]: { runOn: true } },
    });
    const dayPages = book.volumes[0].pages.filter((p) => p.kind === "day" && p.date === DATE);
    const [first, second] = dayPages;
    const title = overflowing[1].title; // "Day 2"
    expect(first.kind === "day" && first.title).toBe(title);
    expect(first.kind === "day" && first.dateLabel).not.toBe("");
    expect(second.kind === "day" && second.title).toBe(
      fill(bookStrings("en").continuedTitle, { title }),
    );
    // Two pages carrying the same date would read as two different days that
    // happen to share one, not as one day that ran long — B517.
    expect(second.kind === "day" && second.dateLabel).toBe("");
  });

  test("the continuation page carries the day's spare photograph rather than none", () => {
    const book = planBook(source(overflowing), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DATE]: { runOn: true } },
    });
    const dayPages = book.volumes[0].pages.filter((p) => p.kind === "day" && p.date === DATE);
    const [first, second] = dayPages;
    expect(first.kind === "day" && first.photo?.photo.file).toBe("p2.jpg");
    expect(second.kind === "day" && second.photo?.photo.file).toBe("p3.jpg");
    // p3 is spent on the continuation page, so it is not printed again on a
    // grouped photos page.
    const files = printed({ days: { [DATE]: { runOn: true } } });
    expect(files.filter((f) => f === "p3.jpg")).toHaveLength(1);
  });

  test("a day with no spare photograph runs text alone rather than manufacturing one", () => {
    const solo = [day(0, [photo(1)]), longDay(1, [photo(2)])];
    const book = planBook(source(solo), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DATE]: { runOn: true } },
    });
    const dayPages = book.volumes[0].pages.filter((p) => p.kind === "day" && p.date === DATE);
    expect(dayPages).toHaveLength(2);
    const [first, second] = dayPages;
    expect(first.kind === "day" && first.photo?.photo.file).toBe("p2.jpg");
    expect(second.kind === "day" && second.photo).toBeUndefined();
    expect(second.kind === "day" && second.truncated).toBe(false);
  });

  test("the page count follows, and lets a day run on for free", () => {
    // A trip long enough that the binder's 32-page minimum is not what is
    // padding the count — otherwise a book that already needed padding would
    // absorb the extra page and this would test the padding rule instead.
    const bigTrip = [
      ...Array.from({ length: 15 }, (_, i) =>
        day(i, [photo(i * 10 + 1), photo(i * 10 + 2), photo(i * 10 + 3), photo(i * 10 + 4)]),
      ),
      longDay(15, [photo(997), photo(998), photo(996), photo(995)]),
    ];
    const longDate = day(15, []).date;
    const options = { ...DEFAULT_OPTIONS, days: { [longDate]: { runOn: true } } };
    const withoutRunOn = planBook(source(bigTrip), SPEC, DEFAULT_OPTIONS);
    const withRunOn = planBook(source(bigTrip), SPEC, options);
    // Padding was not the thing doing the work here.
    expect(withoutRunOn.volumes[0].interiorPages).toBeGreaterThan(SPEC.pageCount.min);
    expect(withRunOn.volumes[0].interiorPages).toBeGreaterThan(withoutRunOn.volumes[0].interiorPages);
    // A book is priced as one object, from a single Gelato quote for the
    // whole thing — see test/photobook-pricing.test.ts for how the page
    // count factors into what the printer quotes.
  });
});

/**
 * B703 — one day's words, without touching the rest of the book.
 */
describe("leaving one day's prose out", () => {
  const DAYS = [0, 1].map((i) => day(i, [photo(i * 2 + 1), photo(i * 2 + 2)]));
  const prose = (book: ReturnType<typeof planBook>, date: string) =>
    book.volumes[0].pages
      .filter((p) => p.kind === "day" && p.date === date)
      .flatMap((p) => (p.kind === "day" ? p.lines : []));

  test("takes that day's words and leaves every other day's", () => {
    const book = planBook(source(DAYS), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DAYS[0].date]: { text: false } },
    });
    expect(prose(book, DAYS[0].date).join(" ")).not.toContain("A day that happened");
    expect(prose(book, DAYS[1].date).join(" ")).toContain("A day that happened");
  });

  test("the day is still in the book, with its heading and its date", () => {
    const book = planBook(source(DAYS), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DAYS[0].date]: { text: false } },
    });
    const page = book.volumes[0].pages.find((p) => p.kind === "day" && p.date === DAYS[0].date);
    expect(page && page.kind === "day" && page.title).toBe("Day 1");
  });

  test("a day cannot print words the book is not printing", () => {
    const book = planBook(source(DAYS), SPEC, {
      ...DEFAULT_OPTIONS,
      includeText: false,
      days: { [DAYS[0].date]: { text: true } },
    });
    expect(prose(book, DAYS[0].date).join(" ")).not.toContain("A day that happened");
  });

  test("a day nobody has touched is planned exactly as before", () => {
    const before = planBook(source(DAYS), SPEC, DEFAULT_OPTIONS);
    const after = planBook(source(DAYS), SPEC, {
      ...DEFAULT_OPTIONS,
      days: { [DAYS[0].date]: { text: false } },
    });
    expect(prose(after, DAYS[1].date)).toEqual(prose(before, DAYS[1].date));
  });
});
