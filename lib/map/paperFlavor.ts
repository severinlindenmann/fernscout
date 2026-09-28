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

/** `MAPS_DIR/world.pmtiles` (z0–6), served the same way a trip's own region
 * file is (`lib/maps/dir.ts`'s `mapsFileUrl` builds the same `/api/maps/...`
 * shape) — the one file `features.streetMaps` already requires to exist. */
const WORLD_URL = "/api/maps/world.pmtiles";

/** The world source's own layer ids this style keeps as an underlay — B2560:
 * "nothing is ever grey" needs ground and water drawn everywhere, even
 * outside a trip's own region file(s), zoomed in past the world file's own
 * z6 (overzoom is fine — coarse ground is still ground, not grey). Every
 * other id `layers()` would draw for this source (roads, buildings, labels)
 * is left out: the world file was extracted at z0–6 and has none of that
 * detail anyway. */
const WORLD_LAYER_IDS = new Set(["background", "earth", "water", "boundaries_country", "boundaries"]);

/**
 * A MapLibre style with a trip's own region file layered over a world
 * underlay, in the Paper flavour, with labels in `lang` only (a BCP-47
 * primary subtag — `layers()` itself only wants the two-ish letter code, so
 * a fuller locale like `en-US` is trimmed).
 *
 * The world source's layers are drawn first (so the region source's own
 * roads/labels sit on top of them) and their ids are suffixed `-world` —
 * `layers()` reuses the same ids for any source it's asked to draw, and two
 * layers can't share an id in one style. The region source's own
 * `background`/`earth`/`water`/`boundaries*` layers are dropped instead of
 * duplicated: the world underlay already draws them for the whole visible
 * area, including the parts a trip's own file doesn't cover.
 *
 * Glyphs come from `/api/maps/fonts/{fontstack}/{range}.pbf`
 * (`app/api/maps/fonts/[stack]/[range]/route.ts`), never the baked
 * `public/fonts/` URL directly — that route already falls back to
 * `public/fonts/` for whatever range an operator hasn't downloaded, so this
 * one URL covers both. No `sprite` at all, since every icon this style might
 * have drawn is the one layer just dropped.
 */
/**
 * One name per label, in the reader's own language where the data has it,
 * then English, then the local name — never the local script as a second
 * line under it ("Labels in the reader's language only", the trip-maps plan).
 * Protomaps' own text-field adds that second line for non-Latin scripts.
 */
function oneLanguage<L extends { type: string; layout?: Record<string, unknown> }>(layer: L, lang: string): L {
  if (layer.type !== "symbol" || !layer.layout || !("text-field" in layer.layout)) return layer;
  return {
    ...layer,
    layout: {
      ...layer.layout,
      "text-field": ["coalesce", ["get", `name:${lang}`], ["get", "name:en"], ["get", "name"]],
    },
  };
}

export function paperStyle(
  pmtilesUrl: string,
  scheme: "light" | "dark",
  lang: string,
): StyleSpecification {
  const flavor = scheme === "dark" ? PAPER_DARK : PAPER_LIGHT;
  const opts = { lang: lang.split("-")[0] };
  const worldLayers = layers("world", flavor, opts)
    .filter((l) => WORLD_LAYER_IDS.has(l.id))
    .map((l) => ({ ...l, id: `${l.id}-world` }));
  const regionLayers = layers("protomaps", flavor, opts)
    .filter((l) => l.id !== POI_LAYER_ID && !WORLD_LAYER_IDS.has(l.id))
    .map((l) => oneLanguage(l, opts.lang));
  return {
    version: 8,
    glyphs: "/api/maps/fonts/{fontstack}/{range}.pbf",
    sources: {
      world: { type: "vector", url: `pmtiles://${WORLD_URL}` },
      protomaps: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      },
    },
    layers: [...worldLayers, ...regionLayers],
  };
}
