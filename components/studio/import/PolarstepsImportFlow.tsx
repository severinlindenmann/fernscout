"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";
import { readZipEntries, readZipEntryBytes, readZipEntryText, type ZipEntry } from "@/lib/zip/readZip";
import type { PolarstepsTrip } from "@/importers/trips/polarsteps";

/** trip.json entries only — `trip/<slug>_<id>/trip.json`, never a nested
 * one a crafted export might add. */
const TRIP_JSON = /^trip\/([^/]+)\/trip\.json$/;
/** One trip.json, capped — a real export's biggest trip is a few hundred
 * kB; 20 MB is a thousand-step trip with every field maxed out. */
const TRIP_JSON_MAX_BYTES = 20 * 1024 * 1024;
const LOCATIONS_JSON_MAX_BYTES = 50 * 1024 * 1024;

type DiscoveredTrip = {
  folder: string;
  entry: ZipEntry;
  trip: PolarstepsTrip;
  photos: number;
  videos: number;
  locationsEntry?: ZipEntry;
};

type TripLog = { folder: string; title: string; status: "importing" | "done" | "refused" | "duplicate"; message?: string; tripId?: string };

/**
 * "Import from Polarsteps" — B2662. Everything about reading the export
 * ZIP happens here, in the browser (`lib/zip/readZip.ts`): a multi-
 * gigabyte `user_data.zip` is read with `File.slice`, never uploaded whole.
 *
 * The write side is three existing doors, never a new one for media or
 * positions: the trip itself through `POST /api/helper/{user}/polarsteps`
 * (B2662's own cookie door onto B2432's `importPolarsteps`), each step's
 * photographs and videos through the studio's existing day-photos door
 * (`/at/{user}/trips/{trip}/day/{slug}/photos`, marked `source: "polarsteps"`),
 * and `locations.json` through the existing gps-kind inbox flow
 * (`/api/helper/{user}/inbox` then `/api/helper/{user}/import`) — the same
 * one `LocationFlow` already uses for any other location history.
 */
export default function PolarstepsImportFlow({ username }: { username: string }) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [trips, setTrips] = useState<DiscoveredTrip[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<TripLog[]>([]);

  async function onFile(picked: File) {
    setFile(picked);
    setTrips(null);
    setReadError(null);
    setReading(true);
    try {
      const entries = await readZipEntries(picked);
      const found: DiscoveredTrip[] = [];
      for (const entry of entries) {
        const match = TRIP_JSON.exec(entry.name);
        if (!match) continue;
        const folder = match[1];
        let trip: PolarstepsTrip;
        try {
          const text = await readZipEntryText(picked, entry, { maxBytes: TRIP_JSON_MAX_BYTES });
          trip = JSON.parse(text) as PolarstepsTrip;
        } catch {
          continue; // not this importer's business to explain a broken trip.json — skip it
        }
        const prefix = `trip/${folder}/`;
        let photos = 0;
        let videos = 0;
        for (const e of entries) {
          if (!e.name.startsWith(prefix)) continue;
          if (e.name.includes("/photos/")) photos++;
          else if (e.name.includes("/videos/")) videos++;
        }
        const locationsEntry = entries.find((e) => e.name === `${prefix}locations.json`);
        found.push({ folder, entry, trip, photos, videos, locationsEntry });
      }
      setTrips(found);
      setSelected(new Set(found.map((f) => f.folder)));
      if (found.length === 0) setReadError(t("studio.polarsteps.error.noTrips"));
    } catch (err) {
      setReadError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  function toggle(folder: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function uploadStepMedia(tripId: string, slug: string, discovered: DiscoveredTrip, stepFolder: string) {
    if (!file) return;
    const prefix = `trip/${discovered.folder}/${stepFolder}/`;
    const entries = (await readZipEntries(file)).filter((e) => e.name.startsWith(prefix) && (e.name.includes("/photos/") || e.name.includes("/videos/")));
    if (entries.length === 0) return;
    const form = new FormData();
    for (const entry of entries) {
      const bytes = await readZipEntryBytes(file, entry);
      const name = entry.name.slice(entry.name.lastIndexOf("/") + 1);
      form.append("files", new File([bytes as BlobPart], name));
    }
    form.append("source", "polarsteps");
    await fetch(`${journalPath(username)}/trips/${encodeURIComponent(tripId)}/day/${encodeURIComponent(slug)}/photos`, {
      method: "POST",
      body: form,
    });
  }

  async function importLocations(discovered: DiscoveredTrip, tripId: string) {
    if (!file || !discovered.locationsEntry) return;
    const text = await readZipEntryText(file, discovered.locationsEntry, { maxBytes: LOCATIONS_JSON_MAX_BYTES });
    const form = new FormData();
    form.append("files", new File([text], "locations.json", { type: "application/json" }));
    const staged = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, { method: "POST", body: form });
    const stagedJson = (await staged.json().catch(() => null)) as { items?: { id: string }[] } | null;
    const inboxId = stagedJson?.items?.[0]?.id;
    if (!staged.ok || !inboxId) return;
    await fetch(`/api/helper/${encodeURIComponent(username)}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inbox: inboxId, commit: true, trips: [tripId] }),
    });
  }

  /** The dry-run preview, per selected trip — ticket B2432/B2662's own
   * sequence ("dry-run preview, then the real run") rather than writing
   * straight away. Shown as the confirm panel's "why" text so the owner
   * sees local dates and step counts before anything is kept. */
  async function openConfirm() {
    if (!trips || !file) return;
    setPreviewing(true);
    const chosen = trips.filter((d) => selected.has(d.folder));
    const lines: string[] = [];
    for (const discovered of chosen) {
      const text = await readZipEntryText(file, discovered.entry, { maxBytes: TRIP_JSON_MAX_BYTES });
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/polarsteps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, dryRun: true }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: true; days?: { date: string }[]; title?: string } | null;
      if (res.ok && body?.days) {
        lines.push(t("studio.polarsteps.preview.line", { title: body.title ?? discovered.trip.name, count: String(body.days.length) }));
      }
    }
    setPreviewText(lines.join(" "));
    setPreviewing(false);
    setConfirming(true);
  }

  async function runImport() {
    if (!trips) return;
    setConfirming(false);
    setRunning(true);
    const chosen = trips.filter((d) => selected.has(d.folder));
    const nextLogs: TripLog[] = chosen.map((d) => ({ folder: d.folder, title: d.trip.name, status: "importing" }));
    setLogs(nextLogs);

    for (const discovered of chosen) {
      const text = await readZipEntryText(file!, discovered.entry, { maxBytes: TRIP_JSON_MAX_BYTES });
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/polarsteps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, dryRun: false }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; tripId: string; stepDays?: Record<string, string> }
        | { error: string; message: string }
        | null;

      if (!res.ok || !body || "error" in body) {
        setLogs((prev) =>
          prev.map((l) =>
            l.folder === discovered.folder
              ? { ...l, status: (body as { error?: string } | null)?.error === "trip_exists" ? "duplicate" : "refused", message: body && "message" in body ? body.message : undefined }
              : l,
          ),
        );
        continue;
      }

      const { tripId, stepDays } = body;
      for (const step of discovered.trip.all_steps) {
        const slug = stepDays?.[String(step.id)];
        if (!slug) continue;
        const stepFolder = `${step.display_slug}_${step.id}`;
        await uploadStepMedia(tripId, slug, discovered, stepFolder);
      }
      await importLocations(discovered, tripId);

      setLogs((prev) => prev.map((l) => (l.folder === discovered.folder ? { ...l, status: "done", tripId } : l)));
    }
    setRunning(false);
  }

  return (
    <div className="space-y-4">
      {!trips && (
        <label className="block cursor-pointer rounded-xl border border-dashed border-line-quiet p-6 text-center text-sm text-ink-secondary">
          <input
            type="file"
            accept=".zip"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void onFile(picked);
            }}
          />
          {reading ? t("studio.polarsteps.reading") : t("studio.polarsteps.drop")}
        </label>
      )}

      {readError && <p role="alert" className="text-sm text-coral-600">{readError}</p>}

      {trips && trips.length > 0 && !running && logs.length === 0 && (
        <div className="space-y-3">
          <ul className="space-y-2">
            {trips.map((d) => (
              <li key={d.folder} className="flex items-start gap-2 rounded-lg border border-line-quiet p-3">
                <input
                  type="checkbox"
                  checked={selected.has(d.folder)}
                  onChange={() => toggle(d.folder)}
                  className="mt-1"
                  aria-label={d.trip.name}
                />
                <div>
                  <p className="font-medium text-ink-body">{d.trip.name}</p>
                  <p className="text-sm text-ink-secondary">
                    {t("studio.polarsteps.tripFacts", {
                      steps: String(d.trip.all_steps.length),
                      photos: String(d.photos),
                      videos: String(d.videos),
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-secondary">{t("studio.polarsteps.notImported")}</p>
          <BusyButton type="button" busy={previewing} disabled={selected.size === 0} onClick={() => void openConfirm()}>
            {t("studio.polarsteps.importButton")}
          </BusyButton>
        </div>
      )}

      {confirming && (
        <ConfirmPanel
          label={t("studio.polarsteps.importButton")}
          question={t("studio.polarsteps.confirm.question", { count: String(selected.size) })}
          details={`${previewText ?? ""} ${t("studio.polarsteps.notImported")}`.trim()}
          confirmLabel={t("studio.polarsteps.confirm.button")}
          onConfirm={() => void runImport()}
          onCancel={() => setConfirming(false)}
        />
      )}

      {logs.length > 0 && (
        <ul className="space-y-2">
          {logs.map((l) => (
            <li key={l.folder} className="rounded-lg border border-line-quiet p-3 text-sm">
              <p className="font-medium text-ink-body">{l.title}</p>
              {l.status === "importing" && <p className="text-ink-secondary">{t("studio.polarsteps.log.importing")}</p>}
              {l.status === "done" && l.tripId && (
                <p>
                  <a className="underline" href={`${journalPath(username)}/trips/${encodeURIComponent(l.tripId)}`}>
                    {t("studio.polarsteps.log.done")}
                  </a>
                </p>
              )}
              {l.status === "duplicate" && <p className="text-ink-secondary">{t("studio.polarsteps.log.duplicate")}</p>}
              {l.status === "refused" && <p className="text-coral-600">{l.message ?? t("studio.polarsteps.log.refused")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
