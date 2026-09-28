import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "@/lib/capabilities";

/**
 * MapLibre's own web worker, served from our origin — B2535.
 *
 * maplibre-gl 6 starts its tile worker from an ES module file that the
 * bundler does not emit, so `StreetMap` points `setWorkerUrl` here. The worker
 * imports its sibling `maplibre-gl-shared.mjs` by a relative URL, which is why
 * both names are allowed and nothing else is. Absent, like the tile route,
 * whenever street maps are off.
 */
const FILES = new Set(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]);

export async function GET(_request: Request, { params }: RouteContext<"/api/maps/worker/[name]">) {
  if (!isEnabled("streetMaps")) return new Response("Not found", { status: 404 });
  const { name } = await params;
  if (!FILES.has(name)) return new Response("Not found", { status: 404 });
  const file = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", name);
  let body: Buffer;
  try {
    body = fs.readFileSync(file);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
