import { haversineKm } from "./dayTransition";
import { SOURCE_CREDIT, temperature, weatherGroup, type DayWeather, type WeatherGroup } from "../weather";
import type { Units } from "../units";
import type { MapDay } from "./mapDays";

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

/** Recorded kilometres per calendar date; a run with no date cannot be attributed and is left out. */
export function kmByDate(tracks: readonly { date?: string; points: [number, number][] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const tr of tracks) if (tr.date) out.set(tr.date, (out.get(tr.date) ?? 0) + recordedKm([tr.points]));
  return out;
}

/**
 * The day's spend as chip text. A day in one currency is `single` as it was; a day that mixed currencies
 * is the converted total marked "≈" and `converted`, and spend with no rate is listed as paid beside it
 * (or alone) — never added into a total. Null when there is no figure at all.
 */
export function daySpend(
  day: Pick<MapDay, "cost" | "costMixed" | "costUnconverted">,
  fmt: { money: (n: number) => string; original: (amount: number, currency: string) => string; single?: string },
): { text: string; converted: boolean } | null {
  const rest = (day.costUnconverted ?? []).map((u) => fmt.original(u.amount, u.currency));
  const total = day.cost !== undefined && day.cost > 0 ? day.cost : undefined;
  const base = total === undefined ? undefined : day.costMixed ? `≈ ${fmt.money(total).replace(/^≈\s*/, "")}` : (fmt.single ?? fmt.money(total));
  const text = [base, ...rest].filter(Boolean).join(" + ");
  return text ? { text, converted: Boolean(day.costMixed && base) } : null;
}
