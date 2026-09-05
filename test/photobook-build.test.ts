import { describe, expect, test } from "vitest";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { specFor, priceOf } from "@/lib/photobook/build";
import { planBook } from "@/lib/photobook/plan";
import { BOOK_SIZES, SADDLE_STITCH, portableRule } from "@/lib/photobook/spec";
import { photobookCredits } from "@/lib/credits/pricing";

// planFor and buildPhotobook read the filesystem; they are exercised by the
// fixture-backed test in Task 11's manual pass and by photobook-source's
// harness. What is unit-tested here is the two pure decisions.

describe("spec from options", () => {
  test("the size comes from the catalogue and an unknown one falls back to the square", () => {
    expect(specFor({ ...DEFAULT_OPTIONS, size: "landscape-a4" }).size).toBe(BOOK_SIZES["landscape-a4"]);
    expect(specFor({ ...DEFAULT_OPTIONS, size: "nonsense" }).size).toBe(BOOK_SIZES["square-210"]);
  });

  test("saddle stitch changes the page-count rule, perfect binding keeps the portable one", () => {
    expect(specFor({ ...DEFAULT_OPTIONS, binding: "saddle" }).pageCount).toEqual(SADDLE_STITCH);
    expect(specFor({ ...DEFAULT_OPTIONS, binding: "perfect" }).pageCount).toEqual(portableRule());
  });
});

describe("price of a planned book", () => {
  test("a multi-volume book is priced per volume", () => {
    const book = {
      volumes: [{ interiorPages: 40 }, { interiorPages: 60 }],
    } as unknown as ReturnType<typeof planBook>;
    expect(priceOf(book, DEFAULT_OPTIONS)).toBe(
      photobookCredits(40, "square-210") + photobookCredits(60, "square-210"),
    );
  });
});
