import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import { OPENFREEMAP_GLYPHS, OPENFREEMAP_TILEJSON } from "./openFreeMap";

/**
 * The Paper look (B2535, `paperFlavor.ts`) drawn from OpenMapTiles-schema
 * tiles — FERN-6, OpenFreeMap instead of this instance's own Protomaps
 * PMTiles. Same colours as the Protomaps flavour, same rules: no POI icons and
 * no peak labels, no sprite at all, one name per label in the reader's
 * language. One source covers the whole planet z0–14, so there is no world
 * underlay and no region switching: the ground is never grey anywhere.
 *
 * Layer names and fields: https://openmaptiles.org/schema/ (`water`,
 * `waterway`, `landcover`, `park`, `building`, `transportation`,
 * `transportation_name`, `boundary`, `water_name`, `place`).
 */

type Palette = {
  earth: string;
  water: string;
  park: string;
  wood: string;
  glacier: string;
  sand: string;
  buildings: string;
  casing: string;
  minor: string;
  major: string;
  highway: string;
  path: string;
  rail: string;
  boundaries: string;
  label: string;
  labelHalo: string;
  waterLabel: string;
};

/** Light: `PAPER_LIGHT` plus the `@protomaps/basemaps` LIGHT values it keeps. */
const LIGHT: Palette = {
  earth: "#f7f0de",
  water: "#cdebf2",
  park: "#cfddd5",
  wood: "#c4dcc4",
  glacier: "#fbfaf6",
  sand: "#e8e4d0",
  buildings: "#cccccc",
  casing: "#dccfb2",
  minor: "#ffffff",
  major: "#ffffff",
  highway: "#ffffff",
  path: "#cdbf9f",
  rail: "#a7b1b3",
  boundaries: "#b7a584",
  label: "#8d8271",
  labelHalo: "#f7f0de",
  waterLabel: "#728dd4",
};

/** Dark: `PAPER_DARK` plus the `@protomaps/basemaps` DARK values it keeps. */
const DARK: Palette = {
  earth: "#1b2635",
  water: "#0e2231",
  park: "#1c2421",
  wood: "#1d2a2c",
  glacier: "#24303f",
  sand: "#212123",
  buildings: "#111111",
  casing: "#1f1f1f",
  minor: "#2c3a52",
  major: "#33425c",
  highway: "#33425c",
  path: "#2c3a52",
  rail: "#000000",
  boundaries: "#5b6374",
  label: "#c3c8d2",
  labelHalo: "#1b2635",
  waterLabel: "#717784",
};

const SOURCE = "openmaptiles";
const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];
const ITALIC = ["Noto Sans Italic"];

/** Road classes, OpenMapTiles `transportation.class`. */
const HIGHWAY = ["motorway", "trunk"];
const MAJOR = ["primary", "secondary", "tertiary"];
const MINOR = ["minor", "service"];
const PATH = ["path", "track"];

const inClass = (classes: string[]): ExpressionSpecification => [
  "match",
  ["get", "class"],
  classes,
  true,
  false,
];

/** Width in px by zoom, exponential like the Protomaps flavour's roads. */
const width = (stops: [number, number][], plus = 0): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.6], ["zoom"], ...stops.flatMap(([z, w]) => [z, w + plus])] as ExpressionSpecification;

/** One name per label: the reader's language, then English, then local. */
const name = (lang: string): ExpressionSpecification => [
  "coalesce",
  ["get", `name:${lang}`],
  ["get", "name:en"],
  ["get", "name"],
];

function roadLayers(p: Palette): LayerSpecification[] {
  const lineBase = (id: string, classes: string[], minzoom: number) => ({
    id,
    type: "line" as const,
    source: SOURCE,
    "source-layer": "transportation",
    minzoom,
    filter: ["all", ["==", ["geometry-type"], "LineString"], inClass(classes)] as ExpressionSpecification,
    layout: { "line-cap": "round" as const, "line-join": "round" as const },
  });
  const MINOR_W: [number, number][] = [[12, 0.5], [14, 2], [18, 14]];
  const MAJOR_W: [number, number][] = [[7, 0.5], [12, 1.6], [14, 4], [18, 20]];
  const HIGHWAY_W: [number, number][] = [[5, 0.6], [10, 1.6], [14, 5], [18, 24]];
  const minorW = width(MINOR_W);
  const majorW = width(MAJOR_W);
  const highwayW = width(HIGHWAY_W);
  // A casing is its road plus one pixel, at every stop.
  const casing = (stops: [number, number][]) => width(stops, 1);
  return [
    {
      ...lineBase("roads_path", PATH, 14),
      paint: { "line-color": p.path, "line-width": width([[14, 0.6], [18, 2]]), "line-dasharray": [2, 1.5] },
    },
    { ...lineBase("roads_minor_casing", MINOR, 13), paint: { "line-color": p.casing, "line-width": casing(MINOR_W) } },
    { ...lineBase("roads_major_casing", MAJOR, 10), paint: { "line-color": p.casing, "line-width": casing(MAJOR_W) } },
    { ...lineBase("roads_highway_casing", HIGHWAY, 9), paint: { "line-color": p.casing, "line-width": casing(HIGHWAY_W) } },
    { ...lineBase("roads_minor", MINOR, 12), paint: { "line-color": p.minor, "line-width": minorW } },
    { ...lineBase("roads_major", MAJOR, 7), paint: { "line-color": p.major, "line-width": majorW } },
    { ...lineBase("roads_highway", HIGHWAY, 5), paint: { "line-color": p.highway, "line-width": highwayW } },
    {
      id: "roads_rail",
      type: "line",
      source: SOURCE,
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["all", inClass(["rail"]), ["!=", ["get", "brunnel"], "tunnel"]],
      paint: { "line-color": p.rail, "line-width": width([[11, 0.5], [18, 2]]), "line-dasharray": [3, 2] },
    },
  ];
}

function labelLayers(p: Palette, lang: string): LayerSpecification[] {
  const text = name(lang);
  const halo = { "text-halo-color": p.labelHalo, "text-halo-width": 1.5 };
  return [
    {
      id: "water_label",
      type: "symbol",
      source: SOURCE,
      "source-layer": "water_name",
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": text,
        "text-font": ITALIC,
        "text-size": ["match", ["get", "class"], ["ocean"], 14, ["sea"], 12, 11],
        "text-max-width": 6,
      },
      paint: { "text-color": p.waterLabel, ...halo },
    },
    {
      id: "roads_labels",
      type: "symbol",
      source: SOURCE,
      "source-layer": "transportation_name",
      minzoom: 13,
      filter: inClass([...HIGHWAY, ...MAJOR, ...MINOR]),
      layout: {
        "symbol-placement": "line",
        "text-field": text,
        "text-font": REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 13],
      },
      paint: { "text-color": p.label, ...halo },
    },
    {
      id: "places_subplace",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      minzoom: 12,
      filter: inClass(["suburb", "quarter", "neighbourhood", "hamlet"]),
      layout: { "text-field": text, "text-font": REGULAR, "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.08 },
      paint: { "text-color": p.label, ...halo },
    },
    {
      id: "places_region",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      minzoom: 4,
      maxzoom: 8,
      filter: inClass(["state", "province"]),
      layout: { "text-field": text, "text-font": REGULAR, "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.1 },
      paint: { "text-color": p.label, ...halo },
    },
    // Cities from far out, towns from region scale, villages only near street
    // level — the Protomaps flavour's density, not every hamlet at z9.
    ...([
      ["places_city", ["city"], 3, BOLD, [[4, 11], [12, 18]]],
      ["places_town", ["town"], 8, REGULAR, [[8, 11], [12, 14]]],
      ["places_village", ["village"], 11, REGULAR, [[11, 11], [14, 13]]],
    ] as const).map(
      ([id, classes, minzoom, font, sizes]): LayerSpecification => ({
        id,
        type: "symbol",
        source: SOURCE,
        "source-layer": "place",
        minzoom,
        filter: inClass([...classes]),
        layout: {
          "text-field": text,
          "text-font": [...font],
          "text-size": ["interpolate", ["linear"], ["zoom"], ...sizes.flat()] as ExpressionSpecification,
          "text-max-width": 8,
          "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
        },
        paint: { "text-color": p.label, ...halo },
      }),
    ),
    {
      id: "places_country",
      type: "symbol",
      source: SOURCE,
      "source-layer": "place",
      maxzoom: 7,
      filter: inClass(["country"]),
      layout: {
        "text-field": text,
        "text-font": BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 14],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.1,
        "text-max-width": 7,
      },
      paint: { "text-color": p.label, ...halo },
    },
  ];
}

export function paperOpenMapTilesStyle(scheme: "light" | "dark", lang: string): StyleSpecification {
  const p = scheme === "dark" ? DARK : LIGHT;
  const primary = lang.split("-")[0];
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      [SOURCE]: {
        type: "vector",
        url: OPENFREEMAP_TILEJSON,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ' +
          '<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a> ' +
          '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.earth } },
      {
        id: "landcover_wood",
        type: "fill",
        source: SOURCE,
        "source-layer": "landcover",
        filter: inClass(["wood", "forest"]),
        paint: { "fill-color": p.wood, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.9] },
      },
      {
        id: "landcover_ice",
        type: "fill",
        source: SOURCE,
        "source-layer": "landcover",
        filter: inClass(["ice"]),
        paint: { "fill-color": p.glacier },
      },
      {
        id: "landcover_sand",
        type: "fill",
        source: SOURCE,
        "source-layer": "landcover",
        filter: inClass(["sand"]),
        paint: { "fill-color": p.sand },
      },
      {
        id: "landuse_park",
        type: "fill",
        source: SOURCE,
        "source-layer": "park",
        paint: { "fill-color": p.park, "fill-opacity": 0.7 },
      },
      {
        id: "water",
        type: "fill",
        source: SOURCE,
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": p.water },
      },
      {
        id: "water_river",
        type: "line",
        source: SOURCE,
        "source-layer": "waterway",
        minzoom: 8,
        filter: ["all", inClass(["river", "canal"]), ["!=", ["get", "brunnel"], "tunnel"]],
        paint: { "line-color": p.water, "line-width": width([[8, 0.5], [14, 3], [18, 10]]) },
      },
      {
        id: "water_stream",
        type: "line",
        source: SOURCE,
        "source-layer": "waterway",
        minzoom: 13,
        filter: ["all", inClass(["stream"]), ["!=", ["get", "brunnel"], "tunnel"]],
        paint: { "line-color": p.water, "line-width": width([[13, 0.5], [18, 3]]) },
      },
      {
        id: "buildings",
        type: "fill",
        source: SOURCE,
        "source-layer": "building",
        minzoom: 14,
        paint: { "fill-color": p.buildings, "fill-opacity": 0.5 },
      },
      ...roadLayers(p),
      {
        id: "boundaries",
        type: "line",
        source: SOURCE,
        "source-layer": "boundary",
        minzoom: 5,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.boundaries, "line-width": 0.5, "line-opacity": 0.6, "line-dasharray": [3, 2] },
      },
      {
        id: "boundaries_country",
        type: "line",
        source: SOURCE,
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": p.boundaries, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 10, 1.5] },
      },
      ...labelLayers(p, primary),
    ],
  };
}
