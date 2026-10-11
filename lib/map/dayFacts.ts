import { haversineKm } from "./dayTransition";
import { SOURCE_CREDIT, temperature, weatherGroup, type DayWeather, type WeatherGroup } from "../weather";
import type { Units } from "../units";

/**
 * B-2980 — the small facts a day card states before it is read: counts, the
 * recorded distance, the stored weather and the day's spend. Pure, so the
 * wording rules (nothing absent is invented, a source always travels with a
 * reading) can be run and argued with.
 */

/** Kilometres along recorded runs; 0 when nothing was recorded. */
export function recordedKm(runs: readonly (readonly [number, number][])[]): number {
  let km = 0;
  for (const run of runs) {
    for (let i = 1; i < run.length; i++) {
      km += haversineKm({ lat: run[i - 1][0], lng: run[i - 1][1] }, { lat: run[i][0], lng: run[i][1] });
    }
  }
  return km;
}

/** "12 km" — whole kilometres from 10 up, one decimal below; nothing under 100 m. */
export function formatKm(km: number): string | null {
  if (!Number.isFinite(km) || km < 0.1) return null;
  return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km`;
}

const GLYPH: Record<WeatherGroup, string> = {
  clear: "☀",
  partly: "⛅",
  cloudy: "☁",
  fog: "≋",
  rain: "☔",
  snow: "❄",
  thunder: "⚡",
};

export type WeatherFact = {
  group?: WeatherGroup;
  glyph?: string;
  /** "12 – 19°C" — what is stored, in the journal's units. */
  temp?: string;
  /** The credited source exactly as the day page words it. */
  source: string;
};

/** The stored reading as a fact, or null when it carries nothing to say. */
export function weatherFact(w: DayWeather | undefined, units: Units = "metric"): WeatherFact | null {
  if (!w) return null;
  const group = weatherGroup(w.code);
  const temp = temperature(w, units);
  if (!group && temp === undefined) return null;
  return {
    group,
    glyph: group ? GLYPH[group] : undefined,
    temp,
    source: SOURCE_CREDIT[w.source]?.label ?? w.source,
  };
}

/** A day's own spend and the trip's, as display text; null when there is no figure at all. */
export function budgetFact(
  day: number | undefined,
  trip: number | undefined,
  money: (n: number) => string,
): { day?: string; trip?: string } | null {
  const d = day !== undefined && day > 0 ? money(day) : undefined;
  const t = trip !== undefined && trip > 0 ? money(trip) : undefined;
  return d || t ? { day: d, trip: t } : null;
}
