import { NextResponse } from "next/server";
import { basemapFor } from "@/lib/basemap";
import type { Frame } from "@/lib/mapFrame";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * The continent-switch lifetime map's on-demand basemap fetch — B2491.
 *
 * Every view's *frame* (five numbers) ships inline in the page — cheap, and
 * needed up front for the continent/area buttons to exist at all. Its
 * *basemap* (clipped borders/lakes/rivers, tens to hundreds of kilobytes
 * each) does not: measured on a real journal, all ten of a 30-trip
 * journal's views inline came to 1.7 MB, well past the ~300 KB the ticket's
 * brief set as the line. Only "Alle" is inlined; `LifetimeMap.tsx` fetches
 * every other view's basemap here, the first time it is selected, and swaps
 * it in at the end of the glide.
 *
 * **Unauthenticated and public on purpose**, the same call `isEnabled`-gated
 * routes like `/api/address-lookup` make for the same reason: a frame is
 * five numbers a client already holds (sent in every page's own props —
 * `lib/lifetimeMapViews.ts`'s `LifetimeView.frame`), and what this route
 * hands back for it is public geography (Natural Earth, clipped) — the same
 * borders every other map on this site already renders from a frame,
 * nothing about a reader, a journal or a trip. There is nothing here to gate
 * per-journal: the frame is the whole request.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const num = (key: string): number => Number(url.searchParams.get(key));
  const frame: Frame = {
    x: num("x"),
    y: num("y"),
    w: num("w"),
    h: num("h"),
    lngScale: num("lngScale"),
  };

  if (!Object.values(frame).every(Number.isFinite) || frame.w <= 0 || frame.h <= 0) {
    return NextResponse.json({ error: "invalid_frame" }, { status: 400 });
  }

  // Generous enough for every view of a large journal to be fetched in
  // quick succession as somebody clicks through continents, nowhere near
  // enough for a script sweeping the whole basemap bundle one frame at a
  // time.
  const limit = rateLimitFor("lifetime-map-view", clientIp(request), { max: 60, windowMs: 60 * 1000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const basemap = basemapFor(frame);
  return NextResponse.json(
    { basemap },
    // Public geography, deterministic per frame — safe for a shared cache,
    // and this is exactly the request pattern (many readers, few distinct
    // frames per journal) a cache actually pays for.
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
