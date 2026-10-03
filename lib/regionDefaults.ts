import { CURRENCY_FOR_COUNTRY } from "@/lib/countryCurrency";
import { COUNTRIES } from "@/lib/countries";

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
