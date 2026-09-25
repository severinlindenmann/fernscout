"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

type Zone = { label: string; lat: number; lon: number; radiusM: number };
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
export default function GpsZones({ username }: { username: string }) {
  const { t } = useI18n();
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
          <label className="block">
            <span className={LABEL}>{t("studio.location.zones.radiusLabel")}</span>
            <input
              className={INPUT}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              type="number"
              min={doc.limits.radiusM.min}
              max={doc.limits.radiusM.max}
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
