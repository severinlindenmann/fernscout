import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Pricing from "@/components/Pricing";
import {
  EXTRA_STORAGE_CREDITS,
  POSTCARD_CREDITS,
  BASE_RAPPEN_PER_CREDIT,
  MAX_CREDITS,
  MIN_CREDITS,
  creditsInRappen,
  formatChf,
  photobookCredits,
} from "@/lib/credits/pricing";
import { dictionaryFor } from "@/lib/locales";

/**
 * B840 — the pricing table, and the one property that makes it worth having.
 *
 * **Every number on it comes from the constant that charges it.** A price
 * typed into a translation string is a price that disagrees with the till
 * within a month, and a *published* one is the worst version of that: the
 * postcard was 15 credits in four places before this. So the test that
 * matters is not "the table renders" but "raise `POSTCARD_CREDITS` and the
 * page says the new number" — which is what asserting against the imported
 * constants, rather than against literals, actually checks.
 *
 * Whether the table appears at all is the caller's decision (`isEnabled
 * ("credits")` on `/` and `/docs`), so it is not this file's business.
 */

const html = () => renderToStaticMarkup(<Pricing locale="en" />);

describe("the pricing table", () => {
  test("prices a postcard from the constant the send charges", () => {
    expect(html()).toContain(`>${POSTCARD_CREDITS}<`);
  });

  test("prices extra storage from the constant the purchase spends", () => {
    expect(html()).toContain(`>${EXTRA_STORAGE_CREDITS}<`);
  });

  test("quotes the photobook from the smallest book the planner will bind, printed in Switzerland", () => {
    const from = photobookCredits(32, "square");
    const rendered = html();
    expect(rendered).toContain(String(from));
    // Said in the row itself, not only in a source comment: since B841 the
    // price is measured, and the row says where it is printed rather than
    // hedging with "estimate".
    expect(rendered).toContain("Printed in Switzerland");
  });

  test("states the range it sells and both ends of the per-credit price", () => {
    const rendered = html();
    // B854 replaced the tier rows with the range the slider covers. A page
    // still naming a fixed tier would be naming a purchase the route refuses.
    expect(rendered).toContain(String(MIN_CREDITS));
    expect(rendered).toContain(String(MAX_CREDITS));
    expect(rendered).toContain(formatChf(BASE_RAPPEN_PER_CREDIT));
  });

  test("prints what one credit is worth in francs, not only in credits", () => {
    expect(html()).toContain(formatChf(creditsInRappen(1)));
  });

  test("says email is free, which is the whole of B840's fairness claim", () => {
    expect(html()).toContain(dictionaryFor("en")["pricing.freeEmail"]);
  });

  test("renders in a language that is not English", () => {
    const de = renderToStaticMarkup(<Pricing locale="de" />);
    expect(de).toContain(dictionaryFor("de")["pricing.title"]);
    // Prices are not translated — they are arithmetic, in the same currency.
    expect(de).toContain(`>${POSTCARD_CREDITS}<`);
  });
});
