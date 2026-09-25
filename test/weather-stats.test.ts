import { describe, expect, test } from "vitest";
import { summariseWeather, hasWeather, type WeatherDay } from "@/lib/weatherStats";
import type { DayWeather } from "@/lib/weather";

/**
 * The trip-level weather summary — B557.
 *
 * The property under test is the one AGENTS.md makes non-negotiable and B325
 * built the whole feature around: **a reading is nothing without its
 * provenance, and a day with no reading is not a reading of zero.** Everything
 * here is a way of asking whether an average quietly spoke for days it had
 * nothing to say about.
 */

const reading = (w: Partial<DayWeather>): DayWeather => ({
  source: "open-meteo",
  recordedAt: "2026-04-02T06:00:00Z",
  ...w,
});

const day = (date: string, location: string, weather?: DayWeather): WeatherDay => ({
  date,
  location,
  weather,
});

describe("summariseWeather", () => {
  test("averages the days it has, and counts the ones it has not", () => {
    const summary = summariseWeather([
      day("2026-04-01", "Hoi An", reading({ tempMin: 20, tempMax: 30, code: 0 })),
      day("2026-04-02", "Hoi An"),
      day("2026-04-03", "Hue", reading({ tempMin: 22, tempMax: 26, code: 61 })),
    ]);

    expect(summary.measured).toBe(2);
    expect(summary.missing).toBe(1);
    // 30 and 26, not 30, 26 and an implied zero.
    expect(summary.avgHigh).toBe(28);
    expect(summary.avgLow).toBe(21);
    expect(summary.warmest).toEqual({ date: "2026-04-01", location: "Hoi An", value: 30 });
    expect(summary.coldest).toEqual({ date: "2026-04-01", location: "Hoi An", value: 20 });
  });

  test("the blank day is still a point, so the chart has a gap rather than a join", () => {
    const summary = summariseWeather([
      day("2026-04-01", "Hoi An", reading({ tempMax: 30 })),
      day("2026-04-02", "Hoi An"),
    ]);
    expect(summary.byDay).toHaveLength(2);
    expect(summary.byDay[1]).toEqual({
      date: "2026-04-02",
      tempMin: undefined,
      tempMax: undefined,
      precipitation: undefined,
    });
  });

  test("orders by date whatever order it was handed", () => {
    const summary = summariseWeather([
      day("2026-04-03", "Hue", reading({ tempMax: 26 })),
      day("2026-04-01", "Hoi An", reading({ tempMax: 30 })),
    ]);
    expect(summary.byDay.map((d) => d.date)).toEqual(["2026-04-01", "2026-04-03"]);
  });

  test("keeps every source, so a mixed trip credits both", () => {
    const summary = summariseWeather([
      day("2026-04-01", "Hoi An", reading({ tempMax: 30 })),
      day(
        "2026-04-02",
        "Hoi An",
        { source: "the thermometer on the balcony", recordedAt: "2026-04-02T15:00:00Z", tempMax: 33 },
      ),
    ]);
    expect(summary.sources).toEqual(["open-meteo", "the thermometer on the balcony"]);
  });

  test("a code it cannot place is counted, never guessed into a group", () => {
    const summary = summariseWeather([
      day("2026-04-01", "Hoi An", reading({ code: 0 })),
      day("2026-04-02", "Hoi An", reading({ code: 1234 })),
      // A reading with numbers and no code at all is the other way in.
      day("2026-04-03", "Hue", reading({ tempMax: 26 })),
    ]);
    expect(summary.byGroup).toEqual([{ group: "clear", days: 1 }]);
    expect(summary.ungrouped).toBe(2);
    expect(summary.measured).toBe(3);
  });

  test("a dry day is measured; a day with no reading is not", () => {
    const summary = summariseWeather([
      day("2026-04-01", "Hoi An", reading({ precipitation: 0 })),
      day("2026-04-02", "Hoi An", reading({ precipitation: 12.4 })),
      day("2026-04-03", "Hue"),
    ]);
    expect(summary.precipitationDays).toBe(2);
    expect(summary.wetDays).toBe(1);
    expect(summary.precipitation).toBe(12.4);
    expect(summary.wettest).toEqual({ date: "2026-04-02", location: "Hoi An", value: 12.4 });
  });

  test("a tie names the earlier day, on every render", () => {
    const summary = summariseWeather([
      day("2026-04-01", "Hoi An", reading({ tempMax: 34 })),
      day("2026-04-02", "Hue", reading({ tempMax: 34 })),
    ]);
    expect(summary.warmest?.date).toBe("2026-04-01");
  });

  test("a reading with provenance and no measurement says nothing", () => {
    const days = [day("2026-04-01", "Hoi An", reading({}))];
    expect(hasWeather(days)).toBe(false);
    const summary = summariseWeather(days);
    expect(summary.measured).toBe(0);
    expect(summary.missing).toBe(1);
    expect(summary.avgHigh).toBeUndefined();
    expect(summary.sources).toEqual([]);
  });

  test("a trip with nothing measured has no extremes at all", () => {
    const summary = summariseWeather([day("2026-04-01", "Hoi An")]);
    expect(summary.warmest).toBeUndefined();
    expect(summary.coldest).toBeUndefined();
    expect(summary.wettest).toBeUndefined();
    expect(summary.windiest).toBeUndefined();
    expect(summary.precipitation).toBe(0);
  });
});
