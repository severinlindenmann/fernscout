import { describe, expect, it, afterEach, vi } from "vitest";

import { computeCoverGeometry, fetchCoverGeometry } from "@/lib/photobook/coverGeometry";
import { auditPdfxBytes, outputIntentFor, readIcc } from "@/lib/photobook/pdfx";
import fs from "node:fs";
import { BOOK_SIZES, defaultSpec, pageMediaBoxMm } from "@/lib/photobook/spec";
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

describe("the hardcover spine is a table, not a line", () => {
  /**
   * Gelato's own answers, fetched 2026-09-07 for the 280 x 280 hardcover.
   * The page counts are the ones it reports back, already rounded up by 4.
   * A line through two of these misses the rest: 44, 60 and 72 pages give
   * 6, 6 and 9 mm, which no straight line does.
   */
  const MEASURED: [number, number][] = [
    [32, 6],
    [44, 6],
    [56, 6],
    [60, 6],
    [72, 9],
    [84, 11],
    [96, 11],
    [104, 11],
    [108, 13],
    [132, 14],
    [156, 16],
    [164, 16],
    [180, 18],
    [204, 19],
  ];

  it("reproduces every measured row exactly", () => {
    for (const [answered, spine] of MEASURED) {
      // `answeredPageCount` adds 4, so ask for the count Gelato was asked.
      const spec = defaultSpec(BOOK_SIZES["large-square"], "hard");
      expect(computeCoverGeometry(spec, answered - 4).spineWidthMm).toBe(spine);
    }
  });

  it("never comes out under the measured value between rows", () => {
    // Too wide wastes a millimetre of board; too narrow wraps the front
    // cover image around onto the spine, and that is only visible on paper.
    const spec = defaultSpec(BOOK_SIZES["large-square"], "hard");
    for (let pages = 28; pages <= 200; pages += 2) {
      const ours = computeCoverGeometry(spec, pages).spineWidthMm;
      const answered = pages + 4;
      const below = MEASURED.filter(([p]) => p <= answered).pop();
      if (below) expect(ours).toBeGreaterThanOrEqual(below[1]);
    }
  });

  it("a 32-page hardcover is 6 mm, not the 3.78 a straight line gave", () => {
    const spec = defaultSpec(BOOK_SIZES["large-square"], "hard");
    expect(computeCoverGeometry(spec, 28).spineWidthMm).toBe(6);
    expect(computeCoverGeometry(spec, 28).sheetWidthMm).toBeCloseTo(618, 1);
  });
});

describe("the TrimBox is the trimmed edge, not the start of the content", () => {
  /**
   * Gelato positions cover artwork from the PDF's TrimBox. A hardcover case
   * is folded at `wraparoundEdgeSize`, 17 mm in on a 200 x 200 book, and the
   * 3 mm beyond that is bleed carried round the turn-in. Insetting by 20 —
   * the wrap plus the bleed, which is where the *board content* starts — made
   * Gelato rescale the whole sheet to fit ours, and every hardcover came back
   * shrunk into the top-left with its title clipped.
   */
  it("insets a hardcover by the wrap alone", () => {
    const g = computeCoverGeometry(defaultSpec(BOOK_SIZES.square, "hard"), 28);
    expect(g.wrapMm).toBe(17);
    expect(g.bleedMm).toBe(3);
    expect(g.trimInsetMm).toBe(17);
    // Gelato's own wraparoundEdgeSize for this book: 424 x 212 on 458 x 246.
    expect(g.sheetWidthMm - g.trimInsetMm * 2).toBeCloseTo(424, 2);
    expect(g.sheetHeightMm - g.trimInsetMm * 2).toBeCloseTo(212, 2);
  });

  it("insets a softcover by the bleed, which is what it always did", () => {
    const g = computeCoverGeometry(defaultSpec(BOOK_SIZES.square, "soft"), 28);
    expect(g.wrapMm).toBe(0);
    expect(g.trimInsetMm).toBe(g.bleedMm);
    expect(g.sheetHeightMm - g.trimInsetMm * 2).toBeCloseTo(200, 2);
  });

  it("takes the fold line from Gelato when it answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      pagesCount: 32, measureUnit: "mm",
      wraparoundInsideSize: { width: 458, height: 246, thickness: 17 },
      wraparoundEdgeSize: { width: 424, height: 212, thickness: 3 },
      contentBackSize: { width: 198, height: 206 },
      jointBackSize: { width: 8, height: 206 },
      spineSize: { width: 6, height: 206 },
      jointFrontSize: { width: 8, height: 206 },
      contentFrontSize: { width: 198, height: 206 },
    }), { status: 200 })));
    process.env.GELATO_API_KEY = "test-key";
    const g = await fetchCoverGeometry("photobooks-hardcover_pf_x", 28);
    expect(g?.trimInsetMm).toBeCloseTo(17, 2);
    expect(g?.source).toBe("gelato");
  });
});

describe("the file matches Gelato's own product template", () => {
  /**
   * Measured from `product_template_photobooks-softcover_pf_210x280-mm-8x11-inch
   * …_ver.pdf`, downloaded from the Gelato dashboard on 2026-09-08. Thirty-one
   * pages: one cover at 428.72 x 286 mm and thirty interior pages at
   * 216 x 286, and every page carries TrimBox == BleedBox == MediaBox.
   */
  it("emits the template's cover and interior sizes for the portrait book", () => {
    const spec = defaultSpec(BOOK_SIZES.portrait, "soft");
    const cover = computeCoverGeometry(spec, 28);
    expect(cover.sheetWidthMm).toBeCloseTo(428.72, 2);
    expect(cover.sheetHeightMm).toBeCloseTo(286, 2);

    const media = pageMediaBoxMm(spec);
    expect(media.width).toBeCloseTo(216, 2);
    expect(media.height).toBeCloseTo(286, 2);
  });

  it("does not inset the trim, because the template does not", () => {
    // Gelato positions artwork from the TrimBox. An inset one made it rescale
    // the whole sheet — 86.3% of the canvas instead of 100%.
    const spec = defaultSpec(BOOK_SIZES.portrait, "soft");
    const volume = { interiorPages: 28 } as never;
    void volume;
    // The renderer's boxes are asserted end-to-end in photobook.test.ts; here
    // we pin the intent: trim is the whole sheet, and the geometry still
    // knows where the real edge is for guides and clipping.
    expect(computeCoverGeometry(spec, 28).trimInsetMm).toBe(spec.bleedMm);
  });
});

describe("what the file actually is, not what the writer intended — B1008", () => {
  const squareSpec = defaultSpec(BOOK_SIZES.square);
  const ICC = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";
  const haveIcc = fs.existsSync(ICC);

  it("passes its own audit when it claims nothing", () => {
    const volume = planBook(source([day(0), day(1), day(2)]), squareSpec, DEFAULT_OPTIONS).volumes[0];
    const pdf = renderVolume(volume, squareSpec, { loadImage, document: { title: "t" } }).pdf;
    const audit = auditPdfxBytes(pdf);
    expect(audit.claims).toBeNull();
    expect(audit.failures).toEqual([]);
  });

  it.runIf(haveIcc)("claims PDF/X-4 under a 1.6 header, never a 1.4 one", () => {
    const intent = outputIntentFor(readIcc(new Uint8Array(fs.readFileSync(ICC))));
    const volume = planBook(source([day(0), day(1), day(2)]), squareSpec, DEFAULT_OPTIONS).volumes[0];
    const pdf = renderVolume(volume, squareSpec, {
      loadImage,
      document: { title: "t", outputIntent: intent, pdfxVersion: "PDF/X-4" },
    }).pdf;
    const audit = auditPdfxBytes(pdf);
    // The bug this exists for: a file that says PDF/X-4 in a %PDF-1.4 header.
    // ISO 15930-7 is built on PDF 1.6, and every preflight checks it first.
    expect(audit.claims).toBe("PDF/X-4");
    expect(audit.failures).toEqual([]);
    expect(Buffer.from(pdf).subarray(0, 8).toString()).toBe("%PDF-1.6");
  });

  it("notices when a font dictionary has no embedded program", () => {
    const broken = Buffer.from(
      "%PDF-1.6\n/Type /Font\n/Type /Font\n/FontFile2\n/Type /Page\n/TrimBox\nGTS_PDFXVersion (PDF/X-4)\n" +
        "<pdfxid:GTS_PDFXVersion>\n/OutputIntents\n/DestOutputProfile\n",
    );
    const audit = auditPdfxBytes(new Uint8Array(broken));
    expect(audit.ok).toBe(false);
    expect(audit.failures.join(" ")).toContain("font dictionaries");
  });
});

describe("the audit reads structure, not photographs", () => {
  /**
   * The first live file this ran against was reported as "carries JavaScript"
   * because ten megabytes of JPEG contained the bytes `/JS`. An audit that
   * cries wolf on a good file is worse than no audit: it is the one that gets
   * switched off.
   */
  it("ignores bytes inside streams", () => {
    const withJsInAStream = Buffer.from(
      "%PDF-1.4\n" +
        "1 0 obj\n<< /Length 20 >>\nstream\n/JavaScript /Encrypt /JS\nendstream\nendobj\n" +
        "trailer\n<< >>\n",
    );
    expect(auditPdfxBytes(new Uint8Array(withJsInAStream)).failures).toEqual([]);
  });

  it("still catches them in the structure", () => {
    const real = Buffer.from("%PDF-1.4\n1 0 obj\n<< /JavaScript 2 0 R >>\nendobj\n");
    expect(auditPdfxBytes(new Uint8Array(real)).failures.join(" ")).toContain("JavaScript");
  });
});
