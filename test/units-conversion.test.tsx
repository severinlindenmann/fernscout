import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DayWeather from "@/components/DayWeather";
import { celsiusToFahrenheit, kmhToMph, mmToInches } from "@/lib/units";
import type { DayWeather as Reading } from "@/lib/weather";

/**
 * B1592 — `units` was stored and editable on every journal's config but
 * nothing read it: weather always rendered °C and mm regardless of what a
 * person chose. This is the counterpart of test/weather-attribution.test.tsx,
 * asserting the conversion rather than the credit.
 */

const labels = { description: "Rain", via: "Weather recorded by X, 6 September" };

const READING: Reading = {
  tempMin: 0,
  tempMax: 20,
  code: 61,
  precipitation: 25.4,
  source: "open-meteo",
  recordedAt: "2026-09-06T08:32:19.563Z",
};

describe("lib/units conversions", () => {
  test("celsiusToFahrenheit matches the known fixed points", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
  });

  test("mmToInches and kmhToMph match the standard factors", () => {
    expect(mmToInches(25.4)).toBeCloseTo(1, 6);
    expect(kmhToMph(1.609344)).toBeCloseTo(1, 6);
  });
});

describe("DayWeather converts by the journal's own units", () => {
  test("metric (the default) renders °C and mm", () => {
    const markup = renderToStaticMarkup(<DayWeather weather={READING} labels={labels} />);
    expect(markup).toContain("0° – 20°C");
    expect(markup).toContain("25.4 mm");
    expect(markup).not.toContain("°F");
  });

  test("imperial renders °F and in — the field a person can set now changes what they see", () => {
    const markup = renderToStaticMarkup(
      <DayWeather weather={READING} labels={labels} units="imperial" />,
    );
    expect(markup).toContain("32° – 68°F");
    expect(markup).toContain("1.0 in");
    expect(markup).not.toContain("°C");
    expect(markup).not.toContain(" mm");
  });
});
