import type { TranslationKey } from "./i18n";

/**
 * Natural Earth's own `CONTINENT`/`SUBREGION` strings (baked into
 * `lib/worldCountries.json` by `scripts/build-world-countries.mts`), mapped
 * to the translation keys the continent/area buttons read — B2491, decision
 * 3/4.
 *
 * A plain object keyed by the English string rather than a slug function,
 * so a name Natural Earth doesn't carry here (Antarctica, "Seven seas (open
 * ocean)" — nobody's holiday, and neither ever gets a country filled by a
 * real trip) falls back to the English string itself rather than a runtime
 * lookup failure. `CONTINENT_KEY`/`SUBREGION_KEY` are the every actual
 * continent/subregion this map's countries carry.
 */
export const CONTINENT_KEY: Record<string, TranslationKey> = {
  Europe: "trips.map.continent.europe",
  Asia: "trips.map.continent.asia",
  Africa: "trips.map.continent.africa",
  "North America": "trips.map.continent.northAmerica",
  "South America": "trips.map.continent.southAmerica",
  Oceania: "trips.map.continent.oceania",
  Antarctica: "trips.map.continent.antarctica",
};

export const SUBREGION_KEY: Record<string, TranslationKey> = {
  "Northern Europe": "trips.map.subregion.northernEurope",
  "Western Europe": "trips.map.subregion.westernEurope",
  "Eastern Europe": "trips.map.subregion.easternEurope",
  "Southern Europe": "trips.map.subregion.southernEurope",
  "Eastern Asia": "trips.map.subregion.easternAsia",
  "South-Eastern Asia": "trips.map.subregion.southEasternAsia",
  "Southern Asia": "trips.map.subregion.southernAsia",
  "Central Asia": "trips.map.subregion.centralAsia",
  "Western Asia": "trips.map.subregion.westernAsia",
  "Northern Africa": "trips.map.subregion.northernAfrica",
  "Western Africa": "trips.map.subregion.westernAfrica",
  "Middle Africa": "trips.map.subregion.middleAfrica",
  "Eastern Africa": "trips.map.subregion.easternAfrica",
  "Southern Africa": "trips.map.subregion.southernAfrica",
  "Northern America": "trips.map.subregion.northernAmerica",
  "Central America": "trips.map.subregion.centralAmerica",
  Caribbean: "trips.map.subregion.caribbean",
  "South America": "trips.map.subregion.southAmericaRegion",
  "Australia and New Zealand": "trips.map.subregion.australiaNewZealand",
  Melanesia: "trips.map.subregion.melanesia",
  Micronesia: "trips.map.subregion.micronesia",
  Polynesia: "trips.map.subregion.polynesia",
  "Seven seas (open ocean)": "trips.map.subregion.sevenSeas",
};
