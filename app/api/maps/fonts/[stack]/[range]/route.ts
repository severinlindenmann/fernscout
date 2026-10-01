import fs from "node:fs";
import { isEnabled } from "@/lib/capabilities";
import { resolveFontFile } from "@/lib/maps/dir";

/**
 * Serves MapLibre glyph tiles for the street map's style (`lib/map/paperFlavor.ts`)
 * — B2560. `resolveFontFile` checks `MAPS_DIR/fonts/` first (an operator's own
 * full download, `npm run maps:world`), then this repo's own Latin-only
 * `public/fonts/`.
 *
 * A range nobody has downloaded (non-Latin scripts, before B2560 this simply
 * 404d — a Cyrillic or CJK place name lost those characters entirely rather
 * than falling back to an empty glyph) now answers with an empty, valid
 * `.pbf` instead: MapLibre draws no glyph for that range rather than
 * retrying or erroring. Gated on `streetMaps` the same way the sibling
 * pmtiles/worker routes are — nothing here is reachable unless that
 * capability is already on.
 */
const EMPTY_HEADERS = {
  "Content-Type": "application/x-protobuf",
  "Cache-Control": "public, max-age=86400",
};

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/maps/fonts/[stack]/[range]">,
) {
  if (!isEnabled("streetMaps")) return new Response("Not found", { status: 404 });

  const { stack, range } = await params;
  // The segment is the whole last part of `{range}.pbf` — B2642: passed on
  // with its suffix, no range ever matched and every label went blank.
  const file = resolveFontFile(decodeURIComponent(stack), range.replace(/\.pbf$/, ""));
  if (!file) return new Response(new Uint8Array(), { status: 200, headers: EMPTY_HEADERS });

  try {
    const body = fs.readFileSync(file);
    return new Response(new Uint8Array(body), {
      headers: { ...EMPTY_HEADERS, "Content-Length": String(body.byteLength) },
    });
  } catch {
    return new Response(new Uint8Array(), { status: 200, headers: EMPTY_HEADERS });
  }
}
