import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import { isEnabled } from "../capabilities";
import { basemapForRoute, type Basemap } from "../basemap";
import { tripMapRegions } from "../maps/dir";
import { frameRoute, place, type Frame, type Point } from "../mapFrame";
import { cardPalette, type CardPalette } from "./cardPalette";
import { buildTripFrame, linesForDay, placesForDay, type Chip, type MapLine, type MapPlace, type TripFrame } from "./tripFrame";
import { streetLayersForBbox, type StreetLayers } from "./streetTiles";
import { readCachedCardSvg, writeCachedCardSvg } from "./cardCache";

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
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
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
    streetLayers(user, tripId, svgFrame, width),
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
    street,
    basemap,
    lines,
    places: dayPlaces,
    chips: day === undefined ? tripFrame.chips : [],
    selectedDay: day,
    palette: cardPalette(scheme),
  });
  writeCachedCardSvg(key, svg);
  return { svg, usedStreet: street !== null };
}

async function streetLayers(user: string, tripId: string, frame: Frame, width: number): Promise<StreetLayers | null> {
  if (!isEnabled("streetMaps", user)) return null;
  const region = tripMapRegions(user, tripId)?.[0];
  if (!region) return null;
  try {
    return await streetLayersForBbox(regionAbsolutePath(region.file), region.bbox, frame, width);
  } catch {
    return null;
  }
}

function placesToPoints(places: readonly MapPlace[]): Point[] {
  return places.map((p) => ({ lat: p.lat, lng: p.lng }));
}

/** ~24px across at `UI_WIDTH` — prototype-reader.html's `.stop .n`. */
const DAY_RADIUS = 12;
/** ~30px across — the same prototype's `.stop.sel .n`. */
const DAY_RADIUS_SELECTED = 15;

function renderSvg(opts: {
  frame: Frame;
  width: number;
  street: StreetLayers | null;
  basemap: Basemap | null;
  lines: readonly MapLine[];
  places: readonly MapPlace[];
  chips: readonly Chip[];
  selectedDay?: number;
  palette: CardPalette;
}): string {
  const { frame, width, street, basemap, lines, places, chips, selectedDay, palette } = opts;
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
      parts.push(`<g fill="none" stroke="${palette.roadCasing}" stroke-width="${px(2.4)}" stroke-linecap="round">`);
      for (const d of street.roads) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
      parts.push(`<g fill="none" stroke="${palette.road}" stroke-width="${px(1.1)}" stroke-linecap="round">`);
      for (const d of street.roads) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
    }
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
        parts.push(`<path d="${d}" stroke="#fff" stroke-width="${px(5)}" opacity="${opacity}"/>`);
        parts.push(`<path d="${d}" stroke="${palette.selectedFill}" stroke-width="${px(3)}" opacity="${opacity}"/>`);
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

  // Day-number markers — prototype-reader.html's own "card"/"daycard" style:
  // white disc, a navy ring, the number in navy; only the *selected* day
  // (a day card's own place) is the bigger, filled-navy/white-number
  // version — on the trip overview (`selectedDay` unset) every marker is
  // the plain one, none of them a false "selection". ~24px across at a
  // 390px render, per `UI_WIDTH`.
  for (const p of places) {
    const [x, y] = place(frame, p);
    const isSelected = selectedDay !== undefined && p.day === selectedDay;
    const r = isSelected ? DAY_RADIUS_SELECTED : DAY_RADIUS;
    const fill = isSelected ? palette.accentNavy : "#fff";
    const ring = isSelected ? "#fff" : palette.accentNavy;
    const textFill = isSelected ? "#fff" : palette.accentNavy;
    parts.push(
      `<g>` +
        `<circle cx="${x}" cy="${y}" r="${px(r)}" fill="${fill}" stroke="${ring}" stroke-width="${px(2.5)}"/>` +
        `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${px(11)}" font-weight="700" fill="${textFill}">${p.day}</text>` +
        `</g>`,
    );
  }

  // Town-level place labels, next to their marker, with a light halo so they
  // read over any layer underneath — collision-avoided: a place that would
  // overlap an already-placed label is simply left unlabelled, tried in
  // priority order (the selected day first, on a day card; trip order,
  // which is day order, otherwise) so "the selected/first day wins" a tie.
  {
    const priority = selectedDay === undefined ? places : [...places].sort((a, b) => (a.day === selectedDay ? -1 : b.day === selectedDay ? 1 : 0));
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const labelH = px(13);
    const gapX = px(DAY_RADIUS + 4);
    for (const p of priority) {
      if (!p.name) continue;
      const [mx, my] = place(frame, p);
      const label = esc(p.name);
      const w = label.length * px(6.2);
      const x0 = mx + gapX;
      const x1 = x0 + w;
      const y0 = my - labelH / 2;
      const y1 = my + labelH / 2;
      const collides = placed.some((b) => x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0);
      if (collides) continue;
      placed.push({ x0, x1, y0, y1 });
      parts.push(
        `<text x="${x0}" y="${my}" dominant-baseline="central" font-size="${px(11.5)}" font-weight="600" ` +
          `fill="${palette.labelTown}" stroke="${palette.labelStopHalo}" stroke-width="${px(3)}" paint-order="stroke">${label}</text>`,
      );
    }
  }

  // Chips — a row along the top edge, evenly spaced in bearing order.
  // ponytail: spaced evenly rather than exactly at each bearing's own
  // position along the edge; the rule only requires "never over a place",
  // which even spacing already satisfies. Upgrade to true bearing-mapped x
  // if a design review wants the chips visually pointing more precisely.
  if (chips.length > 0) {
    const sorted = [...chips].sort((a, b) => a.bearingDeg - b.bearingDeg);
    const margin = frame.w * 0.08;
    const usable = frame.w - margin * 2;
    sorted.forEach((chip, i) => {
      const x = frame.x + margin + (usable * (i + 0.5)) / sorted.length;
      const y = frame.y + px(14);
      const label = esc(chip.label + (chip.days ? ` +${chip.days}` : ""));
      const w = Math.max(px(24), label.length * px(6.5));
      parts.push(
        `<g>` +
          `<rect x="${x - w / 2}" y="${y - px(10)}" width="${w}" height="${px(20)}" rx="${px(10)}" fill="${palette.legChipFill}" stroke="${palette.legChipBorder}" stroke-width="${px(1)}"/>` +
          `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${px(9.5)}" fill="${palette.legChipIcon}">${label}</text>` +
          `</g>`,
      );
    });
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function pathFor(line: MapLine, frame: Frame): string | null {
  if (line.coords.length < 2) return null;
  const pts = line.coords.map((p) => place(frame, p));
  return `M${pts.map(([x, y]) => `${x} ${y}`).join("L")}`;
}
