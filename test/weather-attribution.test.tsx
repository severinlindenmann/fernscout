import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DayWeather from "@/components/DayWeather";
import type { DayWeather as Reading } from "@/lib/weather";

/**
 * Who gets credited for a reading, and who does not — B325.
 *
 * Open-Meteo's data is CC BY 4.0, and its licence is specific about where the
 * credit goes: *"You must include a link next to any location Open-Meteo data
 * are displayed."* Not a mention in the imprint instead — next to the data.
 * The imprint carries it too, but that is in addition, and a change that moved
 * the credit there and dropped the link would put this instance outside the
 * licence it relies on.
 *
 * The other half is the one that is easy to get backwards: **a reading a
 * person took themselves is not Open-Meteo data, and must not be credited to
 * them.** Attributing somebody's own thermometer to an archive would be a
 * false statement about where a number came from — the exact failure the
 * provenance rules in `lib/validate/entry.ts` exist to prevent, arriving via
 * the rendering instead of via the write.
 *
 * So this file asserts both directions at once, on the markup, because both
 * are claims about what a reader sees rather than about what a function
 * returns.
 */

const labels = { description: "Rain", via: "Weather recorded by X, 6 September" };

function render(weather: Reading): string {
  return renderToStaticMarkup(<DayWeather weather={weather} labels={labels} />);
}

const ARCHIVE: Reading = {
  tempMin: 2,
  tempMax: 18,
  code: 61,
  precipitation: 2.9,
  source: "open-meteo",
  recordedAt: "2026-09-06T08:32:19.563Z",
};

const BY_HAND: Reading = {
  tempMin: 2,
  tempMax: 6,
  code: 63,
  precipitation: 11,
  source: "the guesthouse thermometer",
  recordedAt: "2024-09-13T18:30:00Z",
};

describe("an archive reading", () => {
  test("carries a link to Open-Meteo next to the data, as the licence requires", () => {
    const html = render(ARCHIVE);
    expect(html).toContain('href="https://open-meteo.com/"');
    // Next to the data, not somewhere else on the page: the reading falls
    // between the opening anchor and its close, so the link is the element
    // the data is inside. Asserted by position rather than with a dot-all
    // regex, which needs a newer target than this project compiles to.
    const opens = html.indexOf('<a ');
    const closes = html.indexOf("</a>");
    const reading = html.indexOf("2° – 18°C");
    expect(opens).toBeGreaterThanOrEqual(0);
    expect(reading).toBeGreaterThan(opens);
    expect(reading).toBeLessThan(closes);
  });

  test("does not leak the machine name to a reader", () => {
    // The stored value is `open-meteo`; what a person is shown is Open-Meteo,
    // which the caller resolves through SOURCE_CREDIT before it gets here.
    expect(render(ARCHIVE)).not.toContain(">open-meteo<");
  });
});

describe("a reading somebody took themselves", () => {
  test("is never credited to Open-Meteo", () => {
    const html = render(BY_HAND);
    expect(html).not.toContain("open-meteo.com");
    expect(html.toLowerCase()).not.toContain("open-meteo");
  });

  test("is not a link at all, so the two kinds are distinguishable", () => {
    expect(render(BY_HAND)).not.toContain("<a ");
  });

  test("still shows the reading and its own provenance in the title", () => {
    const html = render(BY_HAND);
    expect(html).toContain("2° – 6°C");
    expect(html).toContain(labels.via);
  });
});

describe("nothing to show", () => {
  test("a day with no reading renders nothing and reserves no space", () => {
    expect(renderToStaticMarkup(<DayWeather weather={undefined} labels={labels} />)).toBe("");
  });

  test("a reading with no drawable code and no numbers renders nothing", () => {
    const empty: Reading = { source: "a station", recordedAt: "2026-01-01T00:00:00Z" };
    expect(renderToStaticMarkup(<DayWeather weather={empty} labels={labels} />)).toBe("");
  });
});
