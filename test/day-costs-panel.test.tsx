import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DayCosts from "@/components/DayCosts";
import LocaleProvider from "@/components/LocaleProvider";
import { COST_CATEGORIES, type RawCostItem } from "@/lib/costFormat";
import { dictionaryFor } from "@/lib/locales";

/**
 * The form a person with a shoebox of receipts actually fills in — B820.
 *
 * The route test beside this one proves where a receipt lands. This proves the
 * things only the first render can say: that the currency starts as the
 * journal's own rather than empty or guessed, that the day starts as the day
 * on the screen, and that the categories offered are exactly the closed list
 * and not a free-text box somebody can put "shopping" into.
 */

function render(costs: RawCostItem[] = []) {
  return renderToStaticMarkup(
    <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
      <DayCosts
        username="alex"
        trip="a-trip"
        slug="2026-05-02-tag"
        date="2026-05-02"
        base="CHF"
        currencies={["CHF", "EUR"]}
        costs={costs}
      />
    </LocaleProvider>,
  );
}

describe("the receipt form", () => {
  test("the currency starts as the journal's own", () => {
    expect(render()).toContain('id="cost-currency"');
    expect(render()).toContain('value="CHF"');
  });

  test("the day starts as the day on the screen", () => {
    expect(render()).toContain('value="2026-05-02"');
  });

  test("the categories are the closed list and nothing else", () => {
    const html = render();
    for (const category of COST_CATEGORIES) {
      expect(html, category).toContain(`value="${category}"`);
    }
    expect(html).toContain('id="cost-category"');
    expect(html).not.toContain("shopping");
  });

  test("it says what is already on the day, and says so when nothing is", () => {
    expect(render()).toContain("Für diesen Tag ist noch nichts aufgeschrieben.");
    const one = render([{ label: "Abendessen", amount: 42, currency: "EUR", category: "food" }]);
    expect(one).toContain("Abendessen");
    expect(one).toContain("42 EUR");
  });
});
