/**
 * Country name → ISO 3166-1 alpha-2, for the flag beside a place name.
 *
 * The table is generated from the GeoNames country list already committed for
 * ingest — see scripts/build-country-codes.mjs. It replaced 44 names picked by
 * hand as "places we're likely to pass through", which is the right list for
 * one person's trip and the wrong one for software anybody can host: it had no
 * United States, Canada or United Kingdom, so a journal across America showed
 * no flags at all unless every entry spelled out `countryCode`. The
 * documentation has always said the code is looked up from the country.
 */

import { COUNTRY_CODES } from "./countryCodes";

/** Turns an alpha-2 code into its regional-indicator flag emoji. */
export function flagFromCode(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

/**
 * The one spelling the table is keyed by.
 *
 * Must stay identical to `normalise` in scripts/build-country-codes.mjs.
 * GeoNames writes "The Netherlands" and "Côte d'Ivoire"; people write
 * "Netherlands" and "Cote d'Ivoire". Folding accents, straightening
 * apostrophes and dropping a leading "the" makes those the same key.
 */
function normalise(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function countryCodeFor(country: string, explicit?: string): string | undefined {
  if (explicit) return explicit.toUpperCase();
  return COUNTRY_CODES[normalise(country)];
}

/** Flag emoji for a country name (empty string when we don't know it). */
export function flagFor(country: string, explicit?: string): string {
  const code = countryCodeFor(country, explicit);
  return code ? flagFromCode(code) : "";
}
