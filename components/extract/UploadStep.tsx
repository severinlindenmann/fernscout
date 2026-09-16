"use client";

import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import StepIndicator from "@/components/extract/StepIndicator";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import type { PhotoBadge } from "@/components/extract/PhotoTile";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import {
  formatGigabytes,
  IMAGE_MAX_BYTES,
  JOURNAL_STAGING_MAX_BYTES,
  JOURNAL_STAGING_WARN_FRACTION,
  VIDEO_MAX_BYTES,
} from "@/lib/validate/media";

/** The whole run's own ceiling — `MAX_FILES_PER_RUN` in
 *  `app/api/helper/[user]/extract/upload/route.ts`. Not imported: that file
 *  pulls in server-only modules a client bundle cannot carry. Kept here as a
 *  literal, checked against the route by `test/extract-upload-step.test.ts`. */
const MAX_FILES_PER_RUN = 500;

/** The wizard's own fixed shape (S2a–S4 of the design) — this is Step 03 of 5,
 *  whether it is showing the picker or the grid mid-upload. */
const TOTAL_STEPS = 5;

export type TileState = "queued" | "sending" | "done" | "failed";
type Tile = { file: File; state: TileState };

/** The upload route's own per-file reasons — `too_large`, `run_full` (both
 *  pre-B1807), and `journal_over_capacity` (B1807's ceiling) — turned into
 *  something a person reads rather than a wire code. */
const REJECT_REASON_KEY: Record<string, TranslationKey> = {
  too_large: "extract.upload.rejected.tooLarge",
  run_full: "extract.upload.rejected.runFull",
  journal_over_capacity: "extract.upload.rejected.overCapacity",
};

/** One key per state — a literal lookup rather than a template string, so
 *  every key `t()` can be asked for stays checked at compile time. */
const STATE_KEY: Record<TileState, TranslationKey> = {
  queued: "extract.upload.state.queued",
  sending: "extract.upload.state.sending",
  done: "extract.upload.state.done",
  failed: "extract.upload.state.failed",
};

/**
 * A tile's badge, from its own upload state — B1803 Task 1.3.
 *
 * `"sending"` gets no badge. A batch (`BATCH` above) goes over the wire as
 * one request with no per-file byte progress `fetch` can report, so a
 * percentage on an in-flight tile would be invented, not read — the same
 * rule that forbids inventing a place or a weather reading applies to a
 * number drawn on screen. The design's `62%` badge is real once this
 * component tracks real per-file progress; until then the tile is left
 * plain rather than lying about how far along it is.
 */
export function badgeForTileState(state: TileState): PhotoBadge | undefined {
  if (state === "done") return { tone: "done" };
  if (state === "failed") return { tone: "failed" };
  if (state === "queued") return { tone: "queued" };
  return undefined;
}

/** One request is ten files, not the whole selection. A batch is one request
 *  with no progress of its own; on mobile data a big one is a long silence,
 *  and a dropped connection costs the batch rather than the whole run. */
const BATCH = 10;

/**
 * "~N min left" from real measured throughput — B1803 Task 3.1.
 *
 * The design's middle chip is `6 coming from iCloud`, which this build
 * cannot honestly show (the File API gives no iCloud-residency signal — see
 * the module docblock). What replaces it has to earn the same trust: a
 * minutes-left figure computed from bytes actually confirmed uploaded in
 * *this* attempt and the real elapsed time since it started, never a guess
 * at a rate. No bytes landed yet, or nothing left to send, and there is
 * nothing true to say — `undefined`, not a number made up to fill the chip.
 */
export function etaMinutes(doneBytes: number, totalBytes: number, elapsedMs: number): number | undefined {
  if (doneBytes <= 0 || elapsedMs <= 0) return undefined;
  const remainingBytes = Math.max(0, totalBytes - doneBytes);
  if (remainingBytes <= 0) return undefined;
  const rate = doneBytes / elapsedMs; // bytes per ms, measured, not assumed
  return Math.max(1, Math.round(remainingBytes / rate / 60000));
}

/** Indices, `size` at a time — pulled out of `send` below so the arithmetic
 *  is checked on its own rather than only by driving the whole component. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Which tiles are `"failed"` right now — one batch failing must never touch
 *  another batch's `"done"` tiles, and this is the read that proves it. */
export function failedIndices(tiles: Tile[]): number[] {
  return tiles.reduce<number[]>((out, t, n) => (t.state === "failed" ? [...out, n] : out), []);
}

/**
 * The upload step — B1751, Task 1.3.
 *
 * Per-file state, not one bar: a single progress bar over a few hundred
 * photographs hides the one thing the person needs, which files failed. Each
 * tile carries its own state, and a failed batch leaves every other batch's
 * files alone and individually retryable (`failedIndices` above is the whole
 * of that guarantee).
 *
 * The screen wake lock is re-taken every time the upload becomes busy again
 * (a retry) rather than assumed to still be held: the system drops it on
 * every `visibilitychange` to hidden and does not hand it back on its own,
 * measured on a real handset in B1750. A locked screen backgrounds the tab
 * and iOS suspends a backgrounded tab's network, so without re-acquiring, the
 * lock protects only until the first interruption.
 */
export default function UploadStep({
  username,
  runId,
  initialStagedBytes,
  onDone,
  onStorage,
}: {
  username: string;
  runId: string;
  /** This journal's staging footprint as `ExtractFlow` last knew it — from
   *  its own `checkResume` call — so the bar can already have a real number
   *  the moment this step mounts rather than waiting on the first batch to
   *  come back. `undefined` on a genuinely fresh journal that has never
   *  listed its runs (nothing staged yet either way, so the bar stays
   *  hidden until a real figure arrives). */
  initialStagedBytes?: number;
  /**
   * Called after every attempt — the initial send and every retry. `failed`
   * is this attempt's own outstanding count, not a cumulative one: the
   * caller decides whether that means "done" (see `ExtractFlow`, which only
   * shows the summary once `failed` comes back 0) or "still needs the retry
   * button", which this component keeps rendering either way.
   */
  onDone: (uploaded: number, failed: number) => void;
  /** The journal's staging total, fresh off the upload route's own response
   *  — B1807. `ExtractFlow` carries it forward so `ResumeScreen` shows the
   *  same real figure the next time this owner sees the resume list, rather
   *  than the number from whenever they last opened it. */
  onStorage?: (usedBytes: number) => void;
}) {
  const { t, tn, locale } = useI18n();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [busy, setBusy] = useState(false);
  // Once `send` has run at least once — the point the design's "Uploading"
  // screen (S3b) takes over from the plain picker. Never reset back to
  // `false`: a finished attempt still shows the bar and chips at 100% while
  // the failure panel (if any) is on screen, same as the design.
  const [started, setStarted] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [rejectionReasons, setRejectionReasons] = useState<string[]>([]);
  const [stagedBytes, setStagedBytes] = useState<number | undefined>(initialStagedBytes);
  const [eta, setEta] = useState<number | undefined>(undefined);
  const lock = useRef<WakeLockSentinel | null>(null);

  async function acquireWakeLock() {
    if (!("wakeLock" in navigator) || lock.current) return;
    try {
      lock.current = await navigator.wakeLock.request("screen");
      // The system releases the lock on its own whenever the tab is hidden
      // and never hands it back — re-request it the moment the tab is
      // visible again, or it protects only until the first interruption.
      lock.current.addEventListener("release", () => {
        lock.current = null;
      });
      document.addEventListener("visibilitychange", onVisibilityChange);
    } catch {
      // Refused — low battery, no user gesture, or unsupported here. The
      // upload still works; the person just has to keep the phone awake
      // themselves, which is what extract.upload.awakeWhy tells them.
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible") void acquireWakeLock();
  }

  async function releaseWakeLock() {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (lock.current) {
      await lock.current.release();
      lock.current = null;
    }
  }

  async function send(indices: number[]) {
    setBusy(true);
    setStarted(true);
    setRejectionReasons([]);
    setEta(undefined);
    await acquireWakeLock();
    let uploaded = 0;
    // This attempt's own outstanding count — not read back from `tiles`
    // state, which may not have flushed by the time `finally` runs.
    let failed = 0;
    // Real bytes confirmed uploaded in this attempt — what `etaMinutes`
    // above turns into a minutes-left figure. Never counts a failed slice:
    // a dropped batch transferred no bytes this attempt kept.
    let uploadedBytes = 0;
    const totalBytes = indices.reduce((sum, n) => sum + tiles[n].file.size, 0);
    const startedAt = Date.now();
    const reasons = new Set<string>();
    try {
      for (const slice of chunk(indices, BATCH)) {
        setTiles((t) => t.map((x, n) => (slice.includes(n) ? { ...x, state: "sending" } : x)));
        const body = new FormData();
        body.append("run", runId);
        for (const n of slice) body.append("file", tiles[n].file, tiles[n].file.name);
        try {
          const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/upload`, {
            method: "POST",
            body,
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as {
            rejected?: { filename: string; reason: string }[];
            stagedBytes?: number;
          };
          // Per-file, not per-batch: a batch that crossed the journal's
          // staging ceiling (or the run's own file count, or one oversized
          // file) still lands whatever fit — B1807's "accept what fits".
          // Matched by filename against this same slice, since the route's
          // own `rejected` list is a per-file reason, not a positional echo
          // of the request.
          const rejectedNames = new Map<string, string>();
          for (const r of data.rejected ?? []) {
            rejectedNames.set(r.filename, r.reason);
            reasons.add(r.reason);
          }
          const rejectedInSlice = slice.filter((n) => rejectedNames.has(tiles[n].file.name));
          setTiles((t) =>
            t.map((x, n) =>
              slice.includes(n) ? { ...x, state: rejectedNames.has(x.file.name) ? "failed" : "done" } : x,
            ),
          );
          uploaded += slice.length - rejectedInSlice.length;
          failed += rejectedInSlice.length;
          uploadedBytes += slice
            .filter((n) => !rejectedInSlice.includes(n))
            .reduce((sum, n) => sum + tiles[n].file.size, 0);
          setEta(etaMinutes(uploadedBytes, totalBytes, Date.now() - startedAt));
          if (data.stagedBytes !== undefined) {
            setStagedBytes(data.stagedBytes);
            onStorage?.(data.stagedBytes);
          }
        } catch {
          // One batch failing leaves every other batch's success intact and
          // the failed tiles individually retryable — a single bar for a
          // few hundred files would hide exactly this.
          failed += slice.length;
          setTiles((t) => t.map((x, n) => (slice.includes(n) ? { ...x, state: "failed" } : x)));
        }
      }
    } finally {
      await releaseWakeLock();
      setBusy(false);
      setEta(undefined);
      setRejectionReasons([...reasons]);
      onDone(uploaded, failed);
    }
  }

  const failed = failedIndices(tiles);
  const queued = tiles.map((_, n) => n);

  return (
    <div>
      <StepIndicator
        total={TOTAL_STEPS}
        current={3}
        label={t("extract.step.ofTotal", { current: "3", total: String(TOTAL_STEPS) })}
      />
      {/* The limits, stated above the picker — B1797, the design's Step 03.
       *  Learning a limit by being rejected after a four-minute selection is
       *  the most expensive way to find it out; real numbers from
       *  lib/validate/media.ts and the upload route's own ceiling. */}
      <ul className="mb-3 divide-y divide-line-faint rounded-xl border border-line-strong text-sm">
        <li className="flex items-center justify-between px-4 py-2.5">
          <span className="text-ink-strong">{t("extract.upload.limits.formats")}</span>
          <span className="text-ink-secondary">{t("extract.upload.limits.formatsValue")}</span>
        </li>
        <li className="flex items-center justify-between px-4 py-2.5">
          <span className="text-ink-strong">{t("extract.upload.limits.upTo")}</span>
          <span className="text-ink-secondary">{t("extract.upload.limits.upToValue", { count: String(MAX_FILES_PER_RUN) })}</span>
        </li>
        <li className="flex items-center justify-between px-4 py-2.5">
          <span className="text-ink-strong">{t("extract.upload.limits.each")}</span>
          <span className="text-ink-secondary">
            {t("extract.upload.limits.eachValue", {
              image: String(Math.round(IMAGE_MAX_BYTES / 1024 / 1024)),
              video: String(Math.round(VIDEO_MAX_BYTES / 1024 / 1024)),
            })}
          </span>
        </li>
        <li className="flex items-center justify-between px-4 py-2.5">
          <span className="text-ink-strong">{t("extract.upload.limits.storage")}</span>
          <span className="text-ink-secondary">
            {t("extract.upload.limits.storageValue", {
              limit: formatGigabytes(JOURNAL_STAGING_MAX_BYTES, locale),
            })}
          </span>
        </li>
      </ul>

      {/* The journal's own staging footprint — B1807. Shown only once it is
       *  worth mentioning: a fresh import at a few percent of the ceiling has
       *  nothing to learn from a bar, and stacking it against B1806's own
       *  countdown bar (on the resume screen, not this one) would read as
       *  two of the same kind of thing. */}
      {stagedBytes !== undefined && stagedBytes >= JOURNAL_STAGING_MAX_BYTES * JOURNAL_STAGING_WARN_FRACTION && (
        <div className="mb-3 rounded-xl border border-line-strong px-4 py-2.5">
          <p className="text-sm text-ink-secondary">
            {t("extract.upload.storageBar", {
              used: formatGigabytes(stagedBytes, locale),
              limit: formatGigabytes(JOURNAL_STAGING_MAX_BYTES, locale),
            })}
          </p>
          <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-line-faint">
            <div
              className="h-full rounded-full bg-yellow-400"
              style={{ width: `${Math.min(100, (stagedBytes / JOURNAL_STAGING_MAX_BYTES) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <input
        id="extract-upload-input"
        type="file"
        multiple
        accept="image/*,video/*"
        disabled={busy}
        onChange={(e) =>
          setTiles([...(e.target.files ?? [])].map((file) => ({ file, state: "queued" as const })))
        }
        className="peer sr-only"
      />
      <label
        htmlFor="extract-upload-input"
        className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-yellow-400 px-5 py-3.5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 peer-disabled:opacity-50"
      >
        <Camera className="h-5 w-5" aria-hidden="true" />
        {t("extract.upload.choose")}
      </label>

      <p className="mt-2 text-sm text-ink-secondary">{t("extract.upload.perDay")}</p>
      <p className="mt-1 text-sm text-ink-secondary">{t("extract.upload.icloud")}</p>
      <p className="mt-1 text-sm text-ink-secondary">
        <strong>{t("extract.upload.awake")}</strong> — {t("extract.upload.awakeWhy")}
      </p>

      {/* The design's "Uploading" screen (S3b) — the bar and the three
       *  chips it draws, minus the one chip this build refuses to invent.
       *  `~N min left` only ever appears once real bytes have actually
       *  landed this attempt; the middle "coming from iCloud" chip stays out
       *  entirely — see `etaMinutes` above and the module docblock. */}
      {started && tiles.length > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-line-faint">
            <div
              className="h-full rounded-full bg-yellow-400 transition-[width]"
              style={{ width: `${tiles.length ? Math.round(((tiles.filter((x) => x.state === "done").length + failed.length) / tiles.length) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">
              {tn("extract.upload.chips.done", tiles.filter((x) => x.state === "done").length, {
                count: String(tiles.filter((x) => x.state === "done").length),
              })}
            </span>
            {eta !== undefined && (
              <span className="rounded-full border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-secondary">
                {tn("extract.upload.chips.etaMinutes", eta, { count: String(eta) })}
              </span>
            )}
          </div>
        </div>
      )}

      {tiles.length > 0 && (
        <div className="mt-3">
          <PhotoStrip
            size="grid"
            columns={4}
            photos={tiles.map(
              (tile, n): PhotoStripItem => ({
                id: `${n}`,
                kind: tile.file.type.startsWith("video/") ? "video" : "image",
                file: tile.file,
                alt: tile.file.name,
                badge: badgeForTileState(tile.state),
              }),
            )}
            onSelect={(id) => setOpenIndex(Number(id))}
          />
          {/* `data-state` on a hidden row per tile — kept so
           *  `test/extract-upload-step-overflow.test.tsx` and any future
           *  per-file assertion can still read a tile's state without
           *  parsing badge text, the same contract the old list offered. */}
          <ul className="sr-only">
            {tiles.map((tile, n) => (
              <li key={`${tile.file.name}-${n}`} data-state={tile.state}>
                {tile.file.name} — {t(STATE_KEY[tile.state])}
              </li>
            ))}
          </ul>
        </div>
      )}

      <PhotoViewer
        items={tiles.map(
          (tile, n): PhotoViewerItem => ({
            id: `${n}`,
            kind: tile.file.type.startsWith("video/") ? "video" : "image",
            file: tile.file,
          }),
        )}
        index={openIndex}
        onClose={() => setOpenIndex(null)}
        onPrev={() => setOpenIndex((i) => (i === null ? null : (i - 1 + tiles.length) % tiles.length))}
        onNext={() => setOpenIndex((i) => (i === null ? null : (i + 1) % tiles.length))}
      />

      {/* The design's failure panel (S3b) — its own explanation and its own
       *  retry button, coral, not a bare red line above the picker's regular
       *  button. */}
      {failed.length > 0 && (
        <div role="status" className="mt-3 rounded-xl border border-coral-400 bg-coral-50 p-4">
          <p className="text-sm font-semibold text-coral-600">
            {tn("extract.upload.failurePanel.title", failed.length, { count: String(failed.length) })}
          </p>
          <p className="mt-1 text-sm text-coral-600">{t("extract.upload.failed")}</p>
          {/* One line per distinct rejection reason, not per file — a
           *  hundred rejected photographs from the same full run is one
           *  sentence, not a hundred. */}
          {rejectionReasons.length > 0 && (
            <ul className="mt-1 text-sm text-coral-600">
              {rejectionReasons.map((reason) => (
                <li key={reason}>{t(REJECT_REASON_KEY[reason] ?? "extract.upload.rejected.other")}</li>
              ))}
            </ul>
          )}
          {!busy && (
            <button
              type="button"
              onClick={() => send(failed)}
              className="mt-3 inline-flex min-h-11 items-center rounded-full bg-coral-600 px-5 text-base font-semibold text-on-deep transition-colors hover:bg-coral-400"
            >
              {t("extract.upload.retry", { count: String(failed.length) })}
            </button>
          )}
        </div>
      )}

      {tiles.length > 0 && !busy && failed.length === 0 && (
        <button
          type="button"
          onClick={() => send(queued)}
          className="mt-3 inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
        >
          {t("extract.upload.send", { count: String(tiles.length) })}
        </button>
      )}

      {/* The design's own reassurance line for this screen — distinct from
       *  `extract.upload.awakeWhy` above, which explains *why* to keep the
       *  screen on before uploading starts. This one is the same promise
       *  once it actually has: the wake lock this component holds is what
       *  makes "you can lock the phone once it says done" true. */}
      {started && (
        <p className="mt-2 text-sm text-ink-secondary">{t("extract.upload.reassure")}</p>
      )}
    </div>
  );
}
