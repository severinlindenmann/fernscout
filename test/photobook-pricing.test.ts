import { describe, expect, test } from "vitest";
import {
  PHOTOBOOK_BASE_CREDITS,
  PHOTOBOOK_PAGE_CREDITS,
  PHOTOBOOK_PRICING_VERIFIED,
  photobookCredits,
  priceRappen,
} from "@/lib/credits/pricing";

describe("what a photobook costs", () => {
  test("is no longer an estimate", () => {
    // Gelato's price endpoint has answered for a real productUid — B841.
    // This flips back to false only if the basis is ever thrown away.
    expect(PHOTOBOOK_PRICING_VERIFIED).toBe(true);
  });

  test("covers the measured landed cost of a 52-page square book", () => {
    const landedChf = 6.04 + 0.161 * 52 + 8.52; // 22.92, Zurich, ex-VAT
    const charged = priceRappen(photobookCredits(52, "square")) / 100;
    expect(charged).toBeGreaterThan(landedChf);
    expect(charged).toBeLessThan(landedChf * 2);
  });

  test("a base plus a page term, always a whole number of credits", () => {
    const price = photobookCredits(52, "square");
    expect(price).toBe(PHOTOBOOK_BASE_CREDITS + PHOTOBOOK_PAGE_CREDITS * 52);
    expect(Number.isInteger(price)).toBe(true);
  });

  test("a wider page costs more paper", () => {
    expect(photobookCredits(52, "portrait")).toBeGreaterThan(photobookCredits(52, "square"));
    expect(Number.isInteger(photobookCredits(52, "portrait"))).toBe(true);
  });

  test("an unknown size is priced as the square, not as free", () => {
    expect(photobookCredits(52, "not-a-size")).toBe(photobookCredits(52, "square"));
  });
});
