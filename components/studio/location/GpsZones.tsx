"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import StreetMap from "@/components/map/StreetMap";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";

type Zone = { label: string; lat: number; lon: number; radiusM: number };

/** A rough circle polygon in degrees, for drawing a private zone's radius on
 * a map — good enough at zone scale (tens of metres to a few km) where the
 * meridian/parallel distortion this ignores is well under a pixel.
 * ponytail: equirectangular approximation, not a geodesic circle; revisit if
 * zones ever grow toward `ZONE_LIMITS.maxRadiusM` at high latitude. */
function circlePolygon(lat: number, lon: number, radiusM: number, steps = 48): GeoJSON.Feature {
  const latDeg = radiusM / 111_320;
  const lonDeg = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    coords.push([lon + lonDeg * Math.cos(angle), lat + latDeg * Math.sin(angle)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

const ZONES_SOURCE = "gps-zones";
const PENDING_SOURCE = "gps-zone-pending";

function zonesAsFeatureCollection(zones: Zone[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: zones.map((z) => circlePolygon(z.lat, z.lon, z.radiusM)) };
}
type ZonesDoc = {
  zones: Zone[];
  homeDeclined: boolean;
  limits: { maxZones: number; radiusM: { min: number; max: number } };
};

const INPUT =
  "mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong";
const LABEL = "text-sm font-semibold text-ink-strong";

/**
 * "Keep a place off the map" — B2203, the studio's own door onto the
 * private-zones file (`exclude.json`, under the owner's own private store),
 * which used to be something only a shell could write. Reads and writes
 * through `/api/web/{user}/gps/zones`, the
 * owner's cookie-only twin of the bearer-only `/api/v2/{user}/gps/zones` an
 * agent would use instead — same domain functions, different door, exactly
 * the shape `channels`' pair already uses.
 *
 * Smallest place-picker that works: no map, no geocoder wired in from the
 * browser (the one this server has, `/api/v2/geocode`, is bearer-only and
 * nothing here holds a token) — coordinates are typed in, or filled from the
 * browser's own idea of where it is right now.
 *
 * Any saved zone is what `hasHomeZoneOrDeclined` (`lib/gps/api.ts`) looks
 * for when B2196/B2198's recorder decides whether it may arm at all.
 */
export default function GpsZones({ username, streetMapsOn = false }: { username: string; streetMapsOn?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const mapRef = useRef<MapLibreMap | null>(null);
  const [doc, setDoc] = useState<ZonesDoc | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("500");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(false);

  function load() {
    fetch(`/api/web/${encodeURIComponent(username)}/gps/zones`)
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        setEtag(res.headers.get("etag"));
        return res.json();
      })
      .then((body) => setDoc(body))
      .catch(() => {
        setDoc(null);
        setEtag(null);
        setLoadError(true);
      });
  }

  useEffect(load, [username]);

  // Draws the map picker's two layers: the owner's saved zones (a hatch-ish
  // dashed circle, always) and the pending new zone (only while there is a
  // valid lat/lon to draw). Re-run whenever either changes; MapLibre's
  // `setData` is cheap and idempotent, so this never waits for a reload.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !doc) return;
    const draw = () => {
      const zonesSrc = map.getSource(ZONES_SOURCE) as GeoJSONSource | undefined;
      zonesSrc?.setData(zonesAsFeatureCollection(doc.zones));
      const pendingSrc = map.getSource(PENDING_SOURCE) as GeoJSONSource | undefined;
      const parsedLat = Number(lat);
      const parsedLon = Number(lon);
      const parsedRadius = Number(radius);
      const pending =
        Number.isFinite(parsedLat) && Number.isFinite(parsedLon) && Number.isFinite(parsedRadius)
          ? circlePolygon(parsedLat, parsedLon, parsedRadius)
          : null;
      pendingSrc?.setData({ type: "FeatureCollection", features: pending ? [pending] : [] });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [doc, lat, lon, radius]);

  function onMapReady(map: import("maplibre-gl").Map) {
    mapRef.current = map;
    map.on("load", () => {
      map.addSource(ZONES_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${ZONES_SOURCE}-fill`,
        type: "fill",
        source: ZONES_SOURCE,
        paint: { "fill-color": "#c2410c", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: `${ZONES_SOURCE}-line`,
        type: "line",
        source: ZONES_SOURCE,
        paint: { "line-color": "#c2410c", "line-width": 2, "line-dasharray": [2, 2] },
      });
      map.addSource(PENDING_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: `${PENDING_SOURCE}-fill`,
        type: "fill",
        source: PENDING_SOURCE,
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: `${PENDING_SOURCE}-line`,
        type: "line",
        source: PENDING_SOURCE,
        paint: { "line-color": "#2563eb", "line-width": 2, "line-dasharray": [2, 2] },
      });
    });
    map.on("click", (e) => {
      setLat(e.lngLat.lat.toFixed(5));
      setLon(e.lngLat.lng.toFixed(5));
    });
  }

  // A saved zone's own lat/lon, so the map has somewhere to open on rather
  // than the whole world — the last-added zone is as good a guess as any of
  // "where this owner's places tend to be".
  const centerZone = doc?.zones[doc.zones.length - 1];
  const mapCenter: [number, number] = centerZone
    ? [centerZone.lon, centerZone.lat]
    : [Number(lon) || 0, Number(lat) || 0];
  const mapBounds: [[number, number], [number, number]] =
    mapCenter[0] || mapCenter[1]
      ? [
          [mapCenter[0] - 0.2, mapCenter[1] - 0.2],
          [mapCenter[0] + 0.2, mapCenter[1] + 0.2],
        ]
      : [
          [-30, -50],
          [30, 60],
        ];

  async function put(next: { zones: Zone[]; homeDeclined?: boolean }): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    const res = await fetch(`/api/web/${encodeURIComponent(username)}/gps/zones`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(etag ? { "if-match": etag } : {}),
      },
      body: JSON.stringify(next),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 409) {
      // Somebody else's write (or another tab) landed first. The owner's
      // own edit is not applied on top of it blind — reload what is
      // actually stored and say so in words, rather than silently losing
      // one side of the change.
      setError(t("studio.location.zones.conflict"));
      load();
      return false;
    }
    if (!res?.ok) {
      setError(t("studio.location.zones.error"));
      return false;
    }
    setEtag(res.headers.get("etag"));
    const body = (await res.json()) as ZonesDoc;
    setDoc(body);
    setSaved(true);
    // B2549 — the new-day place-name suggestion reads these zones fresh.
    router.refresh();
    return true;
  }

  function useCurrentLocation() {
    setLocationError(false);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(5));
        setLon(position.coords.longitude.toFixed(5));
        setLocating(false);
      },
      () => {
        setLocationError(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!doc) return;
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    const parsedRadius = Number(radius);
    if (
      label.trim() === "" ||
      !Number.isFinite(parsedLat) ||
      !Number.isFinite(parsedLon) ||
      !Number.isFinite(parsedRadius)
    ) {
      return;
    }
    const ok = await put({
      zones: [...doc.zones, { label: label.trim(), lat: parsedLat, lon: parsedLon, radiusM: parsedRadius }],
    });
    if (ok) {
      setLabel("");
      setLat("");
      setLon("");
      setRadius("500");
    }
  }

  async function remove(zone: Zone) {
    if (!doc) return;
    setAsking(null);
    await put({ zones: doc.zones.filter((z) => z !== zone) });
  }

  async function toggleDecline(next: boolean) {
    if (!doc) return;
    await put({ zones: doc.zones, homeDeclined: next });
  }

  if (!doc) {
    if (loadError) {
      return (
        <section className="mt-10">
          <h2 className="font-display text-lg font-semibold text-ink-strong">
            {t("studio.location.zones.title")}
          </h2>
          <p role="alert" className="mt-2 text-sm text-coral-600">
            {t("studio.location.zones.loadError")}
          </p>
          <BusyButton
            busy={false}
            type="button"
            onClick={load}
            className="mt-3 min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {t("studio.location.zones.retry")}
          </BusyButton>
        </section>
      );
    }
    return null;
  }

  const atLimit = doc.zones.length >= doc.limits.maxZones;

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-ink-strong">
        {t("studio.location.zones.title")}
      </h2>
      <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.zones.lede")}</p>

      {doc.zones.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-surface-subtle px-4 py-3 text-sm text-ink-secondary">
          {t("studio.location.zones.empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {doc.zones.map((zone) => (
            <li
              key={`${zone.label}-${zone.lat}-${zone.lon}`}
              className="rounded-2xl border border-line-quiet bg-surface-raised p-4"
            >
              <p className="font-display text-base font-semibold text-ink-strong">{zone.label}</p>
              <p className="text-sm text-ink-secondary">
                {t("studio.location.zones.radiusUnit", { radius: String(zone.radiusM) })}
              </p>
              <BusyButton
                busy={busy}
                type="button"
                onClick={() => setAsking(zone.label)}
                aria-expanded={asking === zone.label}
                className="mt-2 text-sm font-semibold text-ink-strong underline underline-offset-2 disabled:opacity-50"
              >
                {t("studio.location.zones.remove")}
              </BusyButton>
              {asking === zone.label && (
                <div className="mt-3">
                  <ConfirmPanel
                    label={t("studio.location.zones.remove")}
                    question={t("studio.location.zones.removeQuestion", { label: zone.label })}
                    confirmLabel={t("studio.location.zones.removeConfirm", { label: zone.label })}
                    tone="destructive"
                    busy={busy}
                    onConfirm={() => void remove(zone)}
                    onCancel={() => setAsking(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {atLimit ? (
        <p className="mt-4 text-sm text-ink-secondary">
          {t("studio.location.zones.limitReached", { max: String(doc.limits.maxZones) })}
        </p>
      ) : (
        <form onSubmit={(e) => void add(e)} className="mt-4 space-y-3 rounded-2xl border border-line-quiet p-4">
          <label className="block">
            <span className={LABEL}>{t("studio.location.zones.labelLabel")}</span>
            <input
              className={INPUT}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("studio.location.zones.labelPlaceholder")}
              maxLength={80}
              required
            />
          </label>
          {streetMapsOn ? (
            <div className="space-y-2">
              <p className="text-sm text-ink-secondary">{t("studio.location.zones.mapHint")}</p>
              <StreetMap
                bounds={mapBounds}
                pmtilesUrl="/api/maps/world.pmtiles"
                onReady={onMapReady}
                className="h-64 w-full overflow-hidden rounded-xl border border-line-quiet"
              />
              {(!lat || !lon) && (
                <p role="status" className="text-sm text-ink-secondary">
                  {t("studio.location.zones.mapPending")}
                </p>
              )}
              {doc.zones.length > 0 && (
                <p className="text-sm text-ink-secondary">{t("studio.location.zones.hatchedLegend")}</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={LABEL}>{t("studio.location.zones.latLabel")}</span>
                <input
                  className={INPUT}
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label className="block">
                <span className={LABEL}>{t("studio.location.zones.lonLabel")}</span>
                <input
                  className={INPUT}
                  value={lon}
                  onChange={(e) => setLon(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
            </div>
          )}
          <label className="block">
            <span className={LABEL}>
              {t("studio.location.zones.radiusLabel")} — {t("studio.location.zones.radiusUnit", { radius })}
            </span>
            <input
              className="mt-1 w-full accent-yellow-400"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              type="range"
              min={doc.limits.radiusM.min}
              max={doc.limits.radiusM.max}
              step={10}
              aria-label={t("studio.location.zones.radiusLabel")}
              required
            />
          </label>
          <BusyButton
            busy={locating}
            type="button"
            onClick={useCurrentLocation}
            className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {t("studio.location.zones.useLocation")}
          </BusyButton>
          {locationError && (
            <p role="alert" className="text-sm text-coral-600">
              {t("studio.location.zones.locationError")}
            </p>
          )}
          <BusyButton
            busy={busy}
            type="submit"
            className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50"
          >
            {busy ? t("studio.location.zones.adding") : t("studio.location.zones.add")}
          </BusyButton>
        </form>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-ink-strong">
        <input
          type="checkbox"
          checked={doc.homeDeclined}
          onChange={(e) => void toggleDecline(e.target.checked)}
          disabled={busy}
        />
        {t("studio.location.zones.declineLabel")}
      </label>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.zones.declineNote")}</p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-coral-600">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="mt-3 text-sm text-ink-strong">
          {t("studio.location.zones.savedNote")}
        </p>
      )}
    </section>
  );
}
