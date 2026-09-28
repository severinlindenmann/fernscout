import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import { isEnabled } from "../capabilities";
import { basemapForRoute, type Basemap } from "../basemap";
import { tripMapRegions } from "../maps/dir";
import { frameRoute, place, type Frame, type Point } from "../mapFrame";
import { mapAccent, mapStyle } from "./style";
import { buildTripFrame, linesForDay, placesForDay, type Chip, type MapLine, type MapPlace, type TripFrame } from "./tripFrame";
import { streetLayersForBbox, type StreetLayers } from "./streetTiles";
import { readCachedCardSvg, writeCachedCardSvg } from "./cardCache";
import type { TripAccent } from "../types";

/**
 * The server-rendered trip/day preview card — B2538.
 *
 * A pure SVG string, built once per distinct input and cached to disk
 * (`lib/map/cardCache.ts`) — never a `"use client"` component, never
 * maplibre-gl: `components/TripHero.tsx` and a day page both inline the
 * result with `dangerouslySetInnerHTML`, so no map library ever reaches
 * either page's bundle (see `test/bundle.test.ts`).
 *
 * Colours are `var(--map-…)` references (`lib/map/style.ts`), not baked
 * hex, so the one cached file already answers light and dark — the cascade
 * resolves it wherever it lands, exactly as an inline SVG element always
 * has on this site (`components/WorldMap.tsx`'s own baked paths do the
 * same). No text is drawn into the SVG at all — day numbers are the only
 * glyphs, and a digit reads the same in every language — so the cache is
 * locale-independent too; the facts line, credit and "Open map" link are
 * ordinary translated HTML the caller renders around it.
 */

const TRIP_WIDTH = 800;
const TRIP_HEIGHT = 460;
const DAY_WIDTH = 480;
const DAY_HEIGHT = 320;

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
): Promise<CardResult | null> {
  if (places.length === 0) return null;
  const frame = buildTripFrame(places, recorded);
  const svgFrame = frameRoute(frame.framePlaces);
  const key = cacheKey("trip", user, tripId, places, recorded, streetInputsFor(user, tripId));
  return renderAndCache(key, svgFrame, frame, undefined, user, tripId, TRIP_WIDTH, TRIP_HEIGHT);
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
): Promise<CardResult | null> {
  const frame = buildTripFrame(places, recorded);
  const dayPlaces = placesForDay(frame, day);
  if (dayPlaces.length === 0) return null;
  const svgFrame = frameRoute(dayPlaces);
  const key = cacheKey("day", user, tripId, places, recorded, streetInputsFor(user, tripId), day);
  return renderAndCache(key, svgFrame, frame, day, user, tripId, DAY_WIDTH, DAY_HEIGHT);
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
  height: number,
): Promise<CardResult> {
  const cached = readCachedCardSvg(key);
  if (cached !== null) {
    // The cached file itself carries no flag for "was street data used" —
    // it is redundant with a fact the caller already has (`isEnabled` plus
    // `tripMapRegions`), so `usedStreet` is recomputed cheaply rather than
    // encoded a second time in the filename.
    return { svg: cached, usedStreet: cached.includes("data-street=\"1\"") };
  }
  const street = await streetLayers(user, tripId, svgFrame, width);
  const basemap = street ? null : basemapForRoute(placesToPoints(day !== undefined ? placesForDay(tripFrame, day) : tripFrame.framePlaces));
  const lines = day !== undefined ? linesForDay(tripFrame, day) : tripFrame.lines;
  const dayPlaces = day !== undefined ? placesForDay(tripFrame, day) : tripFrame.framePlaces;
  const svg = renderSvg({
    frame: svgFrame,
    width,
    height,
    street,
    basemap,
    lines,
    places: dayPlaces,
    chips: day === undefined ? tripFrame.chips : [],
    selectedDay: day,
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

const DAY_RADIUS = 11;

function renderSvg(opts: {
  frame: Frame;
  width: number;
  height: number;
  street: StreetLayers | null;
  basemap: Basemap | null;
  lines: readonly MapLine[];
  places: readonly MapPlace[];
  chips: readonly Chip[];
  selectedDay?: number;
}): string {
  const { frame, width, street, basemap, lines, places, chips, selectedDay } = opts;
  const px = (n: number) => (n * frame.w) / width;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}" data-street="${street ? "1" : "0"}" role="img" aria-hidden="true">`,
  );
  parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="${mapStyle.sea}"/>`);

  if (street) {
    parts.push(`<g fill="${mapStyle.land}"><path d="M${frame.x} ${frame.y}h${frame.w}v${frame.h}h${-frame.w}Z"/></g>`);
    if (street.landuse.length > 0) {
      parts.push(`<g fill="${mapStyle.visited}" fill-opacity="0.35" fill-rule="evenodd">`);
      for (const d of street.landuse) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
    }
    if (street.water.length > 0) {
      parts.push(`<g fill="${mapStyle.water}" fill-rule="evenodd">`);
      for (const d of street.water) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
    }
    if (street.roads.length > 0) {
      parts.push(`<g fill="none" stroke="${mapStyle.roadCasing}" stroke-width="${px(2.4)}" stroke-linecap="round">`);
      for (const d of street.roads) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
      parts.push(`<g fill="none" stroke="${mapStyle.road}" stroke-width="${px(1.1)}" stroke-linecap="round">`);
      for (const d of street.roads) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
    }
  } else {
    parts.push(`<g transform="scale(${frame.lngScale} 1)">`);
    if (basemap) {
      parts.push(`<g fill="${mapStyle.land}" stroke="${mapStyle.border}" stroke-width="1">`);
      for (const d of basemap.borders) parts.push(`<path d="${d}" vector-effect="non-scaling-stroke"/>`);
      parts.push(`</g>`);
      parts.push(`<g fill="${mapStyle.water}" stroke="none">`);
      for (const d of basemap.lakes) parts.push(`<path d="${d}"/>`);
      parts.push(`</g>`);
      parts.push(`<g fill="none" stroke="${mapStyle.water}" stroke-width="1.4" stroke-linecap="round">`);
      for (const d of basemap.rivers) parts.push(`<path d="${d}" vector-effect="non-scaling-stroke"/>`);
      parts.push(`</g>`);
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
        parts.push(`<path d="${d}" stroke="#fff" stroke-width="${px(5)}" opacity="${opacity}"/>`);
        parts.push(`<path d="${d}" stroke="${mapStyle.selectedFill}" stroke-width="${px(3)}" opacity="${opacity}"/>`);
      } else if (line.kind === "gap") {
        parts.push(`<path d="${d}" stroke="${mapStyle.plannedLeg}" stroke-width="${px(2)}" stroke-dasharray="${px(2)} ${px(3)}" opacity="${opacity}"/>`);
      } else if (line.kind === "photo-join") {
        parts.push(`<path d="${d}" stroke="${mapStyle.plannedLeg}" stroke-width="${px(1.5)}" stroke-dasharray="${px(1.5)} ${px(3)}" opacity="${opacity}"/>`);
      } else {
        parts.push(`<path d="${d}" stroke="${mapStyle.plannedLeg}" stroke-width="${px(1.5)}" stroke-dasharray="${px(1)} ${px(4)}" opacity="0.7"/>`);
      }
    }
    parts.push(`</g>`);
  }

  // Day-number markers.
  for (const p of places) {
    const [x, y] = place(frame, p);
    const isSelected = selectedDay === undefined || p.day === selectedDay;
    const fill = isSelected ? mapAccent("navy") : mapStyle.clusterFill;
    parts.push(
      `<g opacity="${isSelected ? 1 : 0.5}">` +
        `<circle cx="${x}" cy="${y}" r="${px(DAY_RADIUS)}" fill="${fill}" stroke="#fff" stroke-width="${px(2)}"/>` +
        `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${px(11)}" font-weight="700" fill="#fff">${p.day}</text>` +
        `</g>`,
    );
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
          `<rect x="${x - w / 2}" y="${y - px(10)}" width="${w}" height="${px(20)}" rx="${px(10)}" fill="${mapStyle.legChipFill}" stroke="${mapStyle.legChipBorder}" stroke-width="${px(1)}"/>` +
          `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${px(9.5)}" fill="${mapStyle.legChipIcon}">${label}</text>` +
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
