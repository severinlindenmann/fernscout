import { describe, expect, test } from "vitest";
import {
  PHOTOBOOK_BASE_CREDITS,
  PHOTOBOOK_PAGE_CREDITS,
  PHOTOBOOK_PRICING_VERIFIED,
  photobookCredits,
} from "@/lib/credits/pricing";

describe("what a photobook costs", () => {
  test("nobody has confirmed these numbers against a provider", () => {
    // They came from nowhere but arithmetic. When Gelato's price endpoint has
    // answered for a real productUid, change this to true in the same commit
    // that puts the real numbers in — this test is the reminder.
    expect(PHOTOBOOK_PRICING_VERIFIED).toBe(false);
  });

  test("a base plus a page term, always a whole number of credits", () => {
    const price = photobookCredits(52, "square-210");
    expect(price).toBe(PHOTOBOOK_BASE_CREDITS + PHOTOBOOK_PAGE_CREDITS * 52);
    expect(Number.isInteger(price)).toBe(true);
  });

  test("a wider page costs more paper", () => {
    expect(photobookCredits(52, "landscape-a4")).toBeGreaterThan(photobookCredits(52, "square-210"));
    expect(Number.isInteger(photobookCredits(52, "landscape-a4"))).toBe(true);
  });

  test("an unknown size is priced as the square, not as free", () => {
    expect(photobookCredits(52, "not-a-size")).toBe(photobookCredits(52, "square-210"));
  });
});
