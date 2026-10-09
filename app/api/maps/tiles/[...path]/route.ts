import { isEnabled } from "@/lib/capabilities";
import { resolveMapsFile } from "@/lib/maps/dir";
import { tilesFor } from "@/lib/maps/tiles";

/**
 * `/api/maps/tiles/<file>.pmtiles/{z}/{x}/{y}` — one vector tile, looked up
 * on the server — B2601. A plain 200 the browser and the iPhone app's web
 * view both cache, where the file read through Range requests was never
 * cached at all. The `v` the TileJSON (`../tilejson`) puts in every tile URL
 * is the file's mtime, so a URL's tile never changes and may be kept a year;
 * a request without it (or with an old one) is cached an hour only.
 */
export const dynamic = "force-dynamic";

const DIGITS = /^\d{1,8}$/;

export async function GET(request: Request, { params }: RouteContext<"/api/maps/tiles/[...path]">) {
  if (!isEnabled("streetMaps")) return new Response("Not found", { status: 404 });
  const { path: segments } = await params;
  const [z, x, y] = segments.slice(-3);
  if (segments.length < 4 || ![z, x, y].every((s) => DIGITS.test(s))) {
    return new Response("Not found", { status: 404 });
  }
  // pmtiles throws for x or y >= 2^z, and for z above 26.
  if (Number(z) > 26 || Number(x) >= 2 ** Number(z) || Number(y) >= 2 ** Number(z)) return new Response("Not found", { status: 404 });
  const file = resolveMapsFile(segments.slice(0, -3));
  if (!file) return new Response("Not found", { status: 404 });

  const { mtimeMs, tiles } = tilesFor(file);
  const current = new URL(request.url).searchParams.get("v") === String(Math.floor(mtimeMs));
  const cacheControl = current ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  const tile = await tiles.getZxy(Number(z), Number(x), Number(y));
  // No tile here (open sea, outside a region file): an empty answer MapLibre
  // draws as nothing, cached like any other.
  if (!tile) return new Response(null, { status: 204, headers: { "Cache-Control": cacheControl } });
  return new Response(tile.data, {
    headers: { "Content-Type": "application/x-protobuf", "Cache-Control": cacheControl },
  });
}
