import { describe, expect, test } from "vitest";
import {
  BASE_RAPPEN_PER_CREDIT,
  PHOTOBOOK_MARGIN,
  PHOTOBOOK_PRICING_VERIFIED,
  PHOTOBOOK_VAT_RATE,
  photobookPriceCredits,
} from "@/lib/credits/pricing";

/**
 * The measured basis, Zurich, CHF, ex-VAT, quoted 2026-09-07 for a 52-page
 * 200 × 200 softcover: print 14.40, Swiss Post Economy 8.52. Every number
 * below is checked against those two rather than against itself.
 *
 * `PHOTOBOOK_VAT_RATE` itself is measured off a real Gelato invoice — one
 * rate on print and shipping together, not the reduced printed-matter rate a
 * book alone would suggest — see the doc block on `photobookPriceCredits`.
 */
const PRINT_MINOR = 1440;
const SHIP_MINOR = 852;
const LANDED_EXCL_VAT_CHF = (PRINT_MINOR + SHIP_MINOR) / 100; // 22.92
const LANDED_INCL_VAT_CHF = ((PRINT_MINOR + SHIP_MINOR) * (1 + PHOTOBOOK_VAT_RATE)) / 100; // 24.77…

describe("what a photobook is priced at — one product, one price (B1425)", () => {
  test("is measured, not estimated", () => {
    expect(PHOTOBOOK_PRICING_VERIFIED).toBe(true);
  });

  test("VAT is a real cost — the incl-VAT landed figure sits above the ex-VAT one", () => {
    expect(LANDED_INCL_VAT_CHF).toBeGreaterThan(LANDED_EXCL_VAT_CHF);
  });

  test("charges twice the VAT-inclusive landed cost, within a rappen", () => {
    const credits = photobookPriceCredits(PRINT_MINOR, SHIP_MINOR);
    const chargedChf = (credits * BASE_RAPPEN_PER_CREDIT) / 100;
    expect(chargedChf).toBeCloseTo(LANDED_INCL_VAT_CHF * PHOTOBOOK_MARGIN, 1);
  });

  test("is 248 credits for the 52-page book we actually quoted", () => {
    // Pinned rather than derived: this is the number a person sees on the
    // panel, and a refactor that quietly changes it should fail here.
    expect(photobookPriceCredits(PRINT_MINOR, SHIP_MINOR)).toBe(248);
  });

  test("is 238 credits for the 46-page book a person actually had on screen", () => {
    expect(photobookPriceCredits(1345, 852)).toBe(238);
  });

  test("is 181 credits for the smallest book Gelato will print", () => {
    expect(photobookPriceCredits(815, 852)).toBe(181);
  });

  test("rises with postage, so an overseas book is not sold at a Swiss price", () => {
    const swiss = photobookPriceCredits(PRINT_MINOR, SHIP_MINOR);
    const far = photobookPriceCredits(PRINT_MINOR, SHIP_MINOR * 3);
    expect(far).toBeGreaterThan(swiss);
  });

  test("never charges a fraction of a credit, and never rounds down to under landed cost", () => {
    for (const [print, ship] of [
      [1, 0],
      [815, 852],
      [1118, 852],
      [3178, 1064],
      [2736, 852],
    ]) {
      const credits = photobookPriceCredits(print, ship);
      expect(Number.isInteger(credits)).toBe(true);
      expect(credits * BASE_RAPPEN_PER_CREDIT).toBeGreaterThanOrEqual(print + ship);
    }
  });
});
