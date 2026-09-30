/**
 * Warm the browser's own HTTP cache with a trip area's street tiles — B2603.
 *
 * Tiles are plain, year-long cacheable URLs since B2601, so fetching them
 * once while the map sits idle is all it takes for a later zoom into the
 * area to come from the cache: on the phone that is the web view's URL
 * cache, which iOS sizes and trims itself. Nothing is stored anywhere this
 * app manages.
 */
type Bounds = [[number, number], [number, number]];

/** At most this many tiles per map… */
const CAP = 150;
/** …and at most this much tile data (uncompressed; ~4 MB over the wire).
 * Measured on the Alps: a z10 tile is ~85 kB, a z8 one up to 465 kB, so the
 * tile count alone could have meant 10+ MB. */
const MAX_BYTES = 6_000_000;
/** The deepest zoom warmed; deeper street detail loads on demand. */
const MAX_ZOOM = 14;

function tileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function tileY(lat: number, z: number): number {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Tile URLs covering `bounds` at the two zoom levels past `fromZoom`,
 * shallow first, stopping at `CAP`. */
export function warmupUrls(template: string, bounds: Bounds, fromZoom: number): string[] {
  const [[west, south], [east, north]] = bounds;
  const urls: string[] = [];
  const start = Math.max(0, Math.floor(fromZoom) + 1);
  for (let z = start; z <= Math.min(start + 1, MAX_ZOOM); z++) {
    for (let x = tileX(west, z); x <= tileX(east, z); x++) {
      for (let y = tileY(north, z); y <= tileY(south, z); y++) {
        if (urls.length >= CAP) return urls;
        urls.push(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
      }
    }
  }
  return urls;
}

/** Fetch them one at a time, at low priority, never on Save-Data, and stop
 * at `MAX_BYTES`. */
export async function warmTiles(urls: readonly string[], signal: AbortSignal): Promise<void> {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  let bytes = 0;
  for (const url of urls) {
    if (signal.aborted || bytes >= MAX_BYTES) return;
    try {
      const res = await fetch(url, { signal, priority: "low" } as RequestInit);
      bytes += (await res.arrayBuffer()).byteLength;
    } catch {
      return;
    }
  }
}
