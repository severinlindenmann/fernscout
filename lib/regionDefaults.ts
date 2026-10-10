import { CURRENCY_FOR_COUNTRY } from "@/lib/countryCurrency";
import { COUNTRIES } from "@/lib/countries";
import { COUNTRY_FOR_TIME_ZONE } from "@/lib/timeZoneCountry";

/** The country of a proven number's digits (`41760000000`). `preferIso` (the
 * country the person picked in the field) settles a shared dial code; without
 * it a code shared by countries with different currencies (+1) names none. */
export function countryForTel(digits: string, preferIso?: string | null): string | null {
  const cc = [...new Set(COUNTRIES.map((c) => c.cc))].filter((c) => digits.startsWith(c)).sort((a, b) => b.length - a.length)[0];
  if (!cc) return null;
  const isos = COUNTRIES.filter((c) => c.cc === cc).map((c) => c.iso2);
  if (preferIso && isos.includes(preferIso)) return preferIso;
  return new Set(isos.map((i) => CURRENCY_FOR_COUNTRY[i])).size === 1 ? isos[0] : null;
}

export type CurrencySource = "phone" | "timeZone" | "language";

/**
 * B-2845. The journal currency from the best evidence, in order: the country
 * of the phone number verified in this signup, the device time zone's country,
 * the browser language's explicit region. A language alone is the weakest
 * (an iPhone in English (UK) sends en-GB for a Swiss owner). When the phone and
 * the time zone name different currencies, both come back so the caller can
 * ask; `currency` is the phone's.
 */
export function resolveCurrency(input: {
  phoneCountry?: string | null;
  timeZone?: string | null;
  languages: readonly string[];
}): { currency: string | null; source: CurrencySource | null; country: string | null; alternatives: string[] } {
  const phone = input.phoneCountry?.toUpperCase() ?? null;
  const zone = (input.timeZone && COUNTRY_FOR_TIME_ZONE[input.timeZone]) || null;
  const lang = browserRegion(input.languages);
  const phoneCur = (phone && CURRENCY_FOR_COUNTRY[phone]) || null;
  const zoneCur = (zone && CURRENCY_FOR_COUNTRY[zone]) || null;
  const langCur = (lang && CURRENCY_FOR_COUNTRY[lang]) || null;
  const alternatives = phoneCur && zoneCur && phoneCur !== zoneCur ? [phoneCur, zoneCur] : [];
  if (phoneCur) return { currency: phoneCur, source: "phone", country: phone, alternatives };
  if (zoneCur) return { currency: zoneCur, source: "timeZone", country: zone, alternatives: [] };
  if (langCur) return { currency: langCur, source: "language", country: lang, alternatives: [] };
  return { currency: null, source: null, country: null, alternatives: [] };
}

/**
 * B-2807. What the browser's own region says about currency and phone country.
 *
 * Reads the first `navigator.languages` tag that names a region *explicitly*
 * (`de-CH`). Never `Intl.Locale.maximize()`: that guesses en to US to USD,
 * which would pre-pick a permanent-looking field from a language alone. A
 * list with no regional tag yields nothing, and the caller asks.
 */
export function browserRegion(languages: readonly string[]): string | null {
  for (const tag of languages) {
    try {
      const region = new Intl.Locale(tag).region;
      if (region) return region.toUpperCase();
    } catch {
      // A malformed tag is simply not evidence.
    }
  }
  return null;
}

/** Currency (ISO 4217) and dialling code for the browser's region; each is
 * null when the region is absent or has no entry. */
export function regionDefaults(languages: readonly string[]): {
  region: string | null;
  currency: string | null;
  cc: string | null;
} {
  const region = browserRegion(languages);
  if (!region) return { region: null, currency: null, cc: null };
  return {
    region,
    currency: CURRENCY_FOR_COUNTRY[region] ?? null,
    cc: COUNTRIES.find((c) => c.iso2 === region)?.cc ?? null,
  };
}

/** The device's IANA time zone, "" where unreadable. Client-side only; read it
 * through `useSyncExternalStore` with a "" server snapshot. */
export const browserTimeZone = () =>
  typeof Intl === "undefined" ? "" : (Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");

/**
 * B-2974. Where a phone field opens, from the best evidence in order: the
 * device time zone's country, an explicit language region (en-GB alone is the
 * weakest: an iPhone in English (UK) sends it from Zurich), the instance's
 * configured dialling code (digits, no `+`), then Switzerland. Only a starting
 * value; the person can pick any country.
 */
export function phoneCountry(
  languages: readonly string[],
  timeZone?: string | null,
  configuredCc?: string | null,
): { iso2: string; cc: string } {
  const pick = (iso2: string | null | undefined) => {
    const cc = iso2 ? COUNTRIES.find((c) => c.iso2 === iso2)?.cc : undefined;
    return cc ? { iso2: iso2!, cc } : null;
  };
  const configured = configuredCc?.replace(/^\+/, "");
  const byCc = configured ? COUNTRIES.find((c) => c.cc === configured) : undefined;
  return (
    pick(timeZone ? COUNTRY_FOR_TIME_ZONE[timeZone] : null) ??
    pick(browserRegion(languages)) ??
    (byCc ? { iso2: byCc.iso2, cc: byCc.cc } : null) ??
    { iso2: "CH", cc: "41" }
  );
}
