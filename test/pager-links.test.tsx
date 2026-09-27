import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PagerNav, { type PagerNavState } from "@/components/PagerNav";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/** B2477 — Back and Continue are anchors to the step they lead to. */
const base: PagerNavState = {
  stepIndex: 1,
  stepCount: 3,
  isTravel: false,
  legDone: false,
  label: "Day 1 of 2",
  tripOver: true,
  onBack: () => {},
  onNext: () => {},
  backHref: "/alex/trips/t",
  nextHref: "/alex/trips/t/day/two",
};

function render(state: PagerNavState, compact = false) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <PagerNav state={state} compact={compact} />
    </LocaleProvider>,
  );
}

describe("the pager is links", () => {
  test.each([false, true])("compact=%s: Back and Continue are <a href>", (compact) => {
    const html = render(base, compact);
    expect(html).toMatch(/<a[^>]*href="\/alex\/trips\/t"/);
    expect(html).toMatch(/<a[^>]*href="\/alex\/trips\/t\/day\/two"/);
  });

  test("Back on the first step has nowhere to go and stays a disabled button", () => {
    const html = render({ ...base, stepIndex: 0, backHref: undefined }, true);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
