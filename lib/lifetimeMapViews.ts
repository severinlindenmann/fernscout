import { frameRoute, type Frame, type Point } from "./mapFrame";
import { basemapFor, type Basemap } from "./basemap";
import { CONTINENT_KEY, SUBREGION_KEY } from "./mapRegions";
import type { TranslationKey } from "./i18n";

/**
 * The continent-switch views for the lifetime map (`components/LifetimeMap.tsx`)
 * — B2491, decisions 2–4. Computed **on the server**, once per request,
 * because a frame and its basemap are exactly what `app/at/[user]/trips/page.tsx`
 * already builds for the whole-journal map; a client-side continent switch
 * would need this file's own copy of `frameRoute`/`basemapFor` and the
 * country-shape data they read, none of which ships to the browser today
 * (see the block comment on `CountryVisit.path` in `LifetimeMap.tsx`).
 */

/** ~10% padding, not `frameRoute`'s 35% default — decision 2: "Alle" and
 * every continent/area view are the tight frame, not the wide one every
 * other map on the site wants. */
const VIEW_PAD_FRACTION = 0.1;
/** "about 6°" — decision under "Framing". */
const VIEW_MIN_SPAN_DEG = 6;
/** A continent or area button is a continent-scale ask: one country there,
 * framed on a single city's stops, would otherwise fill the box with one
 * stretch of coastline (B2652). Still framed on real stops, never on the
 * country's whole outline. */
const REGION_VIEW_MIN_SPAN_DEG = 25;

export type LifetimeView = {
  /** "all", a continent's English name, or `${continent}\u0000${subregion}`. */
  id: string;
  kind: "all" | "continent" | "area";
  /** Translation key for the button label, or undefined for "Alle" (its own
   * fixed string, `trips.map.all`). */
  labelKey?: TranslationKey;
  /** English name, for matching a visited country against this view. */
  continent?: string;
  subregion?: string;
  countryCodes: string[];
  frame: Frame;
  basemap: Basemap | null;
};

export type ContinentButton = {
  continent: string;
  labelKey: TranslationKey;
  count: number;
  areas: { subregion: string; labelKey: TranslationKey; count: number }[];
};

/** One visited country, as much as this module needs of it. */
export type VisitedCountry = {
  code: string;
  continent: string;
  subregion: string;
};

function framePointsFor(
  codes: readonly string[],
  pointsByCode: ReadonlyMap<string, Point[]>,
  cornersByCode: ReadonlyMap<string, Point[]>,
): Point[] {
  return codes.flatMap((code) => {
    const real = pointsByCode.get(code);
    // Real stops win over the country's own outline whenever any readable
    // trip actually reached this country — "for large countries, frame on
    // the real stops" (Framing). A teaser-only country has no real stops at
    // all (B600: it contributes no coordinates), so it always falls back to
    // its main landmass's own corners.
    return real && real.length > 0 ? real : (cornersByCode.get(code) ?? []);
  });
}

/**
 * Every selectable view (Alle, each continent with ≥2 visited countries,
 * each area of a continent whose visited countries span ≥2 areas), each
 * framed on its own countries' real stops or main-landmass corners, and
 * the continent/area button lists to draw above the map.
 */
export function buildLifetimeViews(
  visited: readonly VisitedCountry[],
  pointsByCode: ReadonlyMap<string, Point[]>,
  cornersByCode: ReadonlyMap<string, Point[]>,
): { views: LifetimeView[]; continents: ContinentButton[] } {
  const frameFor = (codes: readonly string[], minSpanDeg = VIEW_MIN_SPAN_DEG): Frame =>
    frameRoute(framePointsFor(codes, pointsByCode, cornersByCode), {
      padFraction: VIEW_PAD_FRACTION,
      minSpanDeg,
    });

  const allCodes = visited.map((v) => v.code);
  const views: LifetimeView[] = [
    { id: "all", kind: "all", countryCodes: allCodes, frame: frameFor(allCodes), basemap: null },
  ];

  const byContinent = new Map<string, VisitedCountry[]>();
  for (const v of visited) {
    if (!v.continent) continue;
    const list = byContinent.get(v.continent) ?? [];
    list.push(v);
    byContinent.set(v.continent, list);
  }

  // Decision 3: continent buttons show only when visited countries span ≥ 2
  // continents at all — a one-continent journal gets none, "Alle" only.
  const showContinents = byContinent.size >= 2;

  const continents: ContinentButton[] = [];
  for (const [continent, countries] of byContinent) {
    const codes = countries.map((c) => c.code);
    const labelKey = CONTINENT_KEY[continent];
    if (showContinents && labelKey) {
      views.push({
        id: continent,
        kind: "continent",
        labelKey,
        continent,
        countryCodes: codes,
        frame: frameFor(codes, REGION_VIEW_MIN_SPAN_DEG),
        basemap: null,
      });
    }

    const bySubregion = new Map<string, VisitedCountry[]>();
    for (const c of countries) {
      const list = bySubregion.get(c.subregion) ?? [];
      list.push(c);
      bySubregion.set(c.subregion, list);
    }
    // Decision 4: area buttons only when this continent's own visited
    // countries span ≥ 2 areas.
    const areas =
      bySubregion.size >= 2
        ? [...bySubregion]
            .map(([subregion, list]) => ({
              subregion,
              labelKey: SUBREGION_KEY[subregion],
              count: list.length,
            }))
            .filter((a): a is { subregion: string; labelKey: TranslationKey; count: number } => Boolean(a.labelKey))
            .sort((a, b) => b.count - a.count)
        : [];

    if (areas.length >= 2) {
      for (const [subregion, list] of bySubregion) {
        const labelKey = SUBREGION_KEY[subregion];
        if (!labelKey) continue;
        const areaCodes = list.map((c) => c.code);
        views.push({
          id: `${continent}\u0000${subregion}`,
          kind: "area",
          labelKey,
          continent,
          subregion,
          countryCodes: areaCodes,
          frame: frameFor(areaCodes, REGION_VIEW_MIN_SPAN_DEG),
          basemap: null,
        });
      }
    }

    if (labelKey) continents.push({ continent, labelKey, count: codes.length, areas });
  }

  // Sorted by country count, most-visited first — decision 3.
  continents.sort((a, b) => b.count - a.count);

  /**
   * Only "Alle" carries its basemap inline. Measured on a real 30-trip
   * journal, all ten views' basemaps inline came to 1.7 MB (one view alone
   * — Northern Europe — was 428 KB), far past the ~300 KB the brief set as
   * the line for inlining every view. Every other view's `frame` still ships
   * (five numbers; the continent/area buttons and the client-side glide need
   * it before anything is fetched) — only its basemap is `null` until
   * `LifetimeMap.tsx` fetches it from `/api/lifetime-map-view` the first
   * time that view is selected, swapping it in at the end of the glide.
   */
  const basemapped = views.map((v) => ({ ...v, basemap: v.id === "all" ? basemapFor(v.frame) : null }));
  return { views: basemapped, continents };
}
