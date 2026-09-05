import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  BINDING_PROFILES,
  BOOK_SIZES,
  contentBoxMm,
  defaultSpec,
  fitsRule,
  normalisePageCount,
  portableRule,
  SADDLE_STITCH,
  sideOf,
  spineWidthMm,
} from "@/lib/photobook/spec";
import {
  chaptersOf,
  groupPhotos,
  outline,
  planBook,
  routeView,
  type BookDay,
  type BookPhoto,
  type BookSource,
  type BookVolume,
} from "@/lib/photobook/plan";
import { formatDateRange, measure, toWinAnsi, wrap } from "@/lib/photobook/text";
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

  test("the spine is derived from leaves, not pages", () => {
    expect(spineWidthMm(100, SPEC)).toBeCloseTo(50 * SPEC.paperCaliperMm, 6);
    expect(spineWidthMm(0, SPEC)).toBe(0);
  });
});

describe("page-count rules", () => {
  test("the portable rule satisfies every provider's minimum", () => {
    const rule = portableRule();
    for (const profile of Object.values(BINDING_PROFILES)) {
      expect(rule.min).toBeGreaterThanOrEqual(profile.min);
      expect(rule.max).toBeLessThanOrEqual(profile.max);
      expect(rule.multipleOf % profile.multipleOf).toBe(0);
    }
  });

  test("no binding profile claims to be verified", () => {
    // These numbers came from documentation, not from an account. If one is
    // ever confirmed against a live API, this test is the reminder to say so.
    for (const profile of Object.values(BINDING_PROFILES)) {
      expect(profile.verified).toBe(false);
    }
  });

  test("rounds up to the minimum and to a whole signature", () => {
    const rule = { min: 32, max: 160, multipleOf: 4 };
    expect(normalisePageCount(5, rule)).toBe(32);
    expect(normalisePageCount(33, rule)).toBe(36);
    expect(normalisePageCount(36, rule)).toBe(36);
    expect(fitsRule(36, rule)).toBe(true);
    expect(fitsRule(34, rule)).toBe(false);
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

  test("stapled instead, the same trip needs no padding at all", () => {
    const stapled = defaultSpec();
    stapled.pageCount = SADDLE_STITCH;
    const stitched = planBook(source([day(0), day(1), day(2)]), stapled);
    const pages = stitched.volumes[0].pages;
    expect(fitsRule(pages.length, SADDLE_STITCH)).toBe(true);
    expect(pages.length).toBeLessThan(volume.interiorPages);
    // Trailing blanks are the padding; the ones in the middle are alignment,
    // which every book has and which nothing is wrong with.
    const trailing = pages.length - (pages.findLastIndex((p) => p.kind !== "blank") + 1);
    expect(trailing).toBeLessThan(4);
    expect(stitched.warnings.some((w) => w.code === "blank-padding")).toBe(false);
  });

  test("opens with the title on a recto and ends with the colophon", () => {
    expect(volume.pages[0].kind).toBe("title");
    expect(volume.pages[0].side).toBe("right");
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
});

// ---------------------------------------------------------------------------
// The pieces the planner is built from
// ---------------------------------------------------------------------------

describe("grouping photographs by shape", () => {
  const wide = photo({ width: 4000, height: 3000 });
  const tall = photo({ width: 3000, height: 4000 });
  const pano = photo({ width: 8000, height: 3000 });

  test("a panorama gets a page to itself", () => {
    expect(groupPhotos([pano, wide])[0]).toEqual({ layout: "panorama", photos: [pano] });
  });

  test("two portraits go side by side", () => {
    expect(groupPhotos([tall, tall])[0].layout).toBe("pair-portrait");
  });

  test("four landscapes make a grid", () => {
    expect(groupPhotos([wide, wide, wide, wide])[0].layout).toBe("quad");
  });

  test("every photograph ends up on exactly one page", () => {
    const all = [wide, tall, pano, wide, tall, tall, wide, wide, wide];
    const placed = groupPhotos(all).flatMap((g) => g.photos);
    expect(placed).toHaveLength(all.length);
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
    expect(formatDateRange("2026-08-14", "2026-08-28")).toBe("14–28 August 2026");
    expect(formatDateRange("2026-08-14", "2026-09-02")).toBe(
      "14 August – 2 September 2026",
    );
    expect(formatDateRange("2026-08-14", "2026-08-14")).toBe("14 August 2026");
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

  test("is a PDF with one object per page", () => {
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain(`/Count ${volume.interiorPages}`);
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
    const wide = defaultSpec(BOOK_SIZES["landscape-a4"]);
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

  test("names the two things that are missing and why", () => {
    const unmet = pdfxReadiness(base)
      .requirements.filter((r) => !r.met)
      .map((r) => r.requirement);
    expect(unmet).toContain("All fonts embedded and subset");
    expect(unmet).toContain("Colour is CMYK or spot only (PDF/X-1a)");
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
    expect(readiness.version).toBe("PDF/X-1a:2001");
  });

  test("the report says plainly that the file makes no claim", () => {
    expect(readinessReport(pdfxReadiness(base)).join("\n")).toContain(
      "declares no PDF/X version",
    );
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
});
