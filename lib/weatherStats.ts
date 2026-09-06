/**
 * A trip's weather, added up — B557.
 *
 * Pure on purpose, the same discipline as lib/weather.ts: no fs, no
 * `server-only`, no network. Both the page and its test drive this module
 * over plain arrays, so a summary can be checked without a content tree.
 *
 * The rule it inherits from lib/weather.ts is the one that shapes every field
 * here: **a reading is nothing without its provenance.** A summary is a
 * sentence about somebody's trip in the site's own voice, so it says how many
 * days it actually had a reading for, and it carries every source it drew
 * from so the page can credit them. Averaging forty days over the twelve that
 * were measured, and printing the result as though it were the trip, is the
 * one thing this must not do.
 */

import { hasMeasurement, weatherGroup, type DayWeather, type WeatherGroup } from "./weather";
import type { Day } from "./types";

/** One day as this module needs it — a date, a place, and maybe a reading. */
export type WeatherDay = {
  date: string;
  location: string;
  weather?: DayWeather;
};

/** A day singled out for being the most something. */
export type WeatherExtreme = {
  date: string;
  location: string;
  value: number;
};

/** One day's numbers, for the charts. */
export type WeatherPoint = {
  date: string;
  tempMin?: number;
  tempMax?: number;
  precipitation?: number;
};

export type WeatherSummary = {
  /** Days in the trip that carry a reading. */
  measured: number;
  /**
   * Days that do not.
   *
   * Printed on the page rather than quietly divided away. A trip with three
   * readings and thirty-seven blanks must not present an average as its
   * weather.
   */
  missing: number;
  /**
   * How many days fell in each group, most days first. A reading whose code
   * we cannot place — or which has no code at all — is counted in `ungrouped`
   * rather than guessed into the nearest group.
   */
  byGroup: { group: WeatherGroup; days: number }[];
  ungrouped: number;
  /** Mean of the daily maxima and minima, over the days that report them. */
  avgHigh?: number;
  avgLow?: number;
  warmest?: WeatherExtreme;
  coldest?: WeatherExtreme;
  /** Total mm, over the days that report precipitation at all. */
  precipitation: number;
  /** Days reporting more than nothing. */
  wetDays: number;
  /** Days reporting precipitation, wet or dry — the denominator for `wetDays`. */
  precipitationDays: number;
  wettest?: WeatherExtreme;
  windiest?: WeatherExtreme;
  /** Every day of the trip in order, so a gap in the line is a real gap. */
  byDay: WeatherPoint[];
  /**
   * Every distinct source, in the order first seen. The page credits all of
   * them: a trip that mixes the archive's readings with one a person took
   * themselves has two provenances and printing one would misattribute the
   * other.
   */
  sources: string[];
};

/** The day's reading — the lead entry's, or the first of the day that has one. */
export function weatherOf(day: Day): DayWeather | undefined {
  return day.lead.weather ?? day.entries.find((e) => e.weather)?.weather;
}

/** `Day[]` off disk reduced to what this module reads. */
export function weatherDays(days: Day[]): WeatherDay[] {
  return days.map((d) => ({
    date: d.date,
    location: d.lead.location,
    weather: weatherOf(d),
  }));
}

/** Whether there is anything here to summarise at all. */
export function hasWeather(days: WeatherDay[]): boolean {
  return days.some((d) => d.weather && hasMeasurement(d.weather));
}

/** Mean, rounded the way it is shown — a journal is not a weather station. */
function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/**
 * Keep the extreme, preferring the earlier day on a tie.
 *
 * Deliberate: two days at 34° should name the first one every time this is
 * computed, so the page does not change what it says between two renders of
 * the same trip.
 */
function keep(
  current: WeatherExtreme | undefined,
  candidate: WeatherExtreme,
  better: (a: number, b: number) => boolean,
): WeatherExtreme {
  if (!current) return candidate;
  return better(candidate.value, current.value) ? candidate : current;
}

export function summariseWeather(days: WeatherDay[]): WeatherSummary {
  const groups = new Map<WeatherGroup, number>();
  const highs: number[] = [];
  const lows: number[] = [];
  const sources: string[] = [];
  const byDay: WeatherPoint[] = [];

  let measured = 0;
  let ungrouped = 0;
  let precipitation = 0;
  let wetDays = 0;
  let precipitationDays = 0;
  let warmest: WeatherExtreme | undefined;
  let coldest: WeatherExtreme | undefined;
  let wettest: WeatherExtreme | undefined;
  let windiest: WeatherExtreme | undefined;

  // Sorted here rather than trusted from the caller: `byDay` is drawn as a
  // line, and a line over unordered dates is a scribble.
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));

  for (const day of ordered) {
    const w = day.weather;
    // A day with no reading still gets a point, with nothing in it. That is
    // what puts the gap in the chart instead of closing it.
    byDay.push({
      date: day.date,
      tempMin: w?.tempMin,
      tempMax: w?.tempMax,
      precipitation: w?.precipitation,
    });
    if (!w || !hasMeasurement(w)) continue;

    measured += 1;
    if (!sources.includes(w.source)) sources.push(w.source);

    const group = weatherGroup(w.code);
    if (group) groups.set(group, (groups.get(group) ?? 0) + 1);
    else ungrouped += 1;

    const where = { date: day.date, location: day.location };
    if (w.tempMax !== undefined) {
      highs.push(w.tempMax);
      warmest = keep(warmest, { ...where, value: w.tempMax }, (a, b) => a > b);
    }
    if (w.tempMin !== undefined) {
      lows.push(w.tempMin);
      coldest = keep(coldest, { ...where, value: w.tempMin }, (a, b) => a < b);
    }
    if (w.precipitation !== undefined) {
      precipitationDays += 1;
      precipitation += w.precipitation;
      if (w.precipitation > 0) wetDays += 1;
      wettest = keep(wettest, { ...where, value: w.precipitation }, (a, b) => a > b);
    }
    if (w.windMax !== undefined) {
      windiest = keep(windiest, { ...where, value: w.windMax }, (a, b) => a > b);
    }
  }

  return {
    measured,
    missing: ordered.length - measured,
    byGroup: [...groups.entries()]
      .map(([group, count]) => ({ group, days: count }))
      // Most days first, and alphabetically within a tie so the order is the
      // same on every render.
      .sort((a, b) => b.days - a.days || a.group.localeCompare(b.group)),
    ungrouped,
    avgHigh: mean(highs),
    avgLow: mean(lows),
    warmest,
    coldest,
    precipitation: Math.round(precipitation * 10) / 10,
    wetDays,
    precipitationDays,
    // A trip where nothing was ever measured has no wettest day; one where it
    // was measured and was always dry does, and it is 0 mm.
    wettest,
    windiest,
    byDay,
    sources,
  };
}
