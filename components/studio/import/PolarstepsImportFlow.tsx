"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";
import { readZipEntries, readZipEntryBytes, readZipEntryText, type ZipEntry } from "@/lib/zip/readZip";
import {
  discoverPolarstepsTrips,
  TRIP_JSON_MAX_BYTES,
  LOCATIONS_JSON_MAX_BYTES,
  type DiscoveredTrip,
} from "@/lib/polarsteps/summarise";

type TripLog = {
  folder: string;
  title: string;
  status: "importing" | "done" | "refused" | "duplicate";
  message?: string;
  tripId?: string;
  /** Set when the trip was written but some media or its route did not go through. */
  partial?: boolean;
};

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
  const { t, tn } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [trips, setTrips] = useState<DiscoveredTrip[] | null>(null);
  const [index, setIndex] = useState<ZipEntry[] | null>(null);
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
      setIndex(entries);
      const { trips: found, anyUnreadable } = await discoverPolarstepsTrips(picked, entries);
      setTrips(found);
      setSelected(new Set(found.map((f) => f.folder)));
      if (found.length === 0) setReadError(anyUnreadable ? t("studio.polarsteps.error.unreadable") : t("studio.polarsteps.error.noTrips"));
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

  /** Each of a step's photographs and videos, one request per file so one
   *  refused file (too large, undecodable) never costs the rest. Answers how
   *  many did not go through — never claimed as uploaded when they were not. */
  async function uploadStepMedia(tripId: string, slug: string, discovered: DiscoveredTrip, stepFolder: string): Promise<number> {
    if (!file || !index) return 0;
    const prefix = `trip/${discovered.folder}/${stepFolder}/`;
    const entries = index.filter((e) => e.name.startsWith(prefix) && (e.name.includes("/photos/") || e.name.includes("/videos/")));
    let failed = 0;
    for (const entry of entries) {
      try {
        const bytes = await readZipEntryBytes(file, entry);
        const form = new FormData();
        form.append("files", new File([bytes as BlobPart], entry.name.slice(entry.name.lastIndexOf("/") + 1)));
        form.append("source", "polarsteps");
        // no-refresh: one file of a step mid-import; runImport refreshes once at the end.
        const res = await fetch(`${journalPath(username)}/trips/${encodeURIComponent(tripId)}/day/${encodeURIComponent(slug)}/photos`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    return failed;
  }

  /** `locations.json` through the existing gps-kind inbox flow. Answers
   *  whether it failed — `false` when there was none to send. */
  async function importLocations(discovered: DiscoveredTrip, tripId: string): Promise<boolean> {
    if (!file || !discovered.locationsEntry) return false;
    try {
      const text = await readZipEntryText(file, discovered.locationsEntry, { maxBytes: LOCATIONS_JSON_MAX_BYTES });
      const form = new FormData();
      form.append("files", new File([text], "locations.json", { type: "application/json" }));
      // no-refresh: stages locations.json in the inbox; runImport refreshes once at the end.
      const staged = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, { method: "POST", body: form });
      const stagedJson = (await staged.json().catch(() => null)) as { items?: { id: string }[] } | null;
      const inboxId = stagedJson?.items?.[0]?.id;
      if (!staged.ok || !inboxId) return true;
      // no-refresh: writes positions to gps/ only; runImport refreshes once at the end.
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inbox: inboxId, commit: true, trips: [tripId] }),
      });
      return !res.ok;
    } catch {
      return true;
    }
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
      // no-refresh: a dry run writes nothing.
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/polarsteps`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, dryRun: true }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: true; days?: { date: string }[]; title?: string } | null;
      if (res.ok && body?.days) {
        lines.push(tn("studio.polarsteps.preview.line", body.days.length, { title: body.title ?? discovered.trip.name, count: String(body.days.length) }));
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
      // no-refresh: one trip of several; router.refresh() runs once after the loop below.
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
      let failed = 0;
      for (const step of discovered.trip.all_steps) {
        const slug = stepDays?.[String(step.id)];
        if (!slug) continue;
        failed += await uploadStepMedia(tripId, slug, discovered, `${step.display_slug}_${step.id}`);
      }
      const routeFailed = await importLocations(discovered, tripId);
      const partial = failed > 0 || routeFailed;

      setLogs((prev) => prev.map((l) => (l.folder === discovered.folder ? { ...l, status: "done", tripId, partial } : l)));
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!trips && (
        <label
          className="block cursor-pointer rounded-xl border border-dashed border-line-quiet p-6 text-center text-sm text-ink-secondary"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void onFile(dropped);
          }}
        >
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
          <BusyButton
            type="button"
            busy={previewing}
            disabled={selected.size === 0 || confirming}
            onClick={() => void openConfirm()}
            className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
          >
            {t("studio.polarsteps.importButton")}
          </BusyButton>
        </div>
      )}

      {confirming && (
        <ConfirmPanel
          label={t("studio.polarsteps.importButton")}
          question={tn("studio.polarsteps.confirm.question", selected.size, { count: String(selected.size) })}
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
              {l.status === "done" && l.partial && (
                <p role="alert" className="text-coral-600">
                  {t("studio.polarsteps.log.partial")}
                </p>
              )}
              {l.status === "duplicate" && <p className="text-ink-secondary">{t("studio.polarsteps.log.duplicate")}</p>}
              {l.status === "refused" && <p role="alert" className="text-coral-600">{l.message ?? t("studio.polarsteps.log.refused")}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
