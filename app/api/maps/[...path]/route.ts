import fs from "node:fs";
import { Readable } from "node:stream";
import { isEnabled } from "@/lib/capabilities";
import { resolveMapsFile } from "@/lib/maps/dir";
import { parseRange } from "@/lib/mediaRange";

/**
 * Serves Protomaps PMTiles files from `MAPS_DIR` — B2535.
 *
 * Only reachable when `features.streetMaps` is on: `isEnabled` already folds
 * in the readable-world-file check (lib/capabilities.ts), so this route
 * cannot be on while that file is missing. Off (or a missing/unsafe path) is
 * a plain 404 either way, same as `app/at/[user]/media/[...path]/route.ts`
 * refuses a photo nobody may see — nothing here distinguishes "capability
 * off" from "no such file" for a caller.
 *
 * The PMTiles protocol (`pmtiles` npm package, used client-side in
 * components/map/StreetMap.tsx) reads a file entirely through HTTP Range
 * requests — a handful of bytes for the header, then a directory lookup, then
 * one small slice per tile — so Range support here is not an optimisation,
 * it is the only way this file is ever read.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/maps/[...path]">) {
  if (!isEnabled("streetMaps")) return new Response("Not found", { status: 404 });

  const { path: segments } = await params;
  const file = resolveMapsFile(segments);
  if (!file) return new Response("Not found", { status: 404 });

  const stat = fs.statSync(file);
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Accept-Ranges": "bytes",
    // Long-ish and revalidatable rather than immutable: a trip's region file
    // can be regenerated under the same name by a re-run of `maps:trip`.
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  };

  const range = parseRange(request.headers.get("range"), stat.size);
  if (range === "invalid") {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${stat.size}` },
    });
  }
  if (range) {
    const body = Readable.toWeb(
      fs.createReadStream(file, { start: range.start, end: range.end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
      },
    });
  }

  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: { ...headers, "Content-Length": String(stat.size) },
  });
}
