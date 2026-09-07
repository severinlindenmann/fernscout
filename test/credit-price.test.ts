import { describe, expect, test } from "vitest";
import {
  BASE_RAPPEN_PER_CREDIT,
  CREDIT_STEP,
  DISCOUNT_FROM,
  MAX_CREDITS,
  MIN_CREDITS,
  discountFor,
  discountLabel,
  isBuyableAmount,
  priceRappen,
} from "@/lib/credits/pricing";

/**
 * The price curve — B854.
 *
 * A slider makes two properties matter that a fixed list of three amounts did
 * not, because a person now drags across every amount in between and watches
 * the number under their thumb:
 *
 * **More always costs more.** A total that ever falls as the amount rises is a
 * slider people stop trusting, and it is exactly what a banded discount does
 * at each boundary.
 *
 * **Each extra credit costs less than the last.** That is the whole reason to
 * drag right, and the thing a person is being told when the discount is
 * printed.
 *
 * Both are asserted across the entire range rather than at a few chosen
 * points, because a curve that holds at 50, 200 and 500 and dips at 310 is the
 * bug this file exists for.
 */

const AMOUNTS: number[] = [];
for (let n = MIN_CREDITS; n <= MAX_CREDITS; n += CREDIT_STEP) AMOUNTS.push(n);

describe("what a purchase costs", () => {
  test("the ends are the prices the pricing table promises", () => {
    expect(priceRappen(MIN_CREDITS)).toBe(MIN_CREDITS * BASE_RAPPEN_PER_CREDIT);
    expect(priceRappen(DISCOUNT_FROM)).toBe(DISCOUNT_FROM * BASE_RAPPEN_PER_CREDIT);
    // 20% off at the top, exactly.
    expect(priceRappen(MAX_CREDITS)).toBe(MAX_CREDITS * BASE_RAPPEN_PER_CREDIT * 0.8);
  });

  test("every price is a whole number of rappen", () => {
    for (const n of AMOUNTS) expect(Number.isInteger(priceRappen(n))).toBe(true);
  });

  test("more credits always cost more", () => {
    for (let i = 1; i < AMOUNTS.length; i++) {
      const [prev, next] = [AMOUNTS[i - 1], AMOUNTS[i]];
      expect(priceRappen(next), `${next} vs ${prev}`).toBeGreaterThan(priceRappen(prev));
    }
  });

  test("each extra credit costs less than the one before it", () => {
    for (let i = 1; i < AMOUNTS.length; i++) {
      const [prev, next] = [AMOUNTS[i - 1], AMOUNTS[i]];
      const per = (n: number) => priceRappen(n) / n;
      // Not `toBeLessThan` below `DISCOUNT_FROM`: the first fifty are all at
      // the base rate, and flat is the intended behaviour there.
      if (next <= DISCOUNT_FROM) expect(per(next)).toBe(per(prev));
      else expect(per(next), `${next} vs ${prev}`).toBeLessThan(per(prev));
    }
  });

  test("nobody ever pays more than the base rate, or less than 20% off it", () => {
    for (const n of AMOUNTS) {
      expect(priceRappen(n)).toBeLessThanOrEqual(n * BASE_RAPPEN_PER_CREDIT);
      expect(priceRappen(n)).toBeGreaterThanOrEqual(n * BASE_RAPPEN_PER_CREDIT * 0.8);
      expect(discountFor(n)).toBeGreaterThanOrEqual(0);
      expect(discountFor(n)).toBeLessThanOrEqual(0.2);
    }
  });

  test("the discount is printed in whole percents", () => {
    for (const n of AMOUNTS) expect(discountLabel(n)).toMatch(/^\d{1,2}%$/);
  });
});

describe("what may be bought", () => {
  test("every position the slider can take is buyable", () => {
    for (const n of AMOUNTS) expect(isBuyableAmount(n), String(n)).toBe(true);
  });

  test("out of range, off the step, or not a whole number is refused", () => {
    for (const bad of [
      MIN_CREDITS - CREDIT_STEP,
      MAX_CREDITS + CREDIT_STEP,
      0,
      -50,
      137,
      50.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(isBuyableAmount(bad), String(bad)).toBe(false);
    }
  });

  test("a string that looks like an amount is refused, not coerced", () => {
    // The route hands this whatever JSON.parse produced. "50" arriving as a
    // string is a client bug, and pricing it would hide the bug rather than
    // report it.
    for (const bad of ["50", null, undefined, {}, []]) {
      expect(isBuyableAmount(bad), JSON.stringify(bad) ?? "undefined").toBe(false);
    }
  });
});
