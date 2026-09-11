import { describe, expect, it, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  BOOK_SIZES,
  contentBoxMm,
  defaultSpec,
  fitsRule,
  GELATO_PAGE_RULE,
  HERO_FLOOR_DPI,
  normalisePageCount,
  sideOf,
  productUidFor,
  sizesFor,
} from "@/lib/photobook/spec";
import {
  chaptersOf,
  groupPhotos,
  outline,
  photosIn,
  planBook,
  routeFitsOnePage,
  routeLabelPlacements,
  routeView,
  type BookDay,
  type BookPhoto,
  type BookSource,
  type BookVolume,
  type ProjectedStop,
} from "@/lib/photobook/plan";
import { formatDate, formatDateRange, measure, toWinAnsi, wrap } from "@/lib/photobook/text";
import { bookStrings } from "@/lib/photobook/strings";
import { renderCover, renderVolume } from "@/lib/photobook/render";
import {
  buildCloudprinterRequest,
  buildGelatoRequest,
  buildLuluRequest,
  buildPeechoRequest,
  buildRequest,
  availableProviders,
  type BookOrder,
} from "@/lib/photobook/providers";
import { pdfxReadiness, readIcc, readinessReport } from "@/lib/photobook/pdfx";
import { toPdfPath } from "@/lib/photobook/worldland";

// ---------------------------------------------------------------------------
// Building sources to plan against
// ---------------------------------------------------------------------------

const PHOTO_FILE = path.join(
  process.cwd(),
  "content",
  "example",
  "trips",
  "asia-2023",
  "media",
  "hue-to-hoi-an",
  "01.jpg",
);

function photo(over: Partial<BookPhoto> = {}): BookPhoto {
  return { file: "a.jpg", width: 4000, height: 3000, ...over };
}

function day(index: number, over: Partial<BookDay> = {}): BookDay {
  const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    date,
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: "Thailand",
    countryCode: "TH",
    lat: 13.7 + index * 0.01,
    lng: 100.5 + index * 0.01,
    paragraphs: ["We walked a long way and ate something we could not name."],
    photos: [photo({ file: `p${index}-a.jpg` }), photo({ file: `p${index}-b.jpg` })],
    ...over,
  };
}

function source(days: BookDay[], over: Partial<BookSource> = {}): BookSource {
  return {
    trip: {
      id: "test-trip",
      title: "A test trip",
      tagline: "Somewhere and back",
      start: days[0]?.date ?? "2026-01-01",
      end: days[days.length - 1]?.date ?? "2026-01-03",
      intro: "The plan was simple and it stayed simple.\n\nThat rarely happens.",
    },
    figures: [],
  travellers: ["A", "B"],
    days,
    route: days.map((d) => ({
      location: d.location,
      country: d.country,
      lat: d.lat,
      lng: d.lng,
    })),
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
    ...over,
  };
}

const SPEC = defaultSpec();

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe("book geometry", () => {
  test("page one is a right-hand page and sides alternate", () => {
    expect(sideOf(1)).toBe("right");
    expect(sideOf(2)).toBe("left");
    expect(sideOf(51)).toBe("right");
  });

  test("the gutter is on the spine side, whichever hand the page is", () => {
    const right = contentBoxMm(SPEC, "right");
    const left = contentBoxMm(SPEC, "left");
    expect(right.x).toBe(SPEC.gutterMm);
    expect(left.x).toBe(SPEC.safeMm);
    // Both columns are the same width, so a spread reads evenly.
    expect(right.width).toBeCloseTo(left.width, 6);
    // The inner margin is wider than the outer on both.
    expect(SPEC.gutterMm).toBeGreaterThan(SPEC.safeMm);
  });

});

describe("page-count rules", () => {
  test("rounds up to the minimum and to a whole signature", () => {
    const rule = { min: 32, max: 160, multipleOf: 4 };
    expect(normalisePageCount(5, rule)).toBe(32);
    expect(normalisePageCount(33, rule)).toBe(36);
    expect(normalisePageCount(36, rule)).toBe(36);
    expect(fitsRule(36, rule)).toBe(true);
    expect(fitsRule(34, rule)).toBe(false);
  });
});

describe("Gelato's real page-count rule", () => {
  it("is 28 to 200 in steps of 2", () => {
    expect(GELATO_PAGE_RULE).toEqual({ min: 28, max: 200, multipleOf: 2 });
  });

  it("accepts what the API accepts and refuses what it refuses", () => {
    for (const ok of [28, 30, 52, 160, 200]) expect(fitsRule(ok, GELATO_PAGE_RULE)).toBe(true);
    for (const no of [4, 20, 24, 27, 31, 33, 202]) expect(fitsRule(no, GELATO_PAGE_RULE)).toBe(false);
  });

  it("rounds a short trip up to the floor rather than below it", () => {
    expect(normalisePageCount(9, GELATO_PAGE_RULE)).toBe(28);
    expect(normalisePageCount(53, GELATO_PAGE_RULE)).toBe(54);
  });
});

describe("the sizes are the ones Gelato prints", () => {
  it("offers four, every uid real and none of them built by hand", () => {
    expect(Object.keys(BOOK_SIZES)).toEqual(["pocket", "square", "portrait", "large-square"]);
    for (const size of Object.values(BOOK_SIZES)) {
      expect(Object.keys(size.covers).length).toBeGreaterThan(0);
      for (const [cover, uid] of Object.entries(size.covers)) {
        expect(uid).toMatch(new RegExp(`^photobooks-${cover}cover_pf_`));
        expect(uid).not.toMatch(/pages/);
      }
    }
  });

  it("offers three sizes in each cover, which is why the cover is asked first", () => {
    expect(sizesFor("soft").map((s) => s.id)).toEqual(["pocket", "square", "portrait"]);
    expect(sizesFor("hard").map((s) => s.id)).toEqual(["square", "portrait", "large-square"]);
  });

  it("has no uid for a book Gelato does not bind", () => {
    // No 280 mm softcover and no 140 mm board. Null, never a fallback to
    // another product — a book printed in the wrong cover is not a near miss.
    expect(productUidFor("large-square", "soft")).toBeNull();
    expect(productUidFor("pocket", "hard")).toBeNull();
    expect(productUidFor("square", "hard")).toContain("photobooks-hardcover");
    expect(productUidFor("square", "soft")).toContain("photobooks-softcover");
  });

  it("is 200 mm square by default, not 210", () => {
    expect(BOOK_SIZES.square.trimWidthMm).toBe(200);
    expect(BOOK_SIZES.square.trimHeightMm).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// The planner, over the four shapes of trip that break layouts
// ---------------------------------------------------------------------------

function everyVolume(volumes: BookVolume[], fn: (v: BookVolume) => void) {
  for (const v of volumes) fn(v);
}

describe("planning a three-day trip", () => {
  const book = planBook(source([day(0), day(1), day(2)]), SPEC);
  const [volume] = book.volumes;

  test("is one volume, and a legal page count", () => {
    expect(book.volumes).toHaveLength(1);
    expect(fitsRule(volume.interiorPages, SPEC.pageCount)).toBe(true);
  });

  test("says out loud that a short trip is mostly blank in a perfect-bound book", () => {
    // Three days is about fifteen pages of content against a thirty-two page
    // minimum. There is no clever layout that fixes that, so the planner is
    // required to say so rather than quietly shipping empty leaves.
    const blanks = volume.pages.filter((p) => p.kind === "blank").length;
    expect(blanks).toBeGreaterThan(3);
    const warning = book.warnings.find((w) => w.code === "blank-padding");
    expect(warning?.detail).toContain("saddle stitch");
  });


  test("opens with the title on a recto and ends with the colophon", () => {
    expect(volume.pages[0].kind).toBe("title");
    expect(volume.pages[0].side).toBe("right");
    // And the book begins on the title page's own reverse — B1542 put a blank
    // leaf between the two and the owner did not want the paper spent.
    expect(volume.pages[1].kind).not.toBe("blank");
    const kinds = volume.pages.map((p) => p.kind);
    expect(kinds).toContain("colophon");
    expect(kinds.lastIndexOf("colophon")).toBeGreaterThan(kinds.lastIndexOf("chapter"));
  });

  test("every page carries its number and hand consistently", () => {
    volume.pages.forEach((page, i) => {
      expect(page.number).toBe(i + 1);
      expect(page.side).toBe(sideOf(i + 1));
    });
  });

  test("the route spread is a facing pair", () => {
    const route = volume.pages.filter((p) => p.kind === "route");
    expect(route).toHaveLength(2);
    expect(route[0].side).toBe("left");
    expect(route[1].side).toBe("right");
    expect(route[1].number).toBe(route[0].number + 1);
  });
});

describe("planning a 180-day trip", () => {
  const days = Array.from({ length: 180 }, (_, i) =>
    day(i, { country: i < 60 ? "Thailand" : i < 120 ? "Vietnam" : "Laos" }),
  );
  const book = planBook(source(days), SPEC);

  test("splits into volumes rather than exceeding the binder's maximum", () => {
    expect(book.volumes.length).toBeGreaterThan(1);
    expect(book.warnings.some((w) => w.code === "split-into-volumes")).toBe(true);
  });

  test("every volume is independently printable", () => {
    everyVolume(book.volumes, (v) => {
      expect(fitsRule(v.interiorPages, SPEC.pageCount)).toBe(true);
      expect(v.pages[0].kind).toBe("title");
      expect(v.spineWidthMm).toBeGreaterThan(0);
    });
  });

  test("each volume says which one it is, on the page and on the cover", () => {
    const first = book.volumes[0].pages[0];
    expect(first.kind === "title" && first.volume).toBe("Volume 1 of " + book.volumes.length);
    expect(book.volumes[1].cover.subtitle).toBe("Volume 2 of " + book.volumes.length);
  });

  test("no day is lost in the split", () => {
    const planned = book.volumes.flatMap((v) =>
      v.pages.filter((p) => p.kind === "day").map((p) => (p.kind === "day" ? p.date : "")),
    );
    expect(new Set(planned).size).toBe(180);
  });
});

describe("planning a trip with no photographs", () => {
  const book = planBook(
    source([day(0, { photos: [] }), day(1, { photos: [] }), day(2, { photos: [] })]),
    SPEC,
  );
  const [volume] = book.volumes;

  test("says so rather than producing an empty book", () => {
    expect(book.photoCount).toBe(0);
    expect(book.warnings.some((w) => w.code === "no-photos")).toBe(true);
  });

  test("still produces a legal book, with the prose in it", () => {
    expect(fitsRule(volume.interiorPages, SPEC.pageCount)).toBe(true);
    expect(volume.pages.some((p) => p.kind === "photos")).toBe(false);
    expect(volume.pages.filter((p) => p.kind === "day")).toHaveLength(3);
  });

  test("admits that the padding is padding", () => {
    // Nothing to expand, so blanks are the only way to reach the minimum —
    // and the planner must say so instead of quietly shipping empty leaves.
    expect(book.warnings.some((w) => w.code === "blank-padding")).toBe(true);
  });

  test("the cover has no photograph and does not pretend otherwise", () => {
    expect(volume.cover.frontPhoto).toBeUndefined();
  });
});

describe("planning a trip with one enormous photograph", () => {
  const huge = photo({ file: "huge.jpg", width: 12000, height: 9000 });
  // Two photographs, not one. A day with a single picture spends it beside
  // the day's own words rather than on a hero page — see the note beside
  // `wantsHero` in plan.ts — so a one-photo fixture would no longer produce
  // the full-bleed page this block is about. The second is the day's, the
  // first is still the hero.
  const book = planBook(
    source([day(0, { photos: [huge, photo({ file: "second.jpg", width: 6000, height: 4000 })] })]),
    SPEC,
  );
  const [volume] = book.volumes;

  test("places it without warning about resolution", () => {
    expect(book.warnings.some((w) => w.code === "low-resolution")).toBe(false);
  });

  test("runs it full bleed, covering the page and the bleed", () => {
    const page = volume.pages.find((p) => p.kind === "photos");
    expect(page?.kind === "photos" && page.layout).toBe("full-bleed");
    const placement = page?.kind === "photos" ? page.placements[0] : undefined;
    expect(placement).toBeDefined();
    expect(placement!.clip.x).toBe(-SPEC.bleedMm);
    expect(placement!.clip.width).toBe(SPEC.size.trimWidthMm + SPEC.bleedMm * 2);
    // Cover-crop: the drawn image is at least as large as the box it fills.
    expect(placement!.draw.width).toBeGreaterThanOrEqual(placement!.clip.width - 1e-9);
    expect(placement!.draw.height).toBeGreaterThanOrEqual(placement!.clip.height - 1e-9);
  });

  test("reports the resolution it will actually print at", () => {
    const page = volume.pages.find((p) => p.kind === "photos");
    const placement = page?.kind === "photos" ? page.placements[0] : undefined;
    expect(placement!.dpi).toBeGreaterThan(SPEC.dpi);
  });
});

describe("a photograph that is too small", () => {
  test("is a warning naming the file, the size and the resulting DPI", () => {
    const small = photo({ file: "web-sized.jpg", width: 800, height: 600 });
    const book = planBook(source([day(0, { photos: [small] })]), SPEC);
    const warning = book.warnings.find((w) => w.code === "low-resolution");
    expect(warning).toBeDefined();
    expect(warning!.detail).toContain("web-sized.jpg");
    expect(warning!.detail).toContain("800px");
    expect(warning!.detail).toMatch(/about \d+ DPI/);
  });

  // B701: the order page shows the photographs rather than naming files, so
  // the warning has to carry something a browser can fetch. `detail` keeps
  // the path — that string is the developer's.
  test("carries the photograph's web copy, for the page to show it", () => {
    const small = photo({ file: "web-sized.jpg", width: 800, height: 600, webSrc: "/u/media/x/01.jpg" });
    const book = planBook(source([day(0, { photos: [small] })]), SPEC);
    const warning = book.warnings.find((w) => w.code === "low-resolution");
    expect(warning!.photos).toEqual(["/u/media/x/01.jpg"]);
  });

  test("names no photograph it cannot show", () => {
    const small = photo({ file: "web-sized.jpg", width: 800, height: 600 });
    const book = planBook(source([day(0, { photos: [small] })]), SPEC);
    const warning = book.warnings.find((w) => w.code === "low-resolution");
    expect(warning!.photos).toEqual([]);
  });
});

describe("B502: the automatic hero skips a photograph too small to fill the page", () => {
  const small1 = photo({ file: "small-1.jpg", width: 1200, height: 900 });
  const small2 = photo({ file: "small-2.jpg", width: 1200, height: 900 });
  const big = photo({ file: "big-3.jpg", width: 4000, height: 3000 });
  const book = planBook(source([day(0, { photos: [small1, small2, big] })]), SPEC);
  const heroPage = book.volumes[0].pages.find(
    (p) => p.kind === "photos" && p.layout === "full-bleed",
  );

  test("finds a later photograph that has the pixels, rather than defaulting to the first", () => {
    expect(heroPage?.kind === "photos" ? heroPage.placements[0]?.photo.file : undefined).toBe(
      "big-3.jpg",
    );
  });
});

describe("B502: a trip where nothing is big enough to run large", () => {
  const tiny1 = photo({ file: "tiny-1.jpg", width: 900, height: 675 });
  const tiny2 = photo({ file: "tiny-2.jpg", width: 900, height: 675 });
  const book = planBook(source([day(0, { photos: [tiny1, tiny2] })]), SPEC);

  test("still plans and binds", () => {
    expect(book.volumes.length).toBeGreaterThan(0);
    expect(fitsRule(book.volumes[0].interiorPages, SPEC.pageCount)).toBe(true);
  });

  test("says so in a warning", () => {
    const warning = book.warnings.find((w) => w.code === "no-large-photo");
    expect(warning).toBeDefined();
    expect(warning!.detail).toContain("grid slot instead");
  });

  test("never runs a full-bleed or feature page", () => {
    const big = book.volumes[0].pages.find(
      (p) => p.kind === "photos" && (p.layout === "full-bleed" || p.layout === "feature"),
    );
    expect(big).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The pieces the planner is built from
// ---------------------------------------------------------------------------

describe("grouping photographs by shape", () => {
  const wide = photo({ width: 4000, height: 3000 });
  const tall = photo({ width: 3000, height: 4000 });
  const pano = photo({ width: 8000, height: 3000 });

  test("a panorama gets a page to itself", () => {
    expect(groupPhotos([pano, wide], SPEC)[0]).toEqual({ layout: "panorama", photos: [pano] });
  });

  test("two portraits go side by side", () => {
    expect(groupPhotos([tall, tall], SPEC)[0].layout).toBe("pair-portrait");
  });

  test("four landscapes make a grid", () => {
    expect(groupPhotos([wide, wide, wide, wide], SPEC)[0].layout).toBe("quad");
  });

  test("every photograph ends up on exactly one page", () => {
    const all = [wide, tall, pano, wide, tall, tall, wide, wide, wide];
    const placed = groupPhotos(all, SPEC).flatMap((g) => g.photos);
    expect(placed).toHaveLength(all.length);
  });

  test("B502: a lone photograph without the pixels for a full page gets a grid slot instead", () => {
    // wide, wide pairs off first (pair-stacked), leaving `small` on its own —
    // the case that used to run "feature" (full-bleed to the outer edge)
    // regardless of whether it had the pixels for that width.
    const small = photo({ file: "small.jpg", width: 1500, height: 1125 });
    expect(groupPhotos([wide, wide, small], SPEC)).toEqual([
      { layout: "pair-stacked", photos: [wide, wide] },
      { layout: "single", photos: [small] },
    ]);
  });

  test("B502: a lone photograph big enough still runs feature", () => {
    expect(groupPhotos([wide, wide, wide], SPEC)).toEqual([
      { layout: "pair-stacked", photos: [wide, wide] },
      { layout: "feature", photos: [wide] },
    ]);
  });

  test("B641: three portraits in a row share a page rather than a pair plus a straggler", () => {
    expect(groupPhotos([tall, tall, tall], SPEC)[0]).toEqual({
      layout: "trio-portrait",
      photos: [tall, tall, tall],
    });
  });
});

// ---------------------------------------------------------------------------
// B641: a photograph must never be scaled anisotropically, and a
// low-resolution one must never be blown up past what its pixels support.
// ---------------------------------------------------------------------------

describe("B641: photographs are never stretched, never blown up", () => {
  test("every placement's drawn rectangle keeps the source's own aspect ratio", () => {
    // A spread of shapes and sizes wide enough to exercise every layout the
    // planner can reach for — panoramas, portraits, squares, tiny ones.
    const dims: [number, number][] = [
      [4000, 3000],
      [3000, 4000],
      [3200, 2400],
      [1200, 1600],
      [6000, 2000],
      [2000, 6000],
      [3000, 3000],
      [1500, 1125],
      [800, 1200],
      [5000, 3333],
      [2400, 1800],
      [1800, 2400],
    ];
    const photos = dims.map(([width, height], i) => photo({ file: `d${i}.jpg`, width, height }));
    const days: BookDay[] = [];
    for (let i = 0; i < photos.length; i += 3) {
      days.push(day(i, { photos: photos.slice(i, i + 3) }));
    }
    const book = planBook(source(days), SPEC);
    let checked = 0;
    for (const volume of book.volumes) {
      for (const placement of photosIn(volume)) {
        const sourceAspect = placement.photo.width / placement.photo.height;
        const drawAspect = placement.draw.width / placement.draw.height;
        expect(drawAspect).toBeCloseTo(sourceAspect, 6);
        checked += 1;
      }
    }
    expect(checked).toBe(photos.length);
  });

  test("a low-resolution photograph is placed smaller rather than blown up to fill its slot", () => {
    // Nowhere near enough pixels to cover a quarter-page grid slot at the
    // print's target DPI.
    const lowRes = photo({ file: "lowres.jpg", width: 500, height: 375 });
    const wide = photo({ width: 4000, height: 3000 });
    const book = planBook(
      source([day(0, { photos: [lowRes, wide, wide, wide] })]),
      SPEC,
    );
    const placed = photosIn(book.volumes[0]).find((p) => p.photo.file === "lowres.jpg");
    expect(placed).toBeDefined();
    // Capped rather than cover-cropped: nothing left to crop, so the clip and
    // the drawn rectangle are the same (smaller) box, with a margin in the
    // slot around it — never the crop-to-fill shape a `cover` placement has.
    expect(placed!.clip.width).toBeCloseTo(placed!.draw.width, 6);
    expect(placed!.clip.height).toBeCloseTo(placed!.draw.height, 6);
    // And it prints no softer than the floor the rest of the book holds to.
    expect(placed!.dpi).toBeGreaterThanOrEqual(HERO_FLOOR_DPI - 1);
  });
});

describe("chapters", () => {
  test("are runs of consecutive days in one country", () => {
    const days = [
      day(0, { country: "Switzerland" }),
      day(1, { country: "Thailand" }),
      day(2, { country: "Thailand" }),
      day(3, { country: "Switzerland" }),
    ];
    const chapters = chaptersOf(days);
    expect(chapters.map((c) => c.country)).toEqual([
      "Switzerland",
      "Thailand",
      "Switzerland",
    ]);
    // A country revisited is a second chapter, because that is what happened.
    expect(chapters[2].days).toHaveLength(1);
  });

  test("a day with no country still lands somewhere", () => {
    expect(chaptersOf([day(0, { country: "" })])[0].country).toBe("Elsewhere");
  });
});

describe("the route view", () => {
  test("is twice as wide as it is tall, to fit a spread", () => {
    const view = routeView([
      { location: "A", country: "CH", lat: 47, lng: 8 },
      { location: "B", country: "VN", lat: 21, lng: 105 },
    ]);
    expect(view.width / view.height).toBeCloseTo(2, 6);
  });

  test("contains every point with room to spare", () => {
    const points = [
      { location: "A", country: "CH", lat: 47, lng: 8 },
      { location: "B", country: "VN", lat: 21, lng: 105 },
    ];
    const view = routeView(points);
    for (const p of points) {
      const x = ((p.lng + 180) / 360) * 1000;
      const y = ((90 - p.lat) / 180) * 500;
      expect(x).toBeGreaterThan(view.x);
      expect(x).toBeLessThan(view.x + view.width);
      expect(y).toBeGreaterThan(view.y);
      expect(y).toBeLessThan(view.y + view.height);
    }
  });

  /**
   * B269. A stop without coordinates — `lat`/`lng` are optional on an entry,
   * and `routeFor` (`lib/photobook/source.ts`) copies them through unchecked —
   * took `Math.min`/`Math.max` here to `NaN`, same shape as B265's hole in
   * `frameRoute`.
   */
  describe("a stop with no coordinates", () => {
    const located = [
      { location: "A", country: "CH", lat: 47, lng: 8 },
      { location: "B", country: "VN", lat: 21, lng: 105 },
    ];
    const unlocated = { location: "Unrecorded", country: "", lat: undefined as unknown as number, lng: undefined as unknown as number };

    test("is dropped rather than poisoning the view", () => {
      const view = routeView([...located, unlocated]);
      expect(Number.isFinite(view.x)).toBe(true);
      expect(Number.isFinite(view.y)).toBe(true);
      expect(Number.isFinite(view.width)).toBe(true);
      expect(Number.isFinite(view.height)).toBe(true);
      expect(view).toEqual(routeView(located));
    });

    test("a route with nothing plottable frames the whole world, not NaN", () => {
      const view = routeView([unlocated]);
      expect(view).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    });

    /**
     * The bounding box is only half the hole: `materialise`'s "route" case
     * also projects every route point straight into `MappedPoint[]` for
     * `drawRoutePage` (`lib/photobook/render.ts`) to draw as dots and a
     * connecting line, bypassing `routeView` entirely.
     */
    test("a planned book draws no NaN point for a day with no coordinates", () => {
      const days = [day(0), day(1)];
      const route = [
        ...days.map((d) => ({ location: d.location, country: d.country, lat: d.lat, lng: d.lng })),
        unlocated,
      ];
      const book = planBook(source(days, { route }), SPEC);
      const routePages = book.volumes[0].pages.filter((p) => p.kind === "route");
      expect(routePages.length).toBeGreaterThan(0);
      for (const p of routePages) {
        if (p.kind !== "route") continue;
        expect(Number.isFinite(p.view.x)).toBe(true);
        expect(Number.isFinite(p.view.width)).toBe(true);
        expect(p.points).toHaveLength(days.length);
        for (const pt of p.points) {
          expect(Number.isFinite(pt.x)).toBe(true);
          expect(Number.isFinite(pt.y)).toBe(true);
        }
      }
    });
  });

  /**
   * B518. `mapProjector` (lib/photobook/plan.ts) always puts `view`'s
   * horizontal midpoint at the spine, so a frame with no opinion about that
   * put a route's middle in the one part of the paper a reader cannot
   * flatten. These frame the fold itself, in map-space x — `view.x +
   * view.width / 2` — against the 8% band `FOLD_BAND_FRACTION` reserves
   * around it, rather than rendering anything.
   */
  describe("keeping stops off the fold", () => {
    const lngToX = (lng: number) => ((lng + 180) / 360) * 1000;

    function stopsAtLngs(...lngs: number[]) {
      return lngs.map((lng, i) => ({ location: `stop-${i}`, country: "CH", lat: 47, lng }));
    }

    test("a clustered route is shifted clear of the gutter", () => {
      // Stops with the largest gap between two of them right where the
      // frame's untouched midpoint would otherwise fall.
      const lngs = [9, 9.5, 10, 10.2, 10.5];
      const view = routeView(stopsAtLngs(...lngs));
      const fold = view.x + view.width / 2;
      const half = (view.width * 0.08) / 2;
      for (const lng of lngs) {
        expect(Math.abs(lngToX(lng) - fold)).toBeGreaterThan(half);
      }
    });

    test("a tight cluster with one distant stop is not split by the fold", () => {
      // Five stops bunched together, and a sixth far enough away that the
      // gap between the cluster and it is the obvious place for the fold —
      // it should land there, leaving the cluster whole on one side.
      const cluster = [9, 9.2, 9.3, 9.5, 9.6];
      const view = routeView(stopsAtLngs(...cluster, 60));
      const fold = view.x + view.width / 2;
      const side = (x: number) => x < fold;
      expect(new Set(cluster.map(lngToX).map(side)).size).toBe(1);
    });

    test("a single stop is not left sitting on the fold", () => {
      const view = routeView(stopsAtLngs(10));
      const fold = view.x + view.width / 2;
      const half = (view.width * 0.08) / 2;
      expect(Math.abs(lngToX(10) - fold)).toBeGreaterThan(half);
    });

    test("a straight-line route still gets a frame containing every stop", () => {
      const lngs = [-120, -110, -100, -90, -80, -70];
      const view = routeView(stopsAtLngs(...lngs));
      expect(view.width / view.height).toBeCloseTo(2, 6);
      for (const lng of lngs) {
        const x = lngToX(lng);
        expect(x).toBeGreaterThan(view.x);
        expect(x).toBeLessThan(view.x + view.width);
      }
    });

    test("an empty route still frames the whole world", () => {
      expect(routeView([])).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    });

    /**
     * The first version of `centreAwayFromFold` shifted whenever a clearing
     * gap existed, without checking the shift actually helped — on
     * `parks-2025` that moved the frame a fifth of its width and still left
     * a stop in the band, while doubling how many times the route crossed
     * it. Eight stops spread evenly enough that no gap clears the band
     * without moving a stop into a worse crossing count is the same shape:
     * every candidate here ties or loses, so the frame's own untouched
     * midpoint — `(minX + maxX) / 2`, same as before this ticket — must
     * come back unchanged.
     */
    test("a route no shift can improve keeps its own midpoint", () => {
      const lngs = Array.from({ length: 8 }, (_, i) => -15 + i * (30 / 7));
      const view = routeView(stopsAtLngs(...lngs));
      const xs = lngs.map(lngToX);
      const untouchedCx = (Math.min(...xs) + Math.max(...xs)) / 2;
      expect(view.x + view.width / 2).toBeCloseTo(untouchedCx, 6);
    });
  });
});

describe("text", () => {
  test("wraps inside the column it was given", () => {
    const lines = wrap("The quick brown fox jumps over the lazy dog. ".repeat(6), 10, 200);
    for (const line of lines) expect(measure(line, 10)).toBeLessThanOrEqual(200);
    expect(lines.length).toBeGreaterThan(1);
  });

  test("breaks a word too long for the column rather than letting it overhang", () => {
    const lines = wrap("supercalifragilisticexpialidocious", 12, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 12)).toBeLessThanOrEqual(40);
  });

  test("measures what will actually be drawn", () => {
    // An em dash is one glyph in WinAnsi, not two hyphens. If measuring and
    // encoding disagree here, every line holding one overhangs its column.
    expect(toWinAnsi("a—b")).toHaveLength(3);
    expect(measure("—", 10)).toBeCloseTo(10, 6);
    expect(measure("’", 10)).toBeCloseTo(2.22, 6);
  });

  test("keeps accented letters instead of stripping them", () => {
    expect(toWinAnsi("Zürich, Málaga, Đà Lạt")).toContain("Zürich");
  });

  test("replaces what WinAnsi cannot hold with a gap, not a question mark", () => {
    expect(toWinAnsi("north 北 south")).toBe("north   south");
  });

  test("collapses a date range to what the two ends do not share", () => {
    const en = bookStrings("en");
    expect(formatDateRange("2026-08-14", "2026-08-28", en)).toBe("14–28 August 2026");
    expect(formatDateRange("2026-08-14", "2026-09-02", en)).toBe(
      "14 August – 2 September 2026",
    );
    expect(formatDateRange("2026-08-14", "2026-08-14", en)).toBe("14 August 2026");
    expect(formatDateRange("2025-12-31", "2026-01-02", en)).toBe(
      "31 December 2025 – 2 January 2026",
    );
  });

  test("formats a German date with the ordinal point after the day", () => {
    const de = bookStrings("de");
    expect(formatDate("2025-09-05", de)).toBe("5. September 2025");
    expect(formatDateRange("2026-08-14", "2026-08-28", de)).toBe("14.–28. August 2026");
    expect(formatDateRange("2026-08-14", "2026-09-02", de)).toBe(
      "14. August – 2. September 2026",
    );
    expect(formatDateRange("2025-12-31", "2026-01-02", de)).toBe(
      "31. Dezember 2025 – 2. Januar 2026",
    );
  });

  test("formats a Hungarian date year-first, month lower case, day pointed", () => {
    const hu = bookStrings("hu");
    expect(formatDate("2025-09-05", hu)).toBe("2025. szeptember 5.");
    expect(formatDateRange("2026-08-14", "2026-08-28", hu)).toBe("2026. augusztus 14–28.");
    expect(formatDateRange("2026-08-14", "2026-09-02", hu)).toBe(
      "2026. augusztus 14. – szeptember 2.",
    );
    expect(formatDateRange("2025-12-31", "2026-01-02", hu)).toBe(
      "2025. december 31. – 2026. január 2.",
    );
  });
});

describe("the world outline", () => {
  test("becomes PDF path operators, through the caller's projection", () => {
    const pdf = toPdfPath("M10,20 L30,40 L50,60 Z", (x, y) => [x * 2, y * 3]);
    expect(pdf).toBe("20.00 60.00 m 60.00 120.00 l 100.00 180.00 l h");
  });
});

// ---------------------------------------------------------------------------
// The PDF itself
// ---------------------------------------------------------------------------

describe("rendering", () => {
  const jpeg = new Uint8Array(fs.readFileSync(PHOTO_FILE));
  const loadImage = () => jpeg;
  const book = planBook(source([day(0), day(1), day(2)]), SPEC);
  const [volume] = book.volumes;
  const rendered = renderVolume(volume, SPEC, { loadImage });
  const text = Buffer.from(rendered.pdf).toString("latin1");

  test("is a PDF with one object per page, and two blank leaves after them", () => {
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // B1173. Gelato's prepress refuses a book whose files do not total
    // `pageCount + 3`, and its own template is 31 pages for the 28-page
    // product — one cover page and thirty interior. So the interior file
    // carries two more pages than the book has.
    expect(text).toContain(`/Count ${volume.interiorPages + 2}`);
    // And `pages` is still the book's own count: it is what gets quoted,
    // charged and declared to the printer, and the leaves are not pages of the
    // book. If these two ever say the same number again, one of them is wrong.
    expect(rendered.pages).toBe(volume.interiorPages);
  });

  test("declares a trim and a bleed box on every page", () => {
    const pages = text.split("/Type /Page ").length - 1;
    const trims = text.split("/TrimBox").length - 1;
    const bleeds = text.split("/BleedBox").length - 1;
    expect(trims).toBe(pages);
    expect(bleeds).toBe(pages);
  });

  test("the media box is the trim plus bleed on all four edges", () => {
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    expect(media).not.toBeNull();
    const expected = ((SPEC.size.trimWidthMm + SPEC.bleedMm * 2) / 25.4) * 72;
    expect(Number(media![1])).toBeCloseTo(expected, 2);
  });

  test("embeds the photograph unchanged", () => {
    expect(Buffer.from(rendered.pdf).includes(Buffer.from(jpeg))).toBe(true);
    expect(text).toContain("/DCTDecode");
  });

  test("clips cover-cropped photographs so they cannot spill into a neighbour", () => {
    expect(text).toContain(" re W n ");
  });

  test("reports a missing photograph instead of leaving a blank page", () => {
    const broken = renderVolume(volume, SPEC, {
      loadImage: () => {
        throw new Error("ENOENT");
      },
    });
    expect(broken.missing.length).toBeGreaterThan(0);
    expect(Buffer.from(broken.pdf).toString("latin1")).toContain("missing:");
  });

  test("guides are additive and off by default", () => {
    const guided = renderVolume(volume, SPEC, { loadImage, guides: true });
    expect(guided.pdf.length).toBeGreaterThan(rendered.pdf.length);
  });

  test("the cover is one wide page: back, spine, front", () => {
    const cover = renderCover(volume, SPEC, { loadImage });
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(
      Buffer.from(cover.pdf).toString("latin1"),
    );
    const expected = ((volume.cover.widthMm) / 25.4) * 72;
    expect(Number(media![1])).toBeCloseTo(expected, 2);
    expect(volume.cover.widthMm).toBeCloseTo(
      SPEC.size.trimWidthMm * 2 + volume.spineWidthMm + SPEC.bleedMm * 2,
      6,
    );
  });

  test("document metadata is written when it is supplied", () => {
    const withMeta = renderVolume(volume, SPEC, {
      loadImage,
      document: { title: "A test trip", author: "A & B", created: new Date(0) },
    });
    const meta = Buffer.from(withMeta.pdf).toString("latin1");
    expect(meta).toContain("/Type /Metadata");
    expect(meta).toContain("/Trapped /False");
    expect(meta).toContain("(A test trip)");
    // And no PDF/X claim, because none was made.
    expect(meta).not.toContain("GTS_PDFXVersion");
  });

  test("a book at a different trim size still lays out", () => {
    const wide = defaultSpec(BOOK_SIZES["portrait"]);
    const other = planBook(source([day(0), day(1), day(2)]), wide);
    expect(fitsRule(other.volumes[0].interiorPages, wide.pageCount)).toBe(true);
    expect(() => renderVolume(other.volumes[0], wide, { loadImage })).not.toThrow();
  });
});

describe("the outline", () => {
  test("is one line per page, in order", () => {
    const book = planBook(source([day(0), day(1)]), SPEC);
    const lines = outline(book.volumes[0]);
    expect(lines).toHaveLength(book.volumes[0].interiorPages);
    expect(lines[0]).toContain("title");
  });
});

// ---------------------------------------------------------------------------
// PDF/X, honestly
// ---------------------------------------------------------------------------

describe("PDF/X readiness", () => {
  const base = {
    outputIntent: false,
    fontsEmbedded: false,
    cmykContent: false,
    transparency: false,
  };

  test("is not claimable with the writer as it stands", () => {
    const readiness = pdfxReadiness(base);
    expect(readiness.claimable).toBe(false);
    expect(readiness.version).toBeUndefined();
  });

  test("names what is missing and why", () => {
    const unmet = pdfxReadiness(base)
      .requirements.filter((r) => !r.met)
      .map((r) => r.requirement);
    // Under PDF/X-4 the colour space is no longer a failure: RGB is permitted
    // when an output intent describes the printing condition. Against X-1a it
    // was, which is what made font embedding look pointless for so long.
    expect(unmet).toContain("All fonts embedded");
    expect(unmet.some((r) => r.startsWith("Colour is"))).toBe(false);
  });

  test("a book with fonts embedded needs only the output intent", () => {
    const unmet = pdfxReadiness({ ...base, fontsEmbedded: true })
      .requirements.filter((r) => !r.met)
      .map((r) => r.requirement);
    expect(unmet).toEqual(["OutputIntent with an embedded ICC profile"]);
  });

  test("an output intent alone is not enough to claim a version", () => {
    expect(pdfxReadiness({ ...base, outputIntent: true }).claimable).toBe(false);
  });

  test("becomes claimable only when every requirement is met", () => {
    const readiness = pdfxReadiness({
      outputIntent: true,
      fontsEmbedded: true,
      cmykContent: true,
      transparency: false,
    });
    expect(readiness.claimable).toBe(true);
    expect(readiness.version).toBe("PDF/X-4");
  });

  test("the report says plainly that the file makes no claim", () => {
    expect(readinessReport(pdfxReadiness(base), { scriptWritten: false }).join("\n")).toContain(
      "declares no PDF/X version",
    );
  });

  // B1149: gs-pdfx.sh only exists when the run had an --icc profile, so the
  // remedy must not name it when it does not.
  test("points at --icc, not at gs-pdfx.sh, when the script was not written", () => {
    const report = readinessReport(pdfxReadiness(base), { scriptWritten: false }).join("\n");
    expect(report).not.toContain("gs-pdfx.sh");
    expect(report).toContain("--icc");
  });

  test("points at gs-pdfx.sh when the script was written", () => {
    const report = readinessReport(pdfxReadiness(base), { scriptWritten: true }).join("\n");
    expect(report).toContain("gs-pdfx.sh");
  });
});

describe("ICC profiles", () => {
  test("are rejected when they are not ICC profiles", () => {
    expect(() => readIcc(new Uint8Array(200))).toThrow(/ICC/);
  });

  const SYSTEM_CMYK = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";

  test.skipIf(!fs.existsSync(SYSTEM_CMYK))(
    "report their colour space, so the wrong one cannot be embedded silently",
    () => {
      const icc = readIcc(new Uint8Array(fs.readFileSync(SYSTEM_CMYK)));
      expect(icc.colourSpace).toBe("CMYK");
      expect(icc.components).toBe(4);
      expect(icc.description.length).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// Providers — built, never called
// ---------------------------------------------------------------------------

const ORDER: BookOrder = {
  reference: "test-trip-2026-12-24",
  title: "A test trip",
  interiorUrl: "https://example.test/books/test-interior.pdf",
  coverUrl: "https://example.test/books/test-cover.pdf",
  interiorMd5: "0".repeat(32),
  coverMd5: "1".repeat(32),
  pageCount: 36,
  trimWidthMm: 210,
  trimHeightMm: 210,
  copies: 5,
  to: {
    name: "Maria Muster",
    line1: "Bahnhofstrasse 12",
    postcode: "8001",
    city: "Zurich",
    country: "CH",
    email: "maria@example.test",
  },
  test: true,
  paymentRef: "test-payment-ref",
  productUid: productUidFor("square", "soft")!,
  shipmentMethodUid: "swiss_post_economy",
};

describe("provider requests", () => {
  test("match the checked-in fixtures", () => {
    const dir = path.join(process.cwd(), "test", "fixtures", "photobook");
    for (const provider of ["peecho", "gelato", "cloudprinter", "lulu"] as const) {
      const expected = JSON.parse(
        fs.readFileSync(path.join(dir, `${provider}-request.json`), "utf8"),
      );
      expect(buildRequest(provider, ORDER), provider).toEqual(expected);
    }
  });

  test("never carry a credential in a fixture", () => {
    const serialised = ["peecho", "gelato", "cloudprinter", "lulu"]
      .map((p) => JSON.stringify(buildRequest(p as "peecho", ORDER)))
      .join("\n");
    // The only secret that appears anywhere is the *name* of the variable.
    expect(serialised).not.toMatch(/sk_|Bearer [A-Za-z0-9]/);
    expect(serialised).toContain("$CLOUDPRINTER_API_KEY");
  });

  test("Peecho and Gelato and Lulu take their key in a header; Cloudprinter does not", () => {
    expect(buildPeechoRequest(ORDER).authHeaders).toEqual(["X-API-Key"]);
    expect(buildGelatoRequest(ORDER).authHeaders).toEqual(["X-API-KEY"]);
    expect(buildLuluRequest(ORDER).authHeaders).toEqual(["Authorization"]);
    expect(buildCloudprinterRequest(ORDER).authHeaders).toEqual([]);
  });

  test("all four fetch the file from a URL rather than accepting an upload", () => {
    // The single most consequential fact for a self-hoster: the book has to be
    // reachable on the internet before any of these can print it.
    for (const p of ["peecho", "gelato", "cloudprinter", "lulu"] as const) {
      expect(buildRequest(p, ORDER).transfer).toBe("fetches-from-url");
    }
  });

  it("sends the catalogue's own product uid, never one it built", () => {
    const req = buildGelatoRequest({ ...ORDER, productUid: productUidFor("square", "soft")! });
    const body = req.body as { items: { productUid: string; pageCount: number }[] };
    expect(body.items[0].productUid).toBe(productUidFor("square", "soft"));
    expect(body.items[0].productUid).not.toContain("-pages_");
    expect(body.items[0].pageCount).toBe(ORDER.pageCount);
  });

  it("names a real Swiss shipment method", () => {
    const req = buildGelatoRequest({ ...ORDER, shipmentMethodUid: "swiss_post_economy" });
    expect((req.body as { shipmentMethodUid: string }).shipmentMethodUid).toBe(
      "swiss_post_economy",
    );
  });

  test("Lulu's test mode points at the sandbox, which is the only free one", () => {
    expect(buildLuluRequest({ ...ORDER, test: true }).url).toContain("sandbox");
    expect(buildLuluRequest({ ...ORDER, test: false }).url).not.toContain("sandbox");
  });

  test("only the dry run is ready, and it needs no account", () => {
    const providers = availableProviders();
    expect(providers["dry-run"].ready).toBe(true);
    for (const name of ["peecho", "gelato", "cloudprinter", "lulu"] as const) {
      expect(providers[name].ready, name).toBe(false);
      expect(providers[name].note).toMatch(/Needs|needs/);
    }
  });

  test("the dry run has no request to build", () => {
    expect(() => buildRequest("dry-run", ORDER)).toThrow(/dry-run/);
  });

  test("refuses to build a request without a recorded payment — B07", () => {
    const unpaid: BookOrder = { ...ORDER, paymentRef: "" };
    for (const build of [
      buildPeechoRequest,
      buildGelatoRequest,
      buildCloudprinterRequest,
      buildLuluRequest,
    ]) {
      expect(() => build(unpaid)).toThrow(/no recorded payment/);
    }
    for (const provider of ["peecho", "gelato", "cloudprinter", "lulu"] as const) {
      expect(() => buildRequest(provider, unpaid)).toThrow(/no recorded payment/);
    }
  });
});

describe("a route spread uses both pages — B914", () => {
  /** Four days round the Alps: a compact route, about 0.6° of longitude. */
  const ALPS = [
    { location: "Susten Pass", country: "Switzerland", lat: 46.73, lng: 8.44 },
    { location: "Grimsel Pass", country: "Switzerland", lat: 46.56, lng: 8.34 },
    { location: "Domodossola", country: "Italy", lat: 46.12, lng: 8.29 },
    { location: "Andermatt", country: "Switzerland", lat: 46.63, lng: 8.59 },
  ];

  it("draws the journey large enough to be a map rather than a squiggle", () => {
    const view = routeView(ALPS);
    // Map-space y: MAP_SPACE is 500 tall for 180 degrees.
    const ys = ALPS.map((p) => ((90 - p.lat) / 180) * 500);
    const routeHeight = Math.max(...ys) - Math.min(...ys);
    // The route used to fill about a sixth of the spread's height, because a
    // 6-unit padding floor swamped a trip spanning under a degree. Half is
    // roughly what a 2:1 frame can give a route this shape.
    expect(routeHeight / view.height).toBeGreaterThan(0.4);
  });

  it("keeps the route across the fold rather than dumping it on one page", () => {
    const view = routeView(ALPS);
    const fold = view.x + view.width / 2;
    // The same equirectangular x the planner uses: MAP_SPACE is 1000 wide
    // for 360 degrees. Recomputed here rather than exporting a private helper.
    const xs = ALPS.map((p) => ((p.lng + 180) / 360) * 1000);
    const routeCentre = (Math.min(...xs) + Math.max(...xs)) / 2;
    // The whole point: a blank facing page is worse than a stop near the
    // gutter, so the frame may not wander far from the route's own centre.
    expect(Math.abs(fold - routeCentre)).toBeLessThanOrEqual(view.width / 6 + 1e-6);
  });

  it("still forces the spread's own 2:1 shape", () => {
    const view = routeView(ALPS);
    expect(view.width / view.height).toBeCloseTo(2, 5);
  });
});

describe("a compact route prints on one page instead of a mostly-empty spread — B1000", () => {
  /** Four days round the Alps: the same compact route as B914, above. */
  const ALPS = [
    day(0, { location: "Susten Pass", country: "Switzerland", lat: 46.73, lng: 8.44 }),
    day(1, { location: "Grimsel Pass", country: "Switzerland", lat: 46.56, lng: 8.34 }),
    day(2, { location: "Domodossola", country: "Italy", lat: 46.12, lng: 8.29 }),
    day(3, { location: "Andermatt", country: "Switzerland", lat: 46.63, lng: 8.59 }),
  ];

  /** Coast to coast: wide east-west, narrow north-south — a shape a 2:1
   * spread suits far better than one square page. */
  const SPRAWLING = [
    day(0, { location: "New York", country: "United States", lat: 40.71, lng: -74.0 }),
    day(1, { location: "Chicago", country: "United States", lat: 41.88, lng: -87.63 }),
    day(2, { location: "Denver", country: "United States", lat: 39.74, lng: -104.99 }),
    day(3, { location: "Los Angeles", country: "United States", lat: 34.05, lng: -118.24 }),
  ];

  it("is what routeFitsOnePage sees for a square book on the Alps trip", () => {
    expect(routeFitsOnePage(source(ALPS).route, 1)).toBe(true);
  });

  it("still spreads a sprawling trip across two pages", () => {
    expect(routeFitsOnePage(source(SPRAWLING).route, 1)).toBe(false);
  });

  it("plans one route page, not a spread, for a compact trip on a square book", () => {
    const book = planBook(source(ALPS), SPEC);
    const routePages = book.volumes[0].pages.filter((p) => p.kind === "route");
    expect(routePages).toHaveLength(1);
    expect(routePages[0].kind === "route" && routePages[0].half).toBe("full");
    // Every stop the trip had, still there to be labelled.
    expect(routePages[0].kind === "route" && routePages[0].points).toHaveLength(ALPS.length);
  });

  it("still plans a two-page spread for a sprawling trip", () => {
    const book = planBook(source(SPRAWLING), SPEC);
    const routePages = book.volumes[0].pages.filter((p) => p.kind === "route");
    expect(routePages).toHaveLength(2);
    const halves = routePages.map((p) => p.kind === "route" && p.half);
    expect(halves.sort()).toEqual(["left", "right"]);
  });

  it("frames the single page to its own trim aspect, not the spread's 2:1", () => {
    const view = routeView(source(ALPS).route, 1, false);
    expect(view.width / view.height).toBeCloseTo(1, 5);
  });
});

describe("a stop in the gutter band still gets a label — B1000", () => {
  const gutterStop: ProjectedStop = { location: "Andermatt", x: 90, y: 0 };
  const widthOf = () => 20;

  it("was lost entirely before a page could claim it by its own trim", () => {
    // The old rule: a stop outside the safe content box (here, past 84)
    // belongs to nobody, even though it is still on this page's own paper.
    const left = routeLabelPlacements([gutterStop], 10, 84, 2, 5, widthOf);
    expect(left).toHaveLength(0);
  });

  it("is claimed by the page whose own trim it falls inside", () => {
    const left = routeLabelPlacements([gutterStop], 10, 84, 2, 5, widthOf, { left: 0, right: 100 });
    expect(left).toHaveLength(1);
    expect(left[0].location).toBe("Andermatt");
    // Still anchored inside the safe content box, never past it.
    expect(left[0].anchorX).toBeGreaterThanOrEqual(10);
    expect(left[0].anchorX + 20).toBeLessThanOrEqual(84);
  });

  it("is not claimed a second time by the facing page", () => {
    // The same stop, as the right page's own frame sees it — negative, since
    // it falls outside this page's trim entirely.
    const right = routeLabelPlacements([{ ...gutterStop, x: -10 }], 16, 90, 2, 5, widthOf, { left: 0, right: 100 });
    expect(right).toHaveLength(0);
  });
});

describe("the basemap under a route — B1000", () => {
  /**
   * The renderer recovers lat/lng from the projected points rather than making
   * the plan carry both. That inversion is the one piece of arithmetic in the
   * change that could be silently wrong — everything else is visible on the
   * page. `MAP_SPACE` is 1000 x 500 for the whole world.
   */
  const toMapSpace = (lat: number, lng: number) => ({
    x: ((lng + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  });
  const fromMapSpace = (p: { x: number; y: number }) => ({
    lat: 90 - (p.y / 500) * 180,
    lng: (p.x / 1000) * 360 - 180,
  });

  it("round-trips the places a book actually plots", () => {
    for (const [lat, lng] of [
      [46.73, 8.44], // Susten Pass
      [46.12, 8.29], // Domodossola
      [38.57, -109.55], // Moab — a negative longitude
      [-33.87, 151.21], // Sydney — the other hemisphere in both axes
      [0, 0],
    ] as [number, number][]) {
      const back = fromMapSpace(toMapSpace(lat, lng));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });
});
