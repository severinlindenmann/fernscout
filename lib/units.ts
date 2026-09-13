/**
 * What a journal's `units` field actually changes — B1592.
 *
 * The field was made required on the journal document (B1587) on the
 * assumption it did something; it didn't. These are the conversions a reader
 * of an `imperial` journal sees instead of the metric figures every reading
 * is stored in — weather always arrives in °C, mm and km/h (`lib/weather.ts`,
 * `lib/weatherFetch.ts`), so the conversion happens here, at render time,
 * never at write time.
 */
export type Units = "metric" | "imperial";

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function mmToInches(mm: number): number {
  return mm / 25.4;
}

export function kmhToMph(kmh: number): number {
  return kmh / 1.609344;
}
