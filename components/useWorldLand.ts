"use client";

import { useEffect, useState } from "react";

/**
 * The baked world outline, fetched only when a map is actually on screen.
 *
 * `lib/worldLand.json` is 62 KB of simplified coastline, imported statically
 * by four different client components. A static import puts it in whatever
 * bundle those components land in and renders all of it into the server HTML —
 * so a reader paid for the whole world before they had seen a word of the
 * trip, on every route that so much as links to a map.
 *
 * As a dynamic `import()` it becomes its own chunk, requested after the page
 * is interactive and shared by every map on the site (the promise is cached
 * here, so a page with two maps fetches once). Until it lands, maps draw the
 * sea, the route and the pins — everything that carries meaning — and the
 * coastlines fade in behind them.
 */

let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function load(): Promise<string[]> {
  inflight ??= import("@/lib/worldLand.json").then((mod) => {
    cached = mod.default as string[];
    return cached;
  });
  return inflight;
}

/** The outline's SVG path data, or an empty list until it arrives. */
export function useWorldLand(): string[] {
  const [paths, setPaths] = useState<string[]>(() => cached ?? []);

  useEffect(() => {
    let alive = true;
    // `load()` hands back the same promise every time, already resolved once
    // the outline is in memory — so a second map on the page costs nothing.
    load()
      .then((data) => {
        if (alive) setPaths(data);
      })
      .catch((err: unknown) => {
        // A map without coastlines still shows the route and the pins, which
        // is the part that carries the meaning. Not worth failing the page.
        console.warn("[map] world outline could not be loaded", err);
      });
    return () => {
      alive = false;
    };
  }, []);

  return paths;
}
