/**
 * The half of B325 that talks to Open-Meteo.
 *
 * Split from lib/weather.ts so that everything *about* a reading — its shape,
 * its provenance rules, which glyph a WMO code draws — stays pure and shared,
 * and the network lives in one file you can read in a minute to see every
 * request this software makes about the weather.
 *
 * No API key, by choice. Every optional capability here is off by default and
 * has to be *absent rather than broken* when disabled, and one that needs no
 * secret is one a self-hoster can actually turn on. See
 * docs/plans/2026-09-06-day-weather.md for the licence and the attribution.
 */
import type { DayWeather } from "./weather";
import { hasMeasurement } from "./weather";

/**
 * Overridable for the same reason `ECB_RATES_URL` is in
 * scripts/update-rates.mjs: not everyone can reach a third party, and a test
 * that checks this software sends the right request and reads the answer back
 * correctly should not need the open internet to do it.
 */
const ARCHIVE_URL = process.env.OPEN_METEO_ARCHIVE_URL || "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = process.env.OPEN_METEO_FORECAST_URL || "https://api.open-meteo.com/v1/forecast";

/** The columns asked for, in the order the response returns them. */
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max";

/**
 * How recent a day has to be to go to the forecast endpoint instead of the
 * archive.
 *
 * The archive is reanalysis and lags real time by around five days; the
 * forecast endpoint serves roughly the last 92 days, today included. Seven is
 * the archive's lag with room in it — this is a routing hint, not a
 * correctness boundary, because both endpoints answer the same shape and a
 * day in the overlap gets a good answer from either.
 */
const RECENT_DAYS = 7;

/**
 * A day's weather, or undefined.
 *
 * Undefined for every failure — a refusal, a timeout, a day the provider has
 * no data for, an answer in a shape we did not expect. **Every caller of this
 * treats a missing answer as "not yet", never as an error worth failing a
 * write over**: a person's day is saved either way, and the refresh script
 * comes back for it.
 */
export async function fetchDayWeather(
  lat: number,
  lng: number,
  date: string,
  options?: { signal?: AbortSignal; now?: Date },
): Promise<DayWeather | undefined> {
  const now = options?.now ?? new Date();
  const ageDays = (now.getTime() - Date.parse(`${date}T12:00:00Z`)) / 86_400_000;
  // A day in the future has no weather yet, and asking the archive for one
  // wastes a request to be told so.
  if (!Number.isFinite(ageDays) || ageDays < 0) return undefined;

  const base = ageDays <= RECENT_DAYS ? FORECAST_URL : ARCHIVE_URL;
  const url = new URL(base);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("daily", DAILY);
  url.searchParams.set("timezone", "auto");

  let body: unknown;
  try {
    const response = await fetch(url, {
      signal: options?.signal ?? AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    body = await response.json();
  } catch {
    return undefined;
  }

  const daily = (body as { daily?: Record<string, unknown[]> } | null)?.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time[0] !== date) return undefined;

  const at = (key: string): number | undefined => {
    const value = Array.isArray(daily[key]) ? daily[key][0] : undefined;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };

  const reading: DayWeather = {
    code: at("weather_code"),
    tempMax: at("temperature_2m_max"),
    tempMin: at("temperature_2m_min"),
    precipitation: at("precipitation_sum"),
    windMax: at("wind_speed_10m_max"),
    source: "open-meteo",
    recordedAt: now.toISOString(),
  };

  // The provider answers 200 with a row of nulls for a coordinate it has no
  // data for. That is "not yet", not a reading.
  return hasMeasurement(reading) ? reading : undefined;
}
