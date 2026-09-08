import { afterEach, describe, expect, it, test } from "vitest";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { specFor, priceOf } from "@/lib/photobook/build";
import { planBook } from "@/lib/photobook/plan";
import { BOOK_SIZES, GELATO_PAGE_RULE } from "@/lib/photobook/spec";
import { pdfxReadiness } from "@/lib/photobook/pdfx";
import { photobookCredits } from "@/lib/credits/pricing";

// planFor and buildPhotobook read the filesystem; they are exercised by the
// fixture-backed test in Task 11's manual pass and by photobook-source's
// harness. What is unit-tested here is the two pure decisions.

describe("spec from options", () => {
  it("resolves a size id, and falls back to square", () => {
    expect(specFor({ ...DEFAULT_OPTIONS, size: "portrait" }).size).toBe(BOOK_SIZES["portrait"]);
    expect(specFor({ ...DEFAULT_OPTIONS, size: "nonsense" }).size).toBe(BOOK_SIZES["square"]);
  });

  it("always uses the one page rule, whatever a stored option says", () => {
    expect(specFor({ ...DEFAULT_OPTIONS, binding: "saddle" } as never).pageCount).toEqual(GELATO_PAGE_RULE);
    expect(specFor({ ...DEFAULT_OPTIONS, size: "large-square" }).pageCount).toEqual(GELATO_PAGE_RULE);
  });
});

describe("price of a planned book", () => {
  test("a multi-volume book is priced per volume", () => {
    const book = {
      volumes: [{ interiorPages: 40 }, { interiorPages: 60 }],
    } as unknown as ReturnType<typeof planBook>;
    expect(priceOf(book)).toBe(
      photobookCredits() + photobookCredits(),
    );
  });
});

describe("the printing condition a book declares — B1008", () => {
  const ORIGINAL = process.env.PRINT_ICC_PROFILE;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PRINT_ICC_PROFILE;
    else process.env.PRINT_ICC_PROFILE = ORIGINAL;
  });

  test("claims no PDF/X version when the operator has named no profile", () => {
    delete process.env.PRINT_ICC_PROFILE;
    const readiness = pdfxReadiness({
      outputIntent: false,
      fontsEmbedded: true,
      cmykContent: false,
      transparency: false,
    });
    expect(readiness.version).toBeUndefined();
    // Everything except the intent is now satisfied, which is the whole point
    // of retargeting at PDF/X-4: RGB stopped being a failure.
    expect(readiness.requirements.filter((r) => !r.met).map((r) => r.requirement)).toEqual([
      "OutputIntent with an embedded ICC profile",
    ]);
  });

  test("claims PDF/X-4 once a profile is named, and never before", () => {
    expect(
      pdfxReadiness({
        outputIntent: true,
        fontsEmbedded: true,
        cmykContent: false,
        transparency: false,
      }).version,
    ).toBe("PDF/X-4");
  });
});
