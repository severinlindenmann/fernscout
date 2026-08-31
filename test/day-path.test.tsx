import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GamePath from "@/components/GamePath";
import LocaleProvider from "@/components/LocaleProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import { dictionaryFor } from "@/lib/locales";
import type { DaySummary } from "@/lib/types";

/**
 * The desktop path and the mobile day list are the same navigation.
 *
 * They are drawn completely differently — a winding rail of nodes against a
 * plain list — and that is deliberate, because a cramped horizontal strip is
 * no way to pick a day on a phone. What is *said* about each day should not
 * differ, though, and it did: mobile led with "day 3, 7 September, CHF 54"
 * while the path showed a place name and nothing else. Which day of the trip
 * you were looking at, and when it was, were readable on a phone and not on a
 * desktop.
 */

function days(): DaySummary[] {
  return [
    {
      date: "2026-09-05",
      slug: "las-vegas",
      location: "Las Vegas",
      country: "United States",
      countryCode: "US",
      lat: 36.17,
      lng: -115.14,
      updates: 1,
      cost: 126,
    },
    {
      date: "2026-09-06",
      slug: "zion",
      location: "Zion National Park",
      country: "United States",
      countryCode: "US",
      lat: 37.3,
      lng: -113.03,
      transport: { mode: "car", from: "Las Vegas", to: "Zion" },
      updates: 3,
      cost: 211,
    },
  ];
}

function render(index = 0) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <CurrencyProvider
        options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}
      >
        <GamePath days={days()} currentIndex={index} />
      </CurrencyProvider>
    </LocaleProvider>,
  );
}

describe("the desktop day path", () => {
  test("numbers each day, counting from one", () => {
    const html = render();
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
  });

  test("says when the day was", () => {
    const html = render();
    // Whatever the locale's short form is, both days must carry their own.
    expect(html).toContain("5 Sep");
    expect(html).toContain("6 Sep");
  });

  test("carries what the mobile list carries: place, date and spend", () => {
    const html = render();
    for (const shown of ["Las Vegas", "Zion National Park", "5 Sep", "126", "211"]) {
      expect(html, `expected the path to show ${shown}`).toContain(shown);
    }
  });

  test("names several updates on one day, rather than hiding them in a badge", () => {
    expect(render()).toMatch(/3 updates/i);
  });

  /** A day with nothing spent should not print a currency symbol and a zero. */
  test("says nothing about money on a day that cost nothing", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <GamePath days={[{ ...days()[0], cost: 0 }]} currentIndex={0} />
        </CurrencyProvider>
      </LocaleProvider>,
    );
    expect(html).toContain("Las Vegas");
    expect(html).not.toContain("CHF");
  });

  test("marks the day being read, for a screen reader as well as visually", () => {
    expect(render(1)).toContain('aria-current="true"');
  });
});
