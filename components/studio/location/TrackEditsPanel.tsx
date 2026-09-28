"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";

type HiddenSpot = { id: string; lat: number; lon: number; radiusM: number };
type HiddenStretch = { id: string; date: string; from: string; to: string };
type NamedStretch = { id: string; date: string; from: string; to: string; label: string };
type EditsDoc = {
  hiddenSpots: HiddenSpot[];
  hiddenStretches: HiddenStretch[];
  namedStretches: NamedStretch[];
  limits: {
    maxSpots: number;
    maxStretches: number;
    maxNamed: number;
    radiusM: { min: number; max: number };
    labelMax: number;
  };
};

const INPUT =
  "mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong";
const LABEL = "text-sm font-semibold text-ink-strong";

/**
 * Hide a spot, hide a stretch, name a stretch — B2539, D8 C. This trip's own
 * door onto `content/<user>/trips/<trip>/track-edits.json`, through
 * `/api/web/{user}/trips/{trip}/track-edits` — the owner's cookie-only twin
 * of the bearer-only v2 route an agent would use.
 *
 * Smallest form that works: a spot is typed coordinates and a radius (no map
 * to tap — that is B2540's job); a stretch is a day already recorded plus a
 * from/to clock time. Sent to the server as `{date, from, to}` — a wall
 * clock, not an instant — and resolved there against that date's own day
 * timezone (`resolvedHiddenStretches`, `lib/gps/api.ts`), never here:
 * security review, 2026-09-28 found the first cut of this converting with
 * `new Date(...)`, which reads the *browser's* own zone. Editing a Tokyo
 * trip's stretch from a laptop in Zürich would have silently hidden the
 * wrong seven hours while this same list echoed the typed times back as if
 * nothing had moved. Because the server does the one conversion that
 * matters, this component never has to — the list below just echoes back
 * exactly the `date`/`from`/`to` the write answered with. One form for both
 * "hide" and "name": leaving the label blank hides the stretch with nothing
 * said about it; filling it in also names it.
 */
export default function TrackEditsPanel({
  username,
  tripId,
  days,
  hiddenDays,
}: {
  username: string;
  tripId: string;
  days: string[];
  /** B2544 — this trip's own days whose typed `coordinates` (never a
   * recorded GPS fix, so `deriveTrack`'s own hidden-spot cut never touches
   * them) fall inside one of the spots hidden below. Computed server-side,
   * `AS_AUTHOR`, so it always reflects the owner's real pin, whatever a
   * reader is shown. */
  hiddenDays?: { date: string; slug: string; location: string }[];
}) {
  const { t, formatShortDate } = useI18n();
  const router = useRouter();
  const [doc, setDoc] = useState<EditsDoc | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [stretchError, setStretchError] = useState<string | undefined>();

  const [spotLat, setSpotLat] = useState("");
  const [spotLon, setSpotLon] = useState("");
  const [spotRadius, setSpotRadius] = useState("100");

  const [stretchDate, setStretchDate] = useState(days[0] ?? "");
  const [stretchFrom, setStretchFrom] = useState("");
  const [stretchTo, setStretchTo] = useState("");
  const [stretchLabel, setStretchLabel] = useState("");

  const base = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/track-edits`;

  function load() {
    fetch(base)
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

  useEffect(load, [username, tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function put(next: {
    hiddenSpots: HiddenSpot[];
    hiddenStretches: HiddenStretch[];
    namedStretches: NamedStretch[];
  }): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    const res = await fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json", ...(etag ? { "if-match": etag } : {}) },
      body: JSON.stringify(next),
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
    setEtag(res.headers.get("etag"));
    const body = (await res.json()) as EditsDoc;
    setDoc(body);
    setSaved(true);
    // B2549 — the trip's own public track is drawn from these edits.
    router.refresh();
    return true;
  }

  function stripped(d: EditsDoc) {
    return {
      hiddenSpots: d.hiddenSpots,
      hiddenStretches: d.hiddenStretches,
      namedStretches: d.namedStretches,
    };
  }

  async function addSpot(event: React.FormEvent) {
    event.preventDefault();
    if (!doc) return;
    const lat = Number(spotLat);
    const lon = Number(spotLon);
    const radiusM = Number(spotRadius);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) return;
    const ok = await put({
      ...stripped(doc),
      hiddenSpots: [...doc.hiddenSpots, { lat, lon, radiusM } as HiddenSpot],
    });
    if (ok) {
      setSpotLat("");
      setSpotLon("");
      setSpotRadius("100");
    }
  }

  async function addStretch(event: React.FormEvent) {
    event.preventDefault();
    setStretchError(undefined);
    if (!doc || !stretchDate || !stretchFrom || !stretchTo) return;
    // Sent exactly as typed — `date`, `from`, `to` — never converted here.
    // The server resolves it against that date's own day timezone; see the
    // component doc comment above.
    if (stretchFrom >= stretchTo) {
      setStretchError(t("studio.location.trackEdits.stretchOrderError"));
      return;
    }
    const label = stretchLabel.trim();
    const ok = await put(
      label
        ? {
            ...stripped(doc),
            namedStretches: [...doc.namedStretches, { date: stretchDate, from: stretchFrom, to: stretchTo, label } as NamedStretch],
          }
        : {
            ...stripped(doc),
            hiddenStretches: [...doc.hiddenStretches, { date: stretchDate, from: stretchFrom, to: stretchTo } as HiddenStretch],
          },
    );
    if (ok) {
      setStretchFrom("");
      setStretchTo("");
      setStretchLabel("");
    }
  }

  async function removeSpot(id: string) {
    if (!doc) return;
    setAsking(null);
    await put({ ...stripped(doc), hiddenSpots: doc.hiddenSpots.filter((s) => s.id !== id) });
  }

  async function removeHiddenStretch(id: string) {
    if (!doc) return;
    setAsking(null);
    await put({ ...stripped(doc), hiddenStretches: doc.hiddenStretches.filter((s) => s.id !== id) });
  }

  async function removeNamedStretch(id: string) {
    if (!doc) return;
    setAsking(null);
    await put({ ...stripped(doc), namedStretches: doc.namedStretches.filter((s) => s.id !== id) });
  }

  // A stretch's own `date`/`from`/`to` is a wall clock, not an instant — it
  // is shown exactly as stored, never re-interpreted through this browser's
  // own zone. `formatShortDate` is the same day formatter the picker below
  // already uses.
  const fmtStretch = (s: { date: string; from: string; to: string }) =>
    `${formatShortDate(s.date)}, ${s.from} – ${s.to}`;

  if (!doc) {
    if (loadError) {
      return (
        <div className="mt-4 rounded-2xl border border-line-quiet p-4">
          <p role="alert" className="text-sm text-coral-600">
            {t("studio.location.trackEdits.loadError")}
          </p>
          <BusyButton
            busy={false}
            type="button"
            onClick={load}
            className="mt-3 min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {t("studio.location.trackEdits.retry")}
          </BusyButton>
        </div>
      );
    }
    return null;
  }

  const spotsAtLimit = doc.hiddenSpots.length >= doc.limits.maxSpots;
  const stretchesAtLimit = doc.hiddenStretches.length >= doc.limits.maxStretches;
  const namedAtLimit = doc.namedStretches.length >= doc.limits.maxNamed;

  return (
    <div className="mt-4 rounded-2xl border border-line-quiet p-4">
      <h3 className="font-display text-base font-semibold text-ink-strong">
        {t("studio.location.trackEdits.title")}
      </h3>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.trackEdits.lede")}</p>

      {/* B2544 — a day's own typed pin is never checked against a hidden
          spot the way the recorded line already is (`deriveTrack`), so a
          day pinned at the hotel still showed the hotel to readers after the
          spot covering it was hidden. Warn the owner here, with a link
          straight to that day's own edit page. */}
      {hiddenDays && hiddenDays.length > 0 && (
        <div className="mt-3 rounded-xl border border-coral-300 bg-coral-50 p-3">
          <p role="alert" className="text-sm font-semibold text-coral-600">
            {t("studio.location.trackEdits.ownPinWarningTitle")}
          </p>
          <ul className="mt-2 space-y-1">
            {hiddenDays.map((day) => (
              <li key={day.slug} className="text-sm text-ink-body">
                <Link
                  href={`${journalPath(username)}/studio/day/edit?slug=${encodeURIComponent(day.slug)}`}
                  className="font-semibold text-ink-strong underline underline-offset-2"
                >
                  {formatShortDate(day.date)}
                  {day.location ? ` · ${day.location}` : ""}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Hidden spots */}
      <h4 className="mt-4 text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.spotsHeading")}</h4>
      {doc.hiddenSpots.length === 0 ? (
        <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.trackEdits.spotsEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {doc.hiddenSpots.map((spot) => (
            <li key={spot.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
              <span className="text-ink-body">
                {t("studio.location.trackEdits.spotRadiusUnit", { radius: String(spot.radiusM) })}
              </span>
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
        </ul>
      )}
      {spotsAtLimit ? (
        <p className="mt-2 text-sm text-ink-secondary">
          {t("studio.location.trackEdits.spotsLimitReached", { max: String(doc.limits.maxSpots) })}
        </p>
      ) : (
        <form onSubmit={(e) => void addSpot(e)} className="mt-2 space-y-2 rounded-xl bg-surface-subtle p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>{t("studio.location.trackEdits.latLabel")}</span>
              <input className={INPUT} value={spotLat} onChange={(e) => setSpotLat(e.target.value)} inputMode="decimal" required />
            </label>
            <label className="block">
              <span className={LABEL}>{t("studio.location.trackEdits.lonLabel")}</span>
              <input className={INPUT} value={spotLon} onChange={(e) => setSpotLon(e.target.value)} inputMode="decimal" required />
            </label>
          </div>
          <label className="block">
            <span className={LABEL}>{t("studio.location.trackEdits.radiusLabel")}</span>
            <input
              className={INPUT}
              value={spotRadius}
              onChange={(e) => setSpotRadius(e.target.value)}
              type="number"
              min={doc.limits.radiusM.min}
              max={doc.limits.radiusM.max}
              required
            />
          </label>
          <BusyButton
            busy={busy}
            type="submit"
            className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50"
          >
            {busy ? t("studio.location.trackEdits.addingSpot") : t("studio.location.trackEdits.addSpot")}
          </BusyButton>
        </form>
      )}

      {/* Hidden and named stretches */}
      <h4 className="mt-4 text-sm font-semibold text-ink-strong">{t("studio.location.trackEdits.stretchesHeading")}</h4>
      {doc.hiddenStretches.length === 0 && doc.namedStretches.length === 0 ? (
        <p className="mt-1 text-sm text-ink-secondary">{t("studio.location.trackEdits.stretchesEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {doc.hiddenStretches.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
              <span className="text-ink-body">{t("studio.location.trackEdits.hiddenRange", { range: fmtStretch(s) })}</span>
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
          {doc.namedStretches.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-subtle px-3 py-2 text-sm">
              <span className="text-ink-body">
                {s.label} · {fmtStretch(s)}
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
      )}
      {stretchesAtLimit && namedAtLimit ? (
        <p className="mt-2 text-sm text-ink-secondary">{t("studio.location.trackEdits.stretchesLimitReached")}</p>
      ) : (
        <form onSubmit={(e) => void addStretch(e)} className="mt-2 space-y-2 rounded-xl bg-surface-subtle p-3">
          <label className="block">
            <span className={LABEL}>{t("studio.location.trackEdits.dateLabel")}</span>
            <select className={INPUT} value={stretchDate} onChange={(e) => setStretchDate(e.target.value)} required>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatShortDate(d)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={LABEL}>{t("studio.location.trackEdits.fromLabel")}</span>
              <input className={INPUT} type="time" value={stretchFrom} onChange={(e) => setStretchFrom(e.target.value)} required />
            </label>
            <label className="block">
              <span className={LABEL}>{t("studio.location.trackEdits.toLabel")}</span>
              <input className={INPUT} type="time" value={stretchTo} onChange={(e) => setStretchTo(e.target.value)} required />
            </label>
          </div>
          <label className="block">
            <span className={LABEL}>{t("studio.location.trackEdits.stretchLabelLabel")}</span>
            <input
              className={INPUT}
              value={stretchLabel}
              onChange={(e) => setStretchLabel(e.target.value)}
              placeholder={t("studio.location.trackEdits.stretchLabelPlaceholder")}
              maxLength={doc.limits.labelMax}
            />
          </label>
          <p className="text-sm text-ink-secondary">{t("studio.location.trackEdits.stretchLabelHint")}</p>
          {stretchError && (
            <p role="alert" className="text-sm text-coral-600">
              {stretchError}
            </p>
          )}
          <BusyButton
            busy={busy}
            type="submit"
            className="min-h-11 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 hover:bg-yellow-300 disabled:opacity-50"
          >
            {busy ? t("studio.location.trackEdits.addingStretch") : t("studio.location.trackEdits.addStretch")}
          </BusyButton>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-coral-600">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="mt-3 text-sm text-ink-strong">
          {t("studio.location.trackEdits.savedNote")}
        </p>
      )}
    </div>
  );
}
