import { isEnabled } from "@/lib/capabilities";
import { resolveMapsFile } from "@/lib/maps/dir";
import { tilesFor } from "@/lib/maps/tiles";

/**
 * `/api/maps/tilejson/<file>.pmtiles` — the TileJSON MapLibre reads before
 * any tile — B2601. Its `tiles` template points at `../tiles` and carries the
 * file's mtime as `v`, which is what lets every tile be cached for a year and
 * still change the day the monthly refresh (B2567) swaps the file. Cached
 * five minutes itself, so a refresh reaches readers that quickly.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/maps/tilejson/[...path]">) {
  if (!isEnabled("streetMaps")) return new Response("Not found", { status: 404 });
  const { path: segments } = await params;
  const file = resolveMapsFile(segments);
  if (!file) return new Response("Not found", { status: 404 });

  const { mtimeMs, tiles } = tilesFor(file);
  const header = await tiles.getHeader();
  const rel = segments.join("/");
  return Response.json(
    {
      tilejson: "3.0.0",
      scheme: "xyz",
      tiles: [`/api/maps/tiles/${rel}/{z}/{x}/{y}?v=${Math.floor(mtimeMs)}`],
      minzoom: header.minZoom,
      maxzoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
