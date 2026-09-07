import { describe, expect, test } from "vitest";
import {
  BASE_RAPPEN_PER_CREDIT,
  PHOTOBOOK_BASE_CREDITS,
  PHOTOBOOK_PRINT_MARGIN,
  PHOTOBOOK_PRICING_VERIFIED,
  photobookCredits,
  photobookPrintCredits,
} from "@/lib/credits/pricing";

/**
 * The measured basis, Zurich, CHF, ex-VAT, quoted 2026-09-07 for a 52-page
 * 200 × 200 softcover: print 14.40, Swiss Post Economy 8.52. Every number
 * below is checked against those two rather than against itself.
 */
const PRINT_MINOR = 1440;
const SHIP_MINOR = 852;
const LANDED_CHF = (PRINT_MINOR + SHIP_MINOR) / 100; // 22.92

describe("what building a photobook costs", () => {
  test("is measured, not estimated", () => {
    expect(PHOTOBOOK_PRICING_VERIFIED).toBe(true);
  });

  test("is flat — the render is the same work whatever the book", () => {
    expect(photobookCredits()).toBe(PHOTOBOOK_BASE_CREDITS);
    expect(Number.isInteger(photobookCredits())).toBe(true);
  });

  test("does not charge for paper, because printing is charged separately", () => {
    // The whole point of the split: building a PDF must cost less than the
    // paper it is not printed on. If this ever fails, the print cost has
    // crept back into the build price and the owner is paying twice.
    expect((photobookCredits() * BASE_RAPPEN_PER_CREDIT) / 100).toBeLessThan(LANDED_CHF);
  });
});

describe("what printing a photobook costs", () => {
  test("covers the measured landed cost and earns the intended margin", () => {
    const credits = photobookPrintCredits(PRINT_MINOR, SHIP_MINOR);
    const chargedChf = (credits * BASE_RAPPEN_PER_CREDIT) / 100;
    expect(chargedChf).toBeGreaterThan(LANDED_CHF);
    expect(chargedChf).toBeCloseTo(LANDED_CHF * PHOTOBOOK_PRINT_MARGIN, 1);
  });

  test("is 172 credits for the book we actually quoted", () => {
    // Pinned rather than derived: this is the number a person sees on the
    // panel, and a refactor that quietly changes it should fail here.
    expect(photobookPrintCredits(PRINT_MINOR, SHIP_MINOR)).toBe(172);
  });

  test("rises with postage, so an overseas book is not sold at a Swiss price", () => {
    const swiss = photobookPrintCredits(PRINT_MINOR, SHIP_MINOR);
    const far = photobookPrintCredits(PRINT_MINOR, SHIP_MINOR * 3);
    expect(far).toBeGreaterThan(swiss);
  });

  test("never charges a fraction of a credit, and never rounds down to under cost", () => {
    for (const [print, ship] of [
      [1, 0],
      [1118, 852],
      [3178, 1064],
      [2736, 852],
    ]) {
      const credits = photobookPrintCredits(print, ship);
      expect(Number.isInteger(credits)).toBe(true);
      expect(credits * BASE_RAPPEN_PER_CREDIT).toBeGreaterThanOrEqual(print + ship);
    }
  });
});
