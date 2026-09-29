"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import DayLineMap from "@/components/studio/location/DayLineMap";
import WorldMap from "@/components/WorldMap";
import RangeBar from "@/components/map/RangeBar";
import { selectionStats } from "@/lib/map/rangeBar";
import { utcToZonedParts } from "@/lib/timezone";
import type { TransportMode } from "@/importers/gps/schema";

// Never `import { EDIT_LIMITS } from "@/lib/gps/edits"` here — that module
// also carries `node:fs`/`node:path` (its own doc comment says why it is
// never imported from `app/`), and this is a "use client" file a browser
// bundle has to resolve. `TrackEditsPanel.tsx` (the trip page's own editor)
// makes the same call: the bounds travel inside the fetched document's own
// `limits`, never imported directly.
type HiddenSpot = { id: string; lat: number; lon: number; radiusM: number };
type HiddenStretch = { id: string; date: string; from: string; to: string };
type NamedStretch = { id: string; date: string; from: string; to: string; label: string; mode?: TransportMode };
type EditsDoc = {
  hiddenSpots: HiddenSpot[];
  hiddenStretches: HiddenStretch[];
  namedStretches: NamedStretch[];
  limits: { maxSpots: number; maxStretches: number; maxNamed: number; radiusM: { min: number; max: number }; labelMax: number };
};

const ONE_MINUTE_MS = 60_000;

/** Great-circle metres — restated rather than imported the same way
 * `lib/gps/edits.ts`'s own copy explains: this file is a client component
 * ("use client"), and nothing under `app/`/`components/` may pull in a
 * module that (even transitively) imports `node:fs` the way `lib/gps/edits.ts`
 * would bundle for the browser — six lines here keeps that boundary a
 * straight line instead of something a bundler config has to enforce. */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The day page's own map, range bar, selection card and "On this day" list —
 * B2563 T3. One client island holding one fetch of this trip's track-edits
 * document, so every save here (a hidden spot, a hidden stretch, a named
 * stretch, a remove) and every list below it reads the same state — no
 * separate `TrackEditsPanel` instance to keep in sync, which is also why this
 * does not reuse that component here (the trip page still does, for its own
 * unrelated "list every edit, no forms" view, T3's other half).
 *
 * Everything here saves through the existing `PUT /api/web/{user}/trips/{trip}/track-edits`
 * — the same If-Match/409 flow `TrackEditsPanel`/`GpsZones` already use —
 * never a new door onto the store.
 */
export default function DayStretchEditor({
  username,
  tripId,
  date,
  points,
  times,
  modes,
  gapAfter,
  timezone,
  region,
  streetMapsOn,
}: {
  username: string;
  tripId: string;
  date: string;
  points: [number, number][];
  times: number[];
  modes: (TransportMode | undefined)[];
  gapAfter: boolean[];
  timezone: string;
  region?: { bounds: [[number, number], [number, number]]; url: string };
  streetMapsOn: boolean;
}) {
  const { t, formatShortDate } = useI18n();
  const router = useRouter();
  const [doc, setDoc] = useState<EditsDoc | null>(null);
  const etagRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [asking, setAsking] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");
  const [placing, setPlacing] = useState(false);
  const [pendingSpot, setPendingSpot] = useState<{ lat: number; lon: number; radiusM: number } | null>(null);
  /** "Type coordinates instead" (T3's own ⋯-menu escape hatch, kept as a
   * plain link here rather than in `RouteMenu` — a hidden-spot's own typed
   * fallback has nothing else in common with that menu's delete flow) — the
   * only path at all once `streetMapsOn` is off. */
  const [typingCoords, setTypingCoords] = useState(false);
  const [typedLat, setTypedLat] = useState("");
  const [typedLon, setTypedLon] = useState("");
  const [typedRadius, setTypedRadius] = useState("100");

  const start = times[0];
  const end = times[times.length - 1] ?? start;
  const [fromT, setFromT] = useState(start);
  const [toT, setToT] = useState(end);

  const base = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/track-edits`;

  function load() {
    fetch(base)
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        etagRef.current = res.headers.get("etag");
        return res.json();
      })
      .then((body) => setDoc(body))
      .catch(() => {
        setDoc(null);
        setLoadError(true);
      });
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function put(next: Pick<EditsDoc, "hiddenSpots" | "hiddenStretches" | "namedStretches">): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    const res = await fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(etagRef.current ? { "if-match": etagRef.current } : {}) },
      // Exactly the three writable keys: callers spread the GET document,
      // which also carries `limits`, and the strict write schema refuses it.
      body: JSON.stringify({
        hiddenSpots: next.hiddenSpots,
        hiddenStretches: next.hiddenStretches,
        namedStretches: next.namedStretches,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 409) {
      setError(t("studio.location.trackEdits.conflict"));
      load();
      return false;
    }
    if (!res?.ok) {
      setError(t("studio.location.trackEdits.error"));
      return false;
    }
    etagRef.current = res.headers.get("etag");
    setDoc(await res.json());
    router.refresh();
    return true;
  }

  const stats = useMemo(() => selectionStats(points, times, modes, fromT, toT), [points, times, modes, fromT, toT]);
  // Same fallback constants `GpsZones`' own initial radius state and
  // `lib/gps/edits.ts`'s `EDIT_LIMITS` agree on — used only until the
  // document loads, since the bounds themselves live server-side and this
  // file may not import that module (see the top-of-file note).
  const radiusMin = doc?.limits.radiusM.min ?? 50;
  const radiusMax = doc?.limits.radiusM.max ?? 5_000;
  const labelMax = doc?.limits.labelMax ?? 80;

  function stretchWindow() {
    return { from: utcToZonedParts(new Date(fromT), timezone).time, to: utcToZonedParts(new Date(toT), timezone).time };
  }

  async function hideStretch() {
    if (!doc) return;
    const { from, to } = stretchWindow();
    if (from >= to) return;
    await put({ ...doc, hiddenStretches: [...doc.hiddenStretches, { date, from, to } as HiddenStretch] });
  }

  async function nameStretch(event: React.FormEvent) {
    event.preventDefault();
    if (!doc) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    const { from, to } = stretchWindow();
    if (from >= to) return;
    const ok = await put({
      ...doc,
      namedStretches: [
        ...doc.namedStretches,
        { date, from, to, label: trimmed, ...(stats.mode ? { mode: stats.mode } : {}) } as NamedStretch,
      ],
    });
    if (ok) {
      setNaming(false);
      setLabel("");
    }
  }

  async function hideSpot() {
    if (!doc || !pendingSpot) return;
    const ok = await put({ ...doc, hiddenSpots: [...doc.hiddenSpots, pendingSpot as HiddenSpot] });
    if (ok) {
      setPendingSpot(null);
      setPlacing(false);
    }
  }

  async function hideTypedSpot(event: React.FormEvent) {
    event.preventDefault();
    if (!doc) return;
    const lat = Number(typedLat);
    const lon = Number(typedLon);
    const radiusM = Number(typedRadius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) return;
    const ok = await put({ ...doc, hiddenSpots: [...doc.hiddenSpots, { lat, lon, radiusM } as HiddenSpot] });
    if (ok) {
      setTypedLat("");
      setTypedLon("");
      setTypedRadius("100");
      setTypingCoords(false);
    }
  }

  async function removeSpot(id: string) {
    if (!doc) return;
    setAsking(null);
    await put({ ...doc, hiddenSpots: doc.hiddenSpots.filter((s) => s.id !== id) });
  }
  async function removeHiddenStretch(id: string) {
    if (!doc) return;
    setAsking(null);
    await put({ ...doc, hiddenStretches: doc.hiddenStretches.filter((s) => s.id !== id) });
  }
  async function removeNamedStretch(id: string) {
    if (!doc) return;
    setAsking(null);
    await put({ ...doc, namedStretches: doc.namedStretches.filter((s) => s.id !== id) });
  }

  const onThisDay = useMemo(() => {
    if (!doc) return { spots: [] as HiddenSpot[], hidden: [] as HiddenStretch[], named: [] as NamedStretch[] };
    const spots = doc.hiddenSpots.filter((spot) => points.some((p) => metresBetween({ lat: p[0], lon: p[1] }, spot) <= spot.radiusM));
    const hidden = doc.hiddenStretches.filter((s) => s.date === date);
    const named = doc.namedStretches.filter((s) => s.date === date);
    return { spots, hidden, named };
  }, [doc, points, date]);

  const selectedIndices = points.reduce<[number, number] | null>((acc, _p, i) => {
    if (times[i] < fromT || times[i] > toT) return acc;
    return acc ? [acc[0], i] : [i, i];
  }, null);

  const map =
    region && streetMapsOn ? (
      <DayLineMap
        points={points}
        gapAfter={gapAfter}
        bounds={region.bounds}
        pmtilesUrl={region.url}
        className="h-64 w-full"
        selected={selectedIndices}
        onMapClick={placing ? (lat, lon) => setPendingSpot({ lat, lon, radiusM: pendingSpot?.radiusM ?? radiusMin }) : undefined}
        pendingSpot={pendingSpot}
      />
    ) : (
      <WorldMap
        places={[]}
        basemap={null}
        track={[points]}
        frameHint={points.map(([lat, lng]) => ({ lat, lng: lng }))}
        showTimeScrubber={false}
      />
    );

  return (
    <div>
      <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet">{map}</div>

      {times.length > 1 && (
        <RangeBar
          start={start}
          end={end}
          fromT={fromT}
          toT={toT}
          times={times}
          gapAfter={gapAfter}
          stepMs={ONE_MINUTE_MS}
          onChange={({ fromT: f, toT: to }) => {
            setFromT(f);
            setToT(to);
          }}
          formatHandle={(instant) => utcToZonedParts(new Date(instant), timezone).time}
        />
      )}

      {doc && times.length > 1 && (
        <div className="mt-3 rounded-2xl border border-line-quiet bg-surface-raised p-4 lg:static lg:rounded-2xl">
          <p className="text-sm font-semibold text-ink-strong">
            {t("studio.location.stretch.selectedRange", {
              from: utcToZonedParts(new Date(fromT), timezone).time,
              to: utcToZonedParts(new Date(toT), timezone).time,
            })}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">
            {t("studio.location.stretch.selectedStats", { km: stats.km.toFixed(1), positions: String(stats.positions) })}
          </p>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.stretch.scope")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <BusyButton
              busy={busy}
              type="button"
              onClick={() => void hideStretch()}
              disabled={fromT >= toT}
              className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50"
            >
              {t("studio.location.stretch.hide")}
            </BusyButton>
            <BusyButton
              busy={busy}
              type="button"
              onClick={() => setNaming(true)}
              disabled={fromT >= toT}
              className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50"
            >
              {t("studio.location.stretch.nameIt")}
            </BusyButton>
          </div>
          {naming && (
            <form onSubmit={(e) => void nameStretch(e)} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block flex-1">
                <span className="text-sm font-semibold text-ink-strong">{t("studio.location.stretch.nameLabel")}</span>
                <input
                  autoFocus
                  className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={labelMax}
                  required
                />
              </label>
              <BusyButton
                busy={busy}
                type="submit"
                className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300"
              >
                {t("studio.location.stretch.save")}
              </BusyButton>
              <BusyButton
                busy={busy}
                type="button"
                onClick={() => setNaming(false)}
                className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
              >
                {t("me.cancel")}
              </BusyButton>
            </form>
          )}
        </div>
      )}

      {streetMapsOn && region && (
        <div className="mt-3 rounded-2xl border border-line-quiet p-4">
          {!placing && !typingCoords ? (
            <div className="flex flex-wrap gap-3">
              <BusyButton
                busy={false}
                type="button"
                onClick={() => setPlacing(true)}
                className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
              >
                {t("studio.location.stretch.tapToHide")}
              </BusyButton>
              <button
                type="button"
                onClick={() => setTypingCoords(true)}
                className="text-sm font-semibold text-ink-strong underline underline-offset-2"
              >
                {t("studio.location.zones.typeCoordinatesLink")}
              </button>
            </div>
          ) : typingCoords ? (
            <form onSubmit={(e) => void hideTypedSpot(e)} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.latLabel")}</span>
                  <input
                    className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                    value={typedLat}
                    onChange={(e) => setTypedLat(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.lonLabel")}</span>
                  <input
                    className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                    value={typedLon}
                    onChange={(e) => setTypedLon(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.radiusLabel")}</span>
                <input
                  className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                  type="number"
                  min={radiusMin}
                  max={radiusMax}
                  value={typedRadius}
                  onChange={(e) => setTypedRadius(e.target.value)}
                  required
                />
              </label>
              <div className="flex gap-2">
                <BusyButton
                  busy={busy}
                  type="submit"
                  className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300"
                >
                  {t("studio.location.stretch.hideSpotSave")}
                </BusyButton>
                <BusyButton
                  busy={false}
                  type="button"
                  onClick={() => setTypingCoords(false)}
                  className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
                >
                  {t("me.cancel")}
                </BusyButton>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-ink-secondary">{t("studio.location.stretch.tapHint")}</p>
              {pendingSpot && (
                <>
                  <label className="block">
                    <span className="text-sm font-semibold text-ink-strong">
                      {t("studio.location.trackEdits.radiusLabel")} — {pendingSpot.radiusM} m
                    </span>
                    <input
                      className="mt-1 w-full accent-yellow-400"
                      type="range"
                      min={radiusMin}
                      max={radiusMax}
                      step={10}
                      value={pendingSpot.radiusM}
                      onChange={(e) => setPendingSpot({ ...pendingSpot, radiusM: Number(e.target.value) })}
                    />
                  </label>
                  <BusyButton
                    busy={busy}
                    type="button"
                    onClick={() => void hideSpot()}
                    className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300"
                  >
                    {t("studio.location.stretch.hideSpotSave")}
                  </BusyButton>
                </>
              )}
              <BusyButton
                busy={false}
                type="button"
                onClick={() => {
                  setPlacing(false);
                  setPendingSpot(null);
                }}
                className="ml-2 min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
              >
                {t("me.cancel")}
              </BusyButton>
            </div>
          )}
        </div>
      )}

      {/* No street map to tap — the typed form is the only way to hide a
          spot at all (D9's fallback, same as `GpsZones` without `streetMaps`),
          shown directly rather than behind a link since there is no map to
          offer as the default here. */}
      {!(streetMapsOn && region) && (
        <div className="mt-3 rounded-2xl border border-line-quiet p-4">
          <h3 className="text-sm font-semibold text-ink-strong">{t("studio.location.stretch.tapToHide")}</h3>
          <form onSubmit={(e) => void hideTypedSpot(e)} className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.latLabel")}</span>
                <input
                  className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                  value={typedLat}
                  onChange={(e) => setTypedLat(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.lonLabel")}</span>
                <input
                  className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                  value={typedLon}
                  onChange={(e) => setTypedLon(e.target.value)}
                  inputMode="decimal"
                  required
                />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.radiusLabel")}</span>
              <input
                className="mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong"
                type="number"
                min={radiusMin}
                max={radiusMax}
                value={typedRadius}
                onChange={(e) => setTypedRadius(e.target.value)}
                required
              />
            </label>
            <BusyButton
              busy={busy}
              type="submit"
              className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300"
            >
              {t("studio.location.stretch.hideSpotSave")}
            </BusyButton>
          </form>
        </div>
      )}

      {loadError && (
        <p role="alert" className="mt-3 text-sm text-coral-600">
          {t("studio.location.trackEdits.loadError")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-coral-600">
          {error}
        </p>
      )}

      {doc && (onThisDay.spots.length > 0 || onThisDay.hidden.length > 0 || onThisDay.named.length > 0) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-ink-strong">{t("studio.location.stretch.onThisDayHeading")}</h3>
          <ul className="mt-2 space-y-2">
            {onThisDay.spots.map((spot) => (
              <li key={spot.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
                <span className="text-ink-body">{t("studio.location.trackEdits.spotRadiusUnit", { radius: String(spot.radiusM) })}</span>
                <button
                  type="button"
                  onClick={() => setAsking(`spot:${spot.id}`)}
                  className="font-semibold text-coral-600 underline underline-offset-2"
                >
                  {t("studio.location.trackEdits.remove")}
                </button>
                {asking === `spot:${spot.id}` && (
                  <ConfirmPanel
                    label={t("studio.location.trackEdits.remove")}
                    question={t("studio.location.trackEdits.removeSpotQuestion")}
                    confirmLabel={t("studio.location.trackEdits.remove")}
                    tone="destructive"
                    busy={busy}
                    onConfirm={() => void removeSpot(spot.id)}
                    onCancel={() => setAsking(null)}
                  />
                )}
              </li>
            ))}
            {onThisDay.hidden.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
                <span className="text-ink-body">
                  {formatShortDate(s.date)}, {s.from} – {s.to}
                </span>
                <button
                  type="button"
                  onClick={() => setAsking(`hidden:${s.id}`)}
                  className="font-semibold text-coral-600 underline underline-offset-2"
                >
                  {t("studio.location.trackEdits.remove")}
                </button>
                {asking === `hidden:${s.id}` && (
                  <ConfirmPanel
                    label={t("studio.location.trackEdits.remove")}
                    question={t("studio.location.trackEdits.removeStretchQuestion")}
                    confirmLabel={t("studio.location.trackEdits.remove")}
                    tone="destructive"
                    busy={busy}
                    onConfirm={() => void removeHiddenStretch(s.id)}
                    onCancel={() => setAsking(null)}
                  />
                )}
              </li>
            ))}
            {onThisDay.named.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
                <span className="text-ink-body">
                  {s.label} · {formatShortDate(s.date)}, {s.from} – {s.to}
                </span>
                <button
                  type="button"
                  onClick={() => setAsking(`named:${s.id}`)}
                  className="font-semibold text-coral-600 underline underline-offset-2"
                >
                  {t("studio.location.trackEdits.remove")}
                </button>
                {asking === `named:${s.id}` && (
                  <ConfirmPanel
                    label={t("studio.location.trackEdits.remove")}
                    question={t("studio.location.trackEdits.removeNamedQuestion", { label: s.label })}
                    confirmLabel={t("studio.location.trackEdits.remove")}
                    tone="destructive"
                    busy={busy}
                    onConfirm={() => void removeNamedStretch(s.id)}
                    onCancel={() => setAsking(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
