"use client";

import { useRef, useState } from "react";
import PhotoStrip, { type PhotoStripItem } from "@/components/extract/PhotoStrip";
import PhotoViewer, { type PhotoViewerItem } from "@/components/extract/PhotoViewer";
import type { PhotoBadge } from "@/components/extract/PhotoTile";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";

/** The whole run's own ceiling — `MAX_FILES_PER_RUN` in
 *  `app/api/helper/[user]/extract/upload/route.ts`. Not imported: that file
 *  pulls in server-only modules a client bundle cannot carry. Kept here as a
 *  literal, checked against the route by `test/extract-upload-step.test.ts`. */
const MAX_FILES_PER_RUN = 500;

export type TileState = "queued" | "sending" | "done" | "failed";
type Tile = { file: File; state: TileState };

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
  onDone,
}: {
  username: string;
  runId: string;
  /**
   * Called after every attempt — the initial send and every retry. `failed`
   * is this attempt's own outstanding count, not a cumulative one: the
   * caller decides whether that means "done" (see `ExtractFlow`, which only
   * shows the summary once `failed` comes back 0) or "still needs the retry
   * button", which this component keeps rendering either way.
   */
  onDone: (uploaded: number, failed: number) => void;
}) {
  const { t } = useI18n();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [busy, setBusy] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
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
    await acquireWakeLock();
    let uploaded = 0;
    // This attempt's own outstanding count — not read back from `tiles`
    // state, which may not have flushed by the time `finally` runs.
    let failed = 0;
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
          uploaded += slice.length;
          setTiles((t) => t.map((x, n) => (slice.includes(n) ? { ...x, state: "done" } : x)));
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
      onDone(uploaded, failed);
    }
  }

  const failed = failedIndices(tiles);
  const queued = tiles.map((_, n) => n);

  return (
    <div>
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
      </ul>

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
        className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong bg-surface-subtle px-5 text-base font-semibold text-ink-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-500 peer-disabled:opacity-50"
      >
        {t("extract.upload.choose")}
      </label>

      <p className="mt-2 text-sm text-ink-secondary">{t("extract.upload.perDay")}</p>
      <p className="mt-1 text-sm text-ink-secondary">{t("extract.upload.icloud")}</p>
      <p className="mt-1 text-sm text-ink-secondary">
        <strong>{t("extract.upload.awake")}</strong> — {t("extract.upload.awakeWhy")}
      </p>

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

      {failed.length > 0 && (
        <p role="status" className="mt-2 text-sm text-red-700">
          {t("extract.upload.failed")}
        </p>
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
      {failed.length > 0 && !busy && (
        <button
          type="button"
          onClick={() => send(failed)}
          className="mt-3 inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action"
        >
          {t("extract.upload.retry", { count: String(failed.length) })}
        </button>
      )}
    </div>
  );
}
