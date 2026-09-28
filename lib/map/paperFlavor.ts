import { layers, LIGHT, DARK, type Flavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

/**
 * Fernscout's own recolouring of Protomaps' basemap — B2535, the visual spec
 * at https://claude.ai/artifact/3MuWAEmq5mAQBcFAzjBqCJ. Everything not named
 * there keeps `@protomaps/basemaps`'s own LIGHT/DARK value: this is a
 * flavour, not a redesign of the whole palette.
 */
const PAPER_LIGHT: Flavor = {
  ...LIGHT,
  earth: "#f7f0de",
  water: "#cdebf2",
  minor_casing: "#dccfb2",
  minor_service_casing: "#dccfb2",
  link_casing: "#dccfb2",
  major_casing_early: "#dccfb2",
  major_casing_late: "#dccfb2",
  highway_casing_early: "#dccfb2",
  highway_casing_late: "#dccfb2",
  bridges_other_casing: "#dccfb2",
  bridges_minor_casing: "#dccfb2",
  bridges_link_casing: "#dccfb2",
  bridges_major_casing: "#dccfb2",
  bridges_highway_casing: "#dccfb2",
  boundaries: "#b7a584",
  roads_label_minor: "#8d8271",
  roads_label_major: "#8d8271",
  ocean_label: "#8d8271",
  subplace_label: "#8d8271",
  city_label: "#8d8271",
  state_label: "#8d8271",
  country_label: "#8d8271",
  address_label: "#8d8271",
};

const PAPER_DARK: Flavor = {
  ...DARK,
  earth: "#1b2635",
  water: "#0e2231",
  minor_service: "#2c3a52",
  minor_a: "#2c3a52",
  minor_b: "#2c3a52",
  link: "#2c3a52",
  other: "#2c3a52",
  major: "#33425c",
  highway: "#33425c",
  bridges_minor: "#2c3a52",
  bridges_link: "#2c3a52",
  bridges_major: "#33425c",
  bridges_highway: "#33425c",
  roads_label_minor: "#c3c8d2",
  roads_label_major: "#c3c8d2",
  ocean_label: "#c3c8d2",
  subplace_label: "#c3c8d2",
  city_label: "#c3c8d2",
  state_label: "#c3c8d2",
  country_label: "#c3c8d2",
  address_label: "#c3c8d2",
};

/** The one icon+label layer `@protomaps/basemaps` draws — B2535 drops it
 * entirely: no POI icons, and since a mountain peak is a POI in this schema,
 * no peak labels either. */
const POI_LAYER_ID = "pois";

/**
 * A MapLibre style for one PMTiles source, in the Paper flavour, with labels
 * in `lang` only (a BCP-47 primary subtag — `layers()` itself only wants the
 * two-ish letter code, so a fuller locale like `en-US` is trimmed).
 *
 * Glyphs are the self-hosted files under `public/fonts/` (see
 * `components/map/StreetMap.tsx` for why they're there and how big); no
 * `sprite` at all, since every icon this style might have drawn is the one
 * layer just dropped.
 */
export function paperStyle(
  pmtilesUrl: string,
  scheme: "light" | "dark",
  lang: string,
): StyleSpecification {
  const flavor = scheme === "dark" ? PAPER_DARK : PAPER_LIGHT;
  const all = layers("protomaps", flavor, { lang: lang.split("-")[0] });
  return {
    version: 8,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      },
    },
    layers: all.filter((l) => l.id !== POI_LAYER_ID),
  };
}
