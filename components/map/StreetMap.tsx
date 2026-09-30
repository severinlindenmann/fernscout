"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Info } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/** A map's own coordinate handle, exposed for a caller (B2537) to draw
 * markers or lines on it after it loads — through the real maplibre-gl
 * instance this component alone ever imports. */
type StreetMapHandle = { map: import("maplibre-gl").Map | null };

type Bounds = [[number, number], [number, number]];

type StreetMapProps = {
  /** `[[minLng, minLat], [maxLng, maxLat]]` — the same shape `map.fitBounds` takes. */
  bounds: Bounds;
  /** Where this trip's region file is served from — `/api/maps/<file>` (see
   * lib/maps/dir.ts and app/api/maps/[...path]/route.ts). */
  pmtilesUrl: string;
  /** Pixels of breathing room around `bounds` when the map first frames it. */
  padding?: number | { top: number; bottom: number; left: number; right: number };
  className?: string;
  /** Called once the map exists, before its style has necessarily finished
   * loading — the same escape hatch `ref` gives, for a caller that would
   * rather not hold a ref. */
  onReady?: (map: import("maplibre-gl").Map) => void;
};

/** How long the OpenStreetMap credit shows as a pill before folding into the
 * ⓘ button beside it — the visual spec's "5 s". */
const CREDIT_PILL_MS = 5000;

function currentScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * A self-hosted street-level basemap — B2535. MapLibre GL, the `pmtiles`
 * protocol and `@protomaps/basemaps`'s layer set are all imported inside the
 * effect below with a dynamic `import()`, never at this module's top level,
 * so a page that never mounts this component never fetches any of it (see
 * AGENTS.md — no other page's bundle grows). `lib/map/paperFlavor.ts` builds
 * the actual style; this component only wires it to a container, the
 * reader's theme and their locale, and keeps it in sync when any of those
 * three change.
 *
 * No POI icons or peak labels (dropped in `paperFlavor.ts`), and no sprite:
 * nothing here ever draws one. Glyphs come from `/api/maps/fonts/...`
 * (`paperFlavor.ts`'s own doc comment says why), which falls back to the
 * baked Latin-range files under `public/fonts/` for whatever range an
 * operator hasn't downloaded the full set for.
 */
const StreetMap = forwardRef<StreetMapHandle, StreetMapProps>(function StreetMap(
  { bounds, pmtilesUrl, padding = 32, className, onReady },
  ref,
) {
  const { locale, t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const [creditFolded, setCreditFolded] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);

  useImperativeHandle(ref, () => ({ get map() { return mapRef.current; } }), []);

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;

    (async () => {
      // maplibre-gl has no default export — named imports only.
      const [{ Map, NavigationControl, setWorkerUrl }, { paperStyle }] = await Promise.all([
        import("maplibre-gl"),
        import("@/lib/map/paperFlavor"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);
      if (cancelled || !containerRef.current) return;

      // The bundler does not emit maplibre-gl 6's module worker; it is served
      // from app/api/maps/worker instead.
      setWorkerUrl("/api/maps/worker/maplibre-gl-worker.mjs");

      const created = new Map({
        container: containerRef.current,
        style: paperStyle(pmtilesUrl, currentScheme(), locale),
        bounds,
        fitBoundsOptions: { padding },
        attributionControl: false,
      });
      created.addControl(new NavigationControl({ showCompass: false }), "top-right");
      map = created;
      mapRef.current = created;
      onReady?.(created);
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // `pmtilesUrl` and `locale` changing mid-life is rare enough (a trip's
    // file appearing, a locale switch) that remounting the whole map is the
    // simplest correct behaviour — no diffing of an already-loaded style.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmtilesUrl, locale]);

  // The dark/light *scheme* can change without `locale` changing (the OS
  // theme flips, or the reader's own in-app choice does) — kept separate
  // from the effect above so a theme change updates the style in place
  // rather than remounting the whole map.
  useEffect(() => {
    const apply = async () => {
      const map = mapRef.current;
      if (!map) return;
      const { paperStyle } = await import("@/lib/map/paperFlavor");
      map.setStyle(paperStyle(pmtilesUrl, currentScheme(), locale));
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    media.addEventListener("change", apply);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", apply);
    };
  }, [pmtilesUrl, locale]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCreditFolded(true), CREDIT_PILL_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute bottom-3 left-3 z-10">
        {!creditFolded ? (
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-surface-raised/90 px-3 py-1 text-xs text-ink-secondary shadow-sm backdrop-blur"
          >
            {t("map.osmCredit")}
          </a>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setCreditOpen((v) => !v)}
              aria-label={t("map.osmCreditInfo")}
              aria-expanded={creditOpen}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-raised/90 text-ink-secondary shadow-sm backdrop-blur"
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
            {creditOpen && (
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-9 left-0 whitespace-nowrap rounded-full bg-surface-raised/90 px-3 py-1 text-xs text-ink-secondary shadow-sm backdrop-blur"
              >
                {t("map.osmCredit")}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default StreetMap;
