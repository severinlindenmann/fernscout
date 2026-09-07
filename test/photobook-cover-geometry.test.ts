import { describe, expect, it, afterEach, vi } from "vitest";

import { computeCoverGeometry, fetchCoverGeometry } from "@/lib/photobook/coverGeometry";
import { BOOK_SIZES, defaultSpec } from "@/lib/photobook/spec";
import { renderCover, renderVolume } from "@/lib/photobook/render";
import { planBook } from "@/lib/photobook/plan";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import type { BookDay, BookPhoto, BookSource } from "@/lib/photobook/plan";

// ---------------------------------------------------------------------------
// Fixtures shared with photobook.test.ts's own shapes, kept local and small.
// ---------------------------------------------------------------------------

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
    route: days.map((d) => ({ location: d.location, country: d.country, lat: d.lat, lng: d.lng })),
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
    ...over,
  };
}

const loadImage = () => {
  // A minimal valid-enough JPEG is not needed here: these tests only look at
  // the cover's geometry, not its pixels.
  throw new Error("no photo needed for geometry tests");
};

describe("computeCoverGeometry — the offline fallback", () => {
  const squareSpec = defaultSpec(BOOK_SIZES.square);

  it.each([
    [28, 2.72],
    [32, 3.03],
    [52, 4.58],
    [100, 8.3],
    [160, 12.95],
    [200, 16.05],
  ])("softcover spine at %i pages is %s mm", (pages, expected) => {
    const geometry = computeCoverGeometry(squareSpec, pages);
    expect(geometry.spineWidthMm).toBeCloseTo(expected, 2);
    expect(geometry.source).toBe("computed");
    expect(geometry.wrapMm).toBe(0);
    expect(geometry.joint).toBeUndefined();
  });

  it("softcover sheet is trim, trim and spine, plus bleed on all four edges", () => {
    const geometry = computeCoverGeometry(squareSpec, 52);
    expect(geometry.back).toEqual({ widthMm: 200, heightMm: 200 });
    expect(geometry.front).toEqual({ widthMm: 200, heightMm: 200 });
    expect(geometry.sheetWidthMm).toBeCloseTo(410.58, 2);
    expect(geometry.sheetHeightMm).toBeCloseTo(206, 6);
  });

  it("the 280x280 hardcover sheet is 618 x 326 at 56 pages, with wrap and joints", () => {
    const hardSpec = defaultSpec(BOOK_SIZES["large-square"]);
    const geometry = computeCoverGeometry(hardSpec, 52); // Gelato rounds 52 up to 56.
    expect(geometry.sheetWidthMm).toBeCloseTo(618, 1);
    expect(geometry.sheetHeightMm).toBeCloseTo(326, 1);
    expect(geometry.wrapMm).toBe(17);
    expect(geometry.bleedMm).toBe(3);
    expect(geometry.spineWidthMm).toBeCloseTo(6, 1);
    expect(geometry.back).toEqual({ widthMm: 278, heightMm: 286 });
    expect(geometry.front).toEqual({ widthMm: 278, heightMm: 286 });
    expect(geometry.joint).toEqual({ widthMm: 8, heightMm: 286 });
    expect(geometry.source).toBe("computed");
  });

  it("hardcover spine at 164 pages is the other measured point, 16 mm", () => {
    const hardSpec = defaultSpec(BOOK_SIZES["large-square"]);
    const geometry = computeCoverGeometry(hardSpec, 160); // rounds to 164.
    expect(geometry.spineWidthMm).toBeCloseTo(16, 1);
  });
});

describe("fetchCoverGeometry — never throws, null with no key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns null when GELATO_API_KEY is unset", async () => {
    vi.stubEnv("GELATO_API_KEY", "");
    const result = await fetchCoverGeometry("some-uid", 52);
    expect(result).toBeNull();
  });

  it("returns null rather than throwing when the network is unreachable", async () => {
    vi.stubEnv("GELATO_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const result = await fetchCoverGeometry("some-uid", 52);
    expect(result).toBeNull();
  });

  it("parses a well-formed softcover response into a CoverGeometry", async () => {
    vi.stubEnv("GELATO_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              bleedSize: { width: 410.58, height: 206.0 },
              contentBackSize: { width: 200.0, height: 200.0 },
              spineSize: { width: 4.58, height: 200.0 },
              contentFrontSize: { width: 200.0, height: 200.0 },
            }),
        } as Response),
      ),
    );
    const geometry = await fetchCoverGeometry("some-uid", 52);
    expect(geometry).not.toBeNull();
    expect(geometry!.source).toBe("gelato");
    expect(geometry!.spineWidthMm).toBeCloseTo(4.58, 2);
    expect(geometry!.wrapMm).toBe(0);
    expect(geometry!.joint).toBeUndefined();
  });

  it("parses a well-formed hardcover response, including its joints and wrap", async () => {
    vi.stubEnv("GELATO_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              wraparoundInsideSize: { width: 618.0, height: 326.0 },
              wraparoundEdgeSize: { width: 584.0, height: 292.0 },
              contentBackSize: { width: 278.0, height: 286.0 },
              jointBackSize: { width: 8, height: 286.0 },
              spineSize: { width: 6, height: 286.0 },
              jointFrontSize: { width: 8, height: 286.0 },
              contentFrontSize: { width: 278.0, height: 286.0 },
            }),
        } as Response),
      ),
    );
    const geometry = await fetchCoverGeometry("some-uid", 52);
    expect(geometry).not.toBeNull();
    expect(geometry!.source).toBe("gelato");
    expect(geometry!.sheetWidthMm).toBeCloseTo(618, 6);
    expect(geometry!.sheetHeightMm).toBeCloseTo(326, 6);
    expect(geometry!.wrapMm).toBeCloseTo(17, 6);
    expect(geometry!.bleedMm).toBeCloseTo(3, 6);
    expect(geometry!.joint).toEqual({ widthMm: 8, heightMm: 286 });
  });
});

describe("render.ts lays the cover out from CoverGeometry", () => {
  const squareSpec = defaultSpec(BOOK_SIZES.square);

  it("softcover output is unchanged: media box is trim*2 + spine + bleed*2", () => {
    const book = planBook(source([day(0), day(1), day(2)]), squareSpec, DEFAULT_OPTIONS);
    const volume = book.volumes[0];
    const cover = renderCover(volume, squareSpec, { loadImage });
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(Buffer.from(cover.pdf).toString("latin1"));
    expect(media).not.toBeNull();
    const expectedWidth =
      ((squareSpec.size.trimWidthMm * 2 + volume.cover.geometry.spineWidthMm + squareSpec.bleedMm * 2) / 25.4) * 72;
    expect(Number(media![1])).toBeCloseTo(expectedWidth, 1);
  });

  it("hardcover cover carries wrap and both joints in its geometry", () => {
    const hardSpec = defaultSpec(BOOK_SIZES["large-square"]);
    const book = planBook(source([day(0), day(1), day(2)]), hardSpec, DEFAULT_OPTIONS);
    const volume = book.volumes[0];
    expect(volume.cover.geometry.wrapMm).toBeGreaterThan(0);
    expect(volume.cover.geometry.joint).toBeDefined();
    const rendered = renderCover(volume, hardSpec, { loadImage });
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(Buffer.from(rendered.pdf).toString("latin1"));
    expect(media).not.toBeNull();
    const expectedWidth = (volume.cover.geometry.sheetWidthMm / 25.4) * 72;
    const expectedHeight = (volume.cover.geometry.sheetHeightMm / 25.4) * 72;
    expect(Number(media![1])).toBeCloseTo(expectedWidth, 1);
    expect(Number(media![2])).toBeCloseTo(expectedHeight, 1);
  });

  it("a softcover's geometry carries no joint", () => {
    const book = planBook(source([day(0), day(1), day(2)]), squareSpec, DEFAULT_OPTIONS);
    expect(book.volumes[0].cover.geometry.joint).toBeUndefined();
  });
});
