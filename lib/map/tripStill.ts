import type { StreetMapFile } from "../maps/dir";
import { buildTripFrame, type MapPlace, type RecordedSegment } from "./tripFrame";

/** B-2980 — what the trip page hands its still map: exactly the places and
 * recorded line `card.svg` is drawn from for this reader, and the region file
 * the map page would open. Plain data, so it crosses to the browser. */
export type StillData = {
  places: MapPlace[];
  recorded: RecordedSegment[];
  file: StreetMapFile;
  /** Width over height of the SVG card's own box, so the swap shifts nothing. */
  aspect: number;
};

/** Which preview a card shows: the MapLibre still only once the browser has
 * proven WebGL (`null` = not asked yet, i.e. the server render) and the tiles
 * have not failed; the drawn SVG everywhere else. */
export function previewKind(still: StillData | null | undefined, webgl: boolean | null, failed: boolean): "still" | "svg" {
  return still && webgl === true && !failed ? "still" : "svg";
}

export function boundsFor(points: readonly { lat: number; lng: number }[]): [[number, number], [number, number]] {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = Math.max((maxLat - minLat) * 0.35, 0.03);
  const padLng = Math.max((maxLng - minLng) * 0.35, 0.03);
  // Clamped to what Web Mercator (and a globe's fit) can take — a padded
  // tour across continents otherwise runs past the poles (B2604).
  return [
    [Math.max(minLng - padLng, -180), Math.max(minLat - padLat, -85)],
    [Math.min(maxLng + padLng, 180), Math.min(maxLat + padLat, 85)],
  ];
}

/** The frame the map page opens on for the trip's main region: its places and
 * its recorded line. `null` with nothing to frame (the file's own box then). */
export function stillBounds(still: StillData) {
  const frame = buildTripFrame(still.places, still.recorded);
  const pts = [...frame.framePlaces, ...frame.lines.filter((l) => l.kind === "recorded").flatMap((l) => l.coords)];
  return pts.length > 0 ? boundsFor(pts) : still.file.bounds;
}
