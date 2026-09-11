import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Pricing from "@/components/Pricing";
import { SIGNUP_CREDIT_GRANT } from "@/lib/credits";
import {
  EXTRA_STORAGE_CREDITS,
  POSTCARD_CREDITS,
  MAX_CREDITS,
  MIN_CREDITS,
  PHOTOBOOK_QUOTE_MINIMUM,
  creditsInRappen,
  formatChf,
  photobookPriceCredits,
  priceRappen,
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
 * Since B1332 the table prices in francs, not credits: a visitor should not
 * have to learn a private unit to judge a price. Credits appear exactly
 * twice — the signup-gift line and the explaining note — and both are
 * asserted here so neither can quietly disappear.
 *
 * Whether the table appears at all is the caller's decision (`isEnabled
 * ("credits")` on `/` and `/docs`), so it is not this file's business.
 */

const html = () => renderToStaticMarkup(<Pricing locale="en" />);

describe("the pricing table", () => {
  test("prices a postcard in francs, from the constant the send charges", () => {
    expect(html()).toContain(formatChf(creditsInRappen(POSTCARD_CREDITS)));
  });

  test("prices extra storage in francs, from the constant the purchase spends", () => {
    expect(html()).toContain(formatChf(creditsInRappen(EXTRA_STORAGE_CREDITS)));
  });

  test("quotes the printed photobook as a floor, from the smallest book Gelato prints", () => {
    // B1425: one product, one price, and it depends on the size, the page
    // count and where it goes — so the table shows a "from" figure, priced
    // off the smallest book Gelato will print rather than a mid-sized example.
    const rappen = creditsInRappen(
      photobookPriceCredits(PHOTOBOOK_QUOTE_MINIMUM.printMinor, PHOTOBOOK_QUOTE_MINIMUM.shipMinor),
    );
    const rendered = html();
    expect(rendered).toContain(formatChf(rappen));
    expect(rendered).toContain("from");
    // Printed near the recipient, not "in Switzerland" — Gelato prints in
    // the destination country, and the old wording was only true for Swiss
    // recipients.
    expect(rendered).toContain("printed locally");
    expect(rendered).not.toContain("Switzerland");
  });

  test("explains the credit unit once: worth, gift value, smallest and best purchase", () => {
    const rendered = html();
    expect(rendered).toContain(formatChf(creditsInRappen(1)));
    expect(rendered).toContain(formatChf(creditsInRappen(SIGNUP_CREDIT_GRANT)));
    expect(rendered).toContain(formatChf(priceRappen(MIN_CREDITS)));
    expect(rendered).toContain(
      formatChf(Math.round(priceRappen(MAX_CREDITS) / MAX_CREDITS)),
    );
  });

  test("highlights the signup gift from the constant signup actually grants", () => {
    expect(html()).toContain(
      dictionaryFor("en")["pricing.freeGrant"].replace(
        "{credits}",
        String(SIGNUP_CREDIT_GRANT),
      ),
    );
  });

  test("says email is free, which is the whole of B840's fairness claim", () => {
    expect(html()).toContain(dictionaryFor("en")["pricing.freeEmail"]);
  });

  test("renders in a language that is not English", () => {
    const de = renderToStaticMarkup(<Pricing locale="de" />);
    expect(de).toContain(dictionaryFor("de")["pricing.title"]);
    // Prices are not translated — they are arithmetic, in the same currency.
    expect(de).toContain(formatChf(creditsInRappen(POSTCARD_CREDITS)));
  });
});
