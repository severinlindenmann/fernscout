"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { PlaceView } from "./WorldMap";

/** The camera's zoom on one place — a town and its streets, not a district. */
const STOP_ZOOM = 11.5;
/** Where the globe opener starts: the whole Earth, turned a little away. */
const GLOBE_ZOOM = 1.4;
/** How long the opener waits for the globe's own tiles before turning. */
const GLOBE_WAIT_MS = 1200;

export type SlideStreetMapHandle = {
  /** Cut straight to a place (a new slide, or "start from here"). */
  jumpTo: (placeIndex: number) => void;
  /** One travel step: pull out and land on `toIndex` over `ms` (B2620). */
  flyTo: (fromIndex: number, toIndex: number, ms: number) => void;
  /** The globe opener: the whole Earth turning down onto `placeIndex`. */
  opener: (placeIndex: number, ms: number) => void;
};

type Props = {
  /** The trip's region file, `/api/maps/<file>.pmtiles` — the same one the
   * map page's own street map draws. */
  pmtilesUrl: string;
  places: PlaceView[];
  locale: string;
  /** Start on the globe rather than on the first place — the show is about
   * to play the opener, and world tiles are the quick ones to load. */
  startOnGlobe: boolean;
  /** Once the style has loaded and the route is drawn. Until then, and if it
   * never does, the show keeps its own SVG map. */
  onReady: () => void;
  /** No WebGL, a lost context, or MapLibre failing to start at all. */
  onFail: () => void;
};

const plottable = (p: PlaceView | undefined): p is PlaceView =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/**
 * The Diashow's street map — B2620. One MapLibre map for the whole show,
 * kept mounted behind the Highlights slides so the camera always knows where
 * it is: each slide cuts it to that day's place, a travel step flies it on to
 * the next, and the show can open on the globe. Not the map page's
 * `StreetMap`: nothing here is interactive, it is always the dark paper
 * style whatever the reader's theme, and it has no controls.
 *
 * The leg is drawn as a straight line between two places — a schematic, never
 * a claim about the road actually taken.
 */
const SlideStreetMap = forwardRef<SlideStreetMapHandle, Props>(function SlideStreetMap(
  { pmtilesUrl, places, locale, startOnGlobe, onReady, onFail },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const markersRef = useRef<MapLibreMarker[]>([]);
  // A camera asked for before the style loaded — applied once it has.
  const pendingRef = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onReady, onFail });
  callbacks.current = { onReady, onFail };
  const placesRef = useRef(places);
  placesRef.current = places;

  // The route up to `activeIndex` drawn bright, the rest faint, and the
  // active stop's own marker picked out with its name.
  const highlight = (activeIndex: number) => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const ps = placesRef.current;
    const coords = (from: number, to: number) =>
      ps.slice(from, to + 1).filter(plottable).map((p) => [p.lng, p.lat]);
    (map.getSource("slide-route-done") as GeoJSONSource | undefined)?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords(0, activeIndex) },
    });
    markersRef.current.forEach((mk, i) => {
      const el = mk.getElement();
      const active = i === activeIndex;
      el.style.opacity = i <= activeIndex ? "1" : "0.45";
      el.style.zIndex = active ? "2" : "1";
      const disc = el.firstElementChild as HTMLElement | null;
      if (disc) {
        disc.style.background = active ? "#f2ecdd" : "#1b2635";
        disc.style.color = active ? "#1e293b" : "#f2ecdd";
        disc.style.width = disc.style.height = active ? "28px" : "22px";
      }
      const label = el.lastElementChild as HTMLElement | null;
      if (label && label !== disc) label.style.display = active ? "" : "none";
    });
  };

  const run = (apply: () => void) => {
    if (mapRef.current && readyRef.current) apply();
    else pendingRef.current = apply;
  };

  useImperativeHandle(ref, () => ({
    jumpTo: (placeIndex) =>
      run(() => {
        const p = placesRef.current[placeIndex];
        if (!plottable(p)) return;
        mapRef.current!.stop();
        mapRef.current!.jumpTo({ center: [p.lng, p.lat], zoom: STOP_ZOOM });
        highlight(placeIndex);
      }),
    flyTo: (fromIndex, toIndex, ms) =>
      run(() => {
        const from = placesRef.current[fromIndex];
        const to = placesRef.current[toIndex];
        if (!plottable(to)) return;
        const map = mapRef.current!;
        if (plottable(from)) map.jumpTo({ center: [from.lng, from.lat], zoom: STOP_ZOOM });
        highlight(toIndex);
        // `essential`: the show already skips travel steps under reduced
        // motion, so one that is playing is meant to move.
        map.flyTo({ center: [to.lng, to.lat], zoom: STOP_ZOOM, duration: ms, essential: true });
      }),
    opener: (placeIndex, ms) =>
      run(() => {
        const p = placesRef.current[placeIndex];
        if (!plottable(p)) return;
        const map = mapRef.current!;
        map.jumpTo({ center: [p.lng - 60, p.lat * 0.4], zoom: GLOBE_ZOOM });
        highlight(placeIndex);
        // Gives the world tiles up to GLOBE_WAIT_MS to draw, so the opener
        // does not start on a blank ball — taken off the flight, so it still
        // lands when the show expects it to.
        const started = performance.now();
        let flown = false;
        const fly = () => {
          if (flown) return;
          flown = true;
          const left = Math.max(ms - (performance.now() - started), ms / 2);
          map.flyTo({ center: [p.lng, p.lat], zoom: STOP_ZOOM, duration: left, curve: 1.6, essential: true });
        };
        if (map.areTilesLoaded()) fly();
        else {
          map.once("idle", fly);
          setTimeout(fly, GLOBE_WAIT_MS);
        }
      }),
  }));

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let resize: ResizeObserver | undefined;

    (async () => {
      try {
        const [{ Map, Marker, setWorkerUrl }, { paperStyle }] = await Promise.all([
          import("maplibre-gl"),
          import("@/lib/map/paperFlavor"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        if (cancelled || !containerRef.current) return;
        // Same worker the map page's street map uses (StreetMap.tsx).
        setWorkerUrl("/api/maps/worker/maplibre-gl-worker.mjs");
        const first = placesRef.current.find(plottable);
        map = new Map({
          container: containerRef.current,
          style: { ...paperStyle(pmtilesUrl, "dark", locale), projection: { type: "globe" } },
          center: first ? (startOnGlobe ? [first.lng - 60, first.lat * 0.4] : [first.lng, first.lat]) : [0, 20],
          zoom: first && !startOnGlobe ? STOP_ZOOM : GLOBE_ZOOM,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          maxTileCacheSize: 512,
          cancelPendingTileRequestsWhileZooming: false,
        });
        mapRef.current = map;
        map.getCanvas().addEventListener("webglcontextlost", () => callbacks.current.onFail());
        // The 16:9 frame settles after the overlay fades in; follow it.
        resize = new ResizeObserver(() => map?.resize());
        resize.observe(containerRef.current);
        // `style.load`, not `load`: `load` waits for a fully drawn first
        // view, street tiles and all, which on a slow line outlasted the
        // opener's whole wait. The route only needs the style.
        map.once("style.load", () => {
          if (cancelled || !map) return;
          const ps = placesRef.current;
          const all = ps.filter(plottable).map((p) => [p.lng, p.lat]);
          map.addSource("slide-route-all", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: all } },
          });
          map.addSource("slide-route-done", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
          });
          const line = { "line-cap": "round", "line-join": "round" } as const;
          map.addLayer({
            id: "slide-route-all",
            type: "line",
            source: "slide-route-all",
            layout: line,
            paint: { "line-color": "#f2ecdd", "line-width": 2.5, "line-opacity": 0.3 },
          });
          map.addLayer({
            id: "slide-route-done",
            type: "line",
            source: "slide-route-done",
            layout: line,
            paint: { "line-color": "#f2ecdd", "line-width": 3.5, "line-opacity": 0.95 },
          });
          markersRef.current = ps.map((p, i) => {
            const el = document.createElement("div");
            el.style.cssText = "display:flex;align-items:center;gap:6px;pointer-events:none;";
            const disc = document.createElement("span");
            disc.style.cssText =
              "display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;border:2px solid #f2ecdd;font:700 11px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.4);";
            disc.textContent = String(i + 1);
            const label = document.createElement("span");
            label.style.cssText =
              "display:none;font:700 15px/1.2 var(--font-display,system-ui),sans-serif;color:#f2ecdd;text-shadow:0 0 3px #0e2231,0 0 6px #0e2231;white-space:nowrap;";
            // `textContent`, never `innerHTML` — a place name is the owner's
            // own text.
            label.textContent = p.location;
            el.append(disc, label);
            const mk = new Marker({ element: el, anchor: "left", offset: [-14, 0] });
            if (plottable(p)) mk.setLngLat([p.lng, p.lat]).addTo(map!);
            return mk;
          });
          readyRef.current = true;
          const pending = pendingRef.current;
          pendingRef.current = null;
          pending?.();
          callbacks.current.onReady();
        });
      } catch {
        // No WebGL (or MapLibre refusing to start): the SVG map carries on.
        if (!cancelled) callbacks.current.onFail();
      }
    })();

    return () => {
      cancelled = true;
      resize?.disconnect();
      readyRef.current = false;
      markersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
    // The show's places and locale do not change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmtilesUrl]);

  return (
    // `isolate`: the markers' own z-index stays inside this layer, under
    // the slides drawn over it.
    <div className="absolute inset-0 isolate bg-overlay-strong">
      <div ref={containerRef} className="h-full w-full" />
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-2 right-3 z-10 text-[10px] text-overlay-ink/60"
      >
        © OpenStreetMap
      </a>
    </div>
  );
});

export default SlideStreetMap;
