import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import { isEnabled } from "../capabilities";
import { basemapForRoute, type Basemap } from "../basemap";
import { coveringRegion, tripMapRegions } from "../maps/dir";
import { frameRoute, place, type Frame, type Point } from "../mapFrame";
import { cardPalette, type CardPalette } from "./cardPalette";
import { buildTripFrame, linesForDay, placesForDay, type MapLine, type MapPlace, type TripFrame } from "./tripFrame";
import { streetLayersForBbox, type StreetLayers } from "./streetTiles";
import { readCachedCardSvg, writeCachedCardSvg } from "./cardCache";
import { unproject } from "../mapProjection.mjs";

/**
 * The server-rendered trip/day preview card — B2538.
 *
 * A pure SVG string, built once per distinct input+theme and cached to disk
 * (`lib/map/cardCache.ts`). Served as `image/svg+xml` from
 * `/@<user>/card.svg` (and the equivalent under `/trips/<id>`) and consumed
 * as an ordinary `<img src>` (`components/map/MapCard.tsx`) — not inlined —
 * so a day the pager fetches client-side gets a card too, not only a day a
 * `/day/<slug>` permalink happened to render on the server. Colours are
 * therefore **concrete hex** (`lib/map/cardPalette.ts`), one of two baked
 * per theme, rather than `var(--map-…)` tokens: an `<img>`'s SVG is a
 * separate document with no access to the parent page's cascade. No text is
 * drawn beyond day numbers and place names, both locale-independent, so the
 * cache is never split by locale — only by theme.
 */

const TRIP_WIDTH = 800;
const DAY_WIDTH = 480;

/** See the note where `renderAndCache` passes this to `renderSvg`. */
const UI_WIDTH = 390;

export type Scheme = "light" | "dark";

export type CardResult = {
  svg: string;
  /** Whether the street-tile source was actually used — the caller shows
   * "Map data © OpenStreetMap" only then; the Natural Earth fallback has its
   * own, separate attribution nobody claims OSM for. */
  usedStreet: boolean;
};

/**
 * The trip-wide card — the route at a glance, every day numbered.
 */
export async function tripCardSvg(
  user: string,
  tripId: string,
  places: readonly MapPlace[],
  recorded: Parameters<typeof buildTripFrame>[1],
  scheme: Scheme,
): Promise<CardResult | null> {
  if (places.length === 0) return null;
  const frame = buildTripFrame(places, recorded);
  const svgFrame = frameRoute(frame.framePlaces);
  const key = cacheKey("trip", user, tripId, places, recorded, streetInputsFor(user, tripId), scheme);
  return renderAndCache(key, svgFrame, frame, undefined, user, tripId, TRIP_WIDTH, scheme);
}

/**
 * One day's own card — that day's place and lines only, framed close, no
 * chips. Absent for a day with no place — the caller's cue to draw nothing,
 * same as `TripHero`'s own `hasRoute` (B1260: an empty field beats a
 * plausible-looking blank map).
 */
export async function dayCardSvg(
  user: string,
  tripId: string,
  places: readonly MapPlace[],
  recorded: Parameters<typeof buildTripFrame>[1],
  day: number,
  scheme: Scheme,
): Promise<CardResult | null> {
  const frame = buildTripFrame(places, recorded);
  const dayPlaces = placesForDay(frame, day);
  if (dayPlaces.length === 0) return null;
  const svgFrame = frameRoute(dayPlaces);
  const key = cacheKey("day", user, tripId, places, recorded, streetInputsFor(user, tripId), day, scheme);
  return renderAndCache(key, svgFrame, frame, day, user, tripId, DAY_WIDTH, scheme);
}

/**
 * Whether a card for this trip will actually reach for street tiles —
 * capability plus a region file, cheaply, with no PMTiles read at all. For
 * a caller that wants to know whether to show the OSM credit line without
 * paying for (or triggering) the full render — see `lib/map/tripCard.ts`'s
 * `*Meta` functions, which is the only thing that needs this without also
 * wanting the SVG.
 */
export function hasStreetRegion(user: string, tripId: string): boolean {
  return isEnabled("streetMaps", user) && (tripMapRegions(user, tripId)?.length ?? 0) > 0;
}

function streetInputsFor(user: string, tripId: string): string {
  if (!isEnabled("streetMaps", user)) return "off";
  const regions = tripMapRegions(user, tripId);
  if (!regions || regions.length === 0) return "none";
  // The file's own mtime, so a re-extracted region (`npm run maps:trip`)
  // invalidates the cache the same way a changed place or track does —
  // README: "invalidate automatically when they change".
  return regions
    .map((r) => {
      try {
        return `${r.file}:${fs.statSync(regionAbsolutePath(r.file)).mtimeMs}`;
      } catch {
        return r.file;
      }
    })
    .join(",");
}

function regionAbsolutePath(relFile: string): string {
  const dir = process.env.MAPS_DIR?.trim();
  return dir ? `${dir}/${relFile}` : relFile;
}

function cacheKey(...parts: unknown[]): string {
  // Rendering changes must invalidate SVGs already cached on disk. Bump the
  // tag (B2639: clustered discs, sans labels, no chips, thinner track) so an
  // old, cluttered card already on disk re-renders instead of serving stale.
  return crypto.createHash("sha256").update(JSON.stringify(["clustered-sans-v4", ...parts])).digest("hex").slice(0, 32);
}

async function renderAndCache(
  key: string,
  svgFrame: Frame,
  tripFrame: TripFrame,
  day: number | undefined,
  user: string,
  tripId: string,
  width: number,
  scheme: Scheme,
): Promise<CardResult> {
  const cached = readCachedCardSvg(key);
  if (cached !== null) {
    // The cached file itself carries no flag for "was street data used" —
    // it is redundant with a fact the caller already has (`isEnabled` plus
    // `tripMapRegions`), so `usedStreet` is recomputed cheaply rather than
    // encoded a second time in the filename.
    return { svg: cached, usedStreet: cached.includes("data-street=\"1\"") };
  }
  // Both, always — never one instead of the other. A trip's region file only
  // ever covers a padded box around its own places (`scripts/maps-trip.mts`),
  // so street tiles alone left the rest of the card blank; the Natural Earth
  // basemap (`lib/basemap.ts`, already computed for the whole world) is the
  // underlay everywhere, and street water/landuse/roads draw on top of it
  // wherever the file actually covers.
  const [street, basemap] = await Promise.all([
    streetLayers(user, tripId, svgFrame, width, day !== undefined ? placesForDay(tripFrame, day) : tripFrame.framePlaces),
    Promise.resolve(
      basemapForRoute(placesToPoints(day !== undefined ? placesForDay(tripFrame, day) : tripFrame.framePlaces)),
    ),
  ]);
  const lines = day !== undefined ? linesForDay(tripFrame, day) : tripFrame.lines;
  const dayPlaces = day !== undefined ? placesForDay(tripFrame, day) : tripFrame.framePlaces;
  const svg = renderSvg({
    frame: svgFrame,
    // UI chrome (markers, labels, chips, road strokes) is sized against a
    // phone-width reference, not the tile-fetch width above — the two used
    // to be the same constant, and a marker sized to read at 24px on an
    // 800px-wide design canvas came out under 12px once the card was shown
    // at an actual 390px phone width, since the whole SVG (viewBox and all)
    // scales down with the container. UI_WIDTH is what a marker/label is
    // actually legible-sized against; the wider TRIP_WIDTH/DAY_WIDTH keep
    // choosing more detail for a card that renders bigger on a desktop.
    width: UI_WIDTH,
    streetWidth: width,
    street,
    basemap,
    lines,
    places: dayPlaces,
    selectedDay: day,
    palette: cardPalette(scheme),
  });
  writeCachedCardSvg(key, svg);
  return { svg, usedStreet: street !== null };
}

async function streetLayers(
  user: string,
  tripId: string,
  frame: Frame,
  width: number,
  points: readonly { lat: number; lng: number }[],
): Promise<StreetLayers | null> {
  if (!isEnabled("streetMaps", user)) return null;
  // The file covering this card's own places (B2560) — never simply the first
  // listed, which for a trip that starts at home is the home region's file.
  const region = coveringRegion(user, tripId, points);
  if (!region) return null;
  // Tiles for what this card shows, not the whole region file: from the
  // region's own box, MAX_TILES ran out on its west edge before reaching a
  // day in the middle (world-trip-2025's Kyoto card drew no streets).
  const bbox = frameBboxWithin(frame, region.bbox);
  if (!bbox) return null;
  try {
    return await streetLayersForBbox(regionAbsolutePath(region.file), bbox, frame, width);
  } catch {
    return null;
  }
}

/** The frame's own lng/lat box, clipped to `within`; `null` when they do
 * not overlap. `frame.x` is in latitude-corrected units, hence `/ lngScale`. */
export function frameBboxWithin(
  frame: Frame,
  within: readonly [number, number, number, number],
): [number, number, number, number] | null {
  const nw = unproject(frame.x / frame.lngScale, frame.y);
  const se = unproject((frame.x + frame.w) / frame.lngScale, frame.y + frame.h);
  const west = Math.max(nw.lng, within[0]);
  const south = Math.max(se.lat, within[1]);
  const east = Math.min(se.lng, within[2]);
  const north = Math.min(nw.lat, within[3]);
  return west < east && south < north ? [west, south, east, north] : null;
}

function placesToPoints(places: readonly MapPlace[]): Point[] {
  return places.map((p) => ({ lat: p.lat, lng: p.lng }));
}

/** ~24px across at `UI_WIDTH` — prototype-reader.html's `.stop .n`. */
const DAY_RADIUS = 12;
/** ~30px across — the same prototype's `.stop.sel .n`. */
const DAY_RADIUS_SELECTED = 15;

/** B2639 — a real sans stack with system fallbacks, so a label or a day
 * number reads in the brand's own face rather than the serif an `<img>`'s
 * detached SVG document defaults to with no font-family of its own. The
 * attribute is single-quoted (valid SVG/XML) so "Segoe UI"'s own double
 * quotes survive. */
const FONT_ATTR = `font-family='Plus Jakarta Sans, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'`;

/** Labels past this many clamp to first/last plus the busiest stops —
 * "no more than ~4" (B2639). */
const MAX_LABELS = 4;

function renderSvg(opts: {
  frame: Frame;
  width: number;
  streetWidth: number;
  street: StreetLayers | null;
  basemap: Basemap | null;
  lines: readonly MapLine[];
  places: readonly MapPlace[];
  selectedDay?: number;
  palette: CardPalette;
}): string {
  const { frame, width, street, basemap, lines, places, selectedDay, palette } = opts;
  const px = (n: number) => (n * frame.w) / width;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}" data-street="${street ? "1" : "0"}" role="img" aria-hidden="true">`,
  );
  parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="${palette.sea}"/>`);

  // Underlay: the Natural Earth basemap, always — it is the only layer that
  // ever covers the whole frame (see the note at the call site). Drawn first
  // so a street region's own edge is never a visible seam onto a blank card.
  parts.push(`<g transform="scale(${frame.lngScale} 1)">`);
  if (basemap) {
    parts.push(`<g fill="${palette.land}" stroke="${palette.border}" stroke-width="1">`);
    for (const d of basemap.borders) parts.push(`<path d="${d}" vector-effect="non-scaling-stroke"/>`);
    parts.push(`</g>`);
    parts.push(`<g fill="${palette.water}" stroke="none">`);
    for (const d of basemap.lakes) parts.push(`<path d="${d}"/>`);
    parts.push(`</g>`);
    parts.push(`<g fill="none" stroke="${palette.water}" stroke-width="1.4" stroke-linecap="round">`);
    for (const d of basemap.rivers) parts.push(`<path d="${d}" vector-effect="non-scaling-stroke"/>`);
    parts.push(`</g>`);
  }
  parts.push(`</g>`);

  // Overlay: street tiles, only where the trip's own region file covers —
  // refining the Natural Earth ground underneath it, not replacing it.
  if (street) {
    const scale = frame.w / opts.streetWidth;
    parts.push(`<g transform="translate(${frame.x} ${frame.y}) scale(${scale})">`);
    if (street.landuse.length > 0) {
      parts.push(`<g fill="${palette.visited}" fill-opacity="0.35" fill-rule="evenodd">`);
      for (const d of street.landuse) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
    }
    if (street.water.length > 0) {
      parts.push(`<g fill="${palette.water}" fill-rule="evenodd">`);
      for (const d of street.water) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
    }
    if (street.roads.length > 0) {
      // One path, drawn twice (casing, then road) — B2565: written out twice
      // it was half of a city card's weight. Safe as an id: a card is only
      // ever shown as its own <img>, never inlined into a page.
      parts.push(`<defs><path id="roads" d="${street.roads.join("")}"/></defs>`);
      parts.push(`<use href="#roads" fill="none" stroke="${palette.roadCasing}" stroke-width="${px(2.4) / scale}" stroke-linecap="round"/>`);
      parts.push(`<use href="#roads" fill="none" stroke="${palette.road}" stroke-width="${px(1.1) / scale}" stroke-linecap="round"/>`);
    }
    parts.push(`</g>`);
  }

  // Overlay: B2534's own lines, drawn straight from the frame's own points —
  // no re-derivation of the hop/arc rules `components/map/RouteLine.tsx`
  // already owns, because `MapLine.coords` is already the full polyline
  // (`greatCircleArc` for a flight, the raw run for a recorded/gap line).
  if (lines.length > 0) {
    parts.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
    for (const line of lines) {
      const d = pathFor(line, frame);
      if (!d) continue;
      const selected = selectedDay === undefined || line.fromDay === selectedDay || line.toDay === selectedDay;
      const opacity = selected ? 1 : 0.35;
      if (line.kind === "recorded") {
        // B2639: thinner — a 5px/3px halo+line read as a thick ribbon at
        // card size; 3px/1.6px is still a clearly visible track.
        parts.push(`<path d="${d}" stroke="#fff" stroke-width="${px(3)}" opacity="${opacity}"/>`);
        parts.push(`<path d="${d}" stroke="${palette.selectedFill}" stroke-width="${px(1.6)}" opacity="${opacity}"/>`);
      } else if (line.kind === "gap") {
        parts.push(`<path d="${d}" stroke="${palette.plannedLeg}" stroke-width="${px(2)}" stroke-dasharray="${px(2)} ${px(3)}" opacity="${opacity}"/>`);
      } else if (line.kind === "photo-join") {
        parts.push(`<path d="${d}" stroke="${palette.plannedLeg}" stroke-width="${px(1.5)}" stroke-dasharray="${px(1.5)} ${px(3)}" opacity="${opacity}"/>`);
      } else {
        parts.push(`<path d="${d}" stroke="${palette.plannedLeg}" stroke-width="${px(1.5)}" stroke-dasharray="${px(1)} ${px(4)}" opacity="0.7"/>`);
      }
    }
    parts.push(`</g>`);
  }

  // Day markers — prototype-reader.html's own "card"/"daycard" style: white
  // disc, a navy ring, the number in navy; only the *selected* day (a day
  // card's own place) is the bigger, filled-navy/white-number version — on
  // the trip overview (`selectedDay` unset) every marker is the plain one,
  // none of them a false "selection". ~24px across at a 390px render, per
  // `UI_WIDTH`. B2639: two or more days whose markers would overlap (a
  // multi-day stay in one town) merge into a single pill showing the day
  // *count*, never a false range — `clusterMarkers` below.
  const clusters = clusterMarkers(frame, places, px(DAY_RADIUS * 2));
  for (const cluster of clusters) {
    const merged = cluster.days.length > 1;
    const isSelected = !merged && selectedDay !== undefined && cluster.days[0] === selectedDay;
    const r = isSelected ? DAY_RADIUS_SELECTED : DAY_RADIUS;
    const fill = isSelected ? palette.accentNavy : "#fff";
    const ring = isSelected ? "#fff" : palette.accentNavy;
    const textFill = isSelected ? "#fff" : palette.accentNavy;
    const label = merged ? String(cluster.days.length) : String(cluster.days[0]);
    const text = `<text x="${cluster.x}" y="${cluster.y}" text-anchor="middle" dominant-baseline="central" font-size="${px(11)}" font-weight="700" fill="${textFill}" ${FONT_ATTR}>${label}</text>`;
    if (!merged) {
      // A single day — the plain disc, unchanged.
      parts.push(
        `<g><circle cx="${cluster.x}" cy="${cluster.y}" r="${px(r)}" fill="${fill}" stroke="${ring}" stroke-width="${px(2.5)}"/>${text}</g>`,
      );
      continue;
    }
    // Two or more days whose markers would overlap merge into a pill with a
    // day count — never a false day range (B2639). A two-digit count widens
    // it rather than squeezing into a circle sized for one digit.
    const w = Math.max(px(r * 2), label.length * px(11) + px(10));
    parts.push(
      `<g>` +
        `<title>${esc(cluster.days.length + " days")}</title>` +
        `<rect x="${cluster.x - w / 2}" y="${cluster.y - px(r)}" width="${w}" height="${px(r * 2)}" rx="${px(r)}" fill="${palette.accentNavy}" stroke="#fff" stroke-width="${px(2.5)}"/>` +
        `<text x="${cluster.x}" y="${cluster.y}" text-anchor="middle" dominant-baseline="central" font-size="${px(11)}" font-weight="700" fill="#fff" ${FONT_ATTR}>${label}</text>` +
        `</g>`,
    );
  }

  // Town-level place labels, next to their marker, with a dark halo so they
  // read over any layer underneath — collision-avoided against both markers
  // and earlier labels, and never past the frame edge. At most `MAX_LABELS`:
  // the stay with the most days at each cluster, but the first and last day
  // of the trip are always candidates (never dropped for a merely busier
  // middle stop) — B2639. A day card (`selectedDay` set) only ever has the
  // one place `placesForDay` already filtered to, so this still reduces to
  // "label it" there.
  {
    const labelClusters = selectedDay === undefined ? labelPriority(clusters) : clusters;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [
      // Every marker is itself a no-go zone for a later label.
      ...clusters.map((c) => {
        const r = px(selectedDay !== undefined && c.days[0] === selectedDay ? DAY_RADIUS_SELECTED : DAY_RADIUS);
        return { x0: c.x - r, x1: c.x + r, y0: c.y - r, y1: c.y + r };
      }),
    ];
    const labelH = px(13);
    const gapX = px(DAY_RADIUS + 4);
    let shown = 0;
    for (const cluster of labelClusters) {
      if (shown >= MAX_LABELS) break;
      if (!cluster.name) continue;
      const label = esc(cluster.name);
      const w = label.length * px(6.2);
      const x0 = cluster.x + gapX;
      const x1 = x0 + w;
      const y0 = cluster.y - labelH / 2;
      const y1 = cluster.y + labelH / 2;
      const offFrame = x1 > frame.x + frame.w || x0 < frame.x || y0 < frame.y || y1 > frame.y + frame.h;
      if (offFrame) continue;
      const collides = placed.some((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0);
      if (collides) continue;
      placed.push({ x0, x1, y0, y1 });
      shown++;
      parts.push(
        `<text x="${x0}" y="${cluster.y}" dominant-baseline="central" font-size="${px(11.5)}" font-weight="600" ${FONT_ATTR} ` +
          `fill="${palette.labelTown}" stroke="${palette.labelStopHalo}" stroke-width="${px(3)}" paint-order="stroke">${label}</text>`,
      );
    }
  }

  // No region chips on this card (B2639) — the full map (`WorldMap.tsx`)
  // still draws `TripFrame.chips` itself; the preview reads cleaner without
  // a "Basel +1" tile that looked like a place count.

  parts.push(`</svg>`);
  return parts.join("");
}

/** One or more `MapPlace`s whose markers would overlap, merged into a
 * single point to draw — B2639. */
type MarkerCluster = {
  x: number;
  y: number;
  /** Every day in this cluster, sorted — `days[0]` is its earliest. */
  days: number[];
  /** The earliest day's own name, for the label — a merged pill's days are
   * (per `clusterMarkers`'s own doc) always the same stop. */
  name: string;
};

/** Single-linkage clustering on *pixel* distance (frame units at the card's
 * own `px()` scale): two day markers whose centres are closer than one
 * diameter apart would visually overlap, so B2639 merges them into one pill
 * showing the day count rather than letting them stack unreadably. Order
 * follows first appearance (trip/day order), same as `tripFrame.ts`'s own
 * `clusterRegions` — this is the same rule one zoom level in. */
function clusterMarkers(frame: Frame, places: readonly MapPlace[], diameter: number): MarkerCluster[] {
  const groups: { x: number; y: number; days: number[]; name: string }[][] = [];
  for (const p of places) {
    const [x, y] = place(frame, p);
    const item = { x, y, days: [p.day], name: p.name };
    const hit = groups.find((g) => g.some((o) => Math.hypot(o.x - x, o.y - y) < diameter));
    if (hit) hit.push(item);
    else groups.push([item]);
  }
  return groups.map((g) => ({
    x: g.reduce((s, i) => s + i.x, 0) / g.length,
    y: g.reduce((s, i) => s + i.y, 0) / g.length,
    days: g.flatMap((i) => i.days).sort((a, b) => a - b),
    name: g[0].name,
  }));
}

/** Label candidate order for a trip overview — "no more than ~4, by days
 * spent, plus first/last" (B2639). The cluster holding the trip's first day
 * and the one holding its last day are always candidates, ahead of a merely
 * busier middle stop; everything else follows by day count, most first. */
function labelPriority(clusters: readonly MarkerCluster[]): MarkerCluster[] {
  if (clusters.length <= 1) return [...clusters];
  const firstDay = Math.min(...clusters.flatMap((c) => c.days));
  const lastDay = Math.max(...clusters.flatMap((c) => c.days));
  const isFirst = (c: MarkerCluster) => c.days.includes(firstDay);
  const isLast = (c: MarkerCluster) => c.days.includes(lastDay);
  const forced = clusters.filter((c) => isFirst(c) || isLast(c));
  const rest = clusters.filter((c) => !isFirst(c) && !isLast(c)).sort((a, b) => b.days.length - a.days.length);
  return [...forced, ...rest];
}

function pathFor(line: MapLine, frame: Frame): string | null {
  if (line.coords.length < 2) return null;
  const pts = line.coords.map((p) => place(frame, p));
  return `M${pts.map(([x, y]) => `${x} ${y}`).join("L")}`;
}
