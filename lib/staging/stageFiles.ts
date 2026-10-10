import "server-only";
import path from "node:path";
import { analyseStaged } from "@/lib/extract/analyse";
import { declaresTooManyPixels } from "@/lib/ingest/image";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import { readManifest, writeManifest, type PhotoRow, type RunManifest } from "./manifest";
import { journalStagingBytes, putStagedFile, removeStagedFile } from "./store";
import { IMAGE_MAX_BYTES, JOURNAL_STAGING_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";

/** One request is one batch, not one run. The page sends ten; sixty is the
 *  ceiling so a retry of a big batch still fits in one request. */
export const MAX_FILES_PER_REQUEST = 60;
/** The whole run. Past this the honest answer is "do it in two trips", which
 *  beats a run nobody can finish in one sitting. */
export const MAX_FILES_PER_RUN = 500;

/**
 * Stage a batch into a run — the one implementation behind the studio's
 * cookie door (`POST /api/helper/<user>/studio/upload`) and the bearer door
 * the share sheet uses (`POST /api/v2/<user>/import/photos`, B2195). Pushes
 * nothing onto the manifest: the caller appends `accepted` and writes it.
 */
async function stageFiles(user: string, current: RunManifest, files: File[]) {
  const runId = current.runId;
  // Seeded from the manifest as it stands and grown as the loop accepts —
  // so a duplicate is caught whether it arrives against an earlier request
  // (already on `current.photos`) or twice in this same one (a browser that
  // queued the same file twice, or a retry click still mid-flight).
  const seenIds = new Set(current.photos.map((p) => p.id));

  // Seeded from what this journal is already holding, across every run it
  // owns — B1807. The ceiling is per journal, not per run: a run somebody
  // forgot about still occupies real disk, and refusing only what one run's
  // own bytes would add — while ignoring what is already staged elsewhere —
  // would let three abandoned imports and a fresh one together sail past it.
  let stagedBytes = journalStagingBytes(user);

  const accepted: PhotoRow[] = [];
  const rejected: { filename: string; reason: string }[] = [];
  for (const file of files) {
    if (current.photos.length + accepted.length >= MAX_FILES_PER_RUN) {
      rejected.push({ filename: file.name, reason: "run_full" });
      continue;
    }
    const isVideo = VIDEO_EXTENSIONS.has(path.extname(file.name).toLowerCase());
    if (file.size > (isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES)) {
      rejected.push({ filename: file.name, reason: "too_large" });
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    // A header that claims more pixels than this server decodes never lands
    // in staging — B2205; the thumbnail, the analysis and the commit would
    // each pay for it later.
    if (!isVideo && (await declaresTooManyPixels(bytes))) {
      rejected.push({ filename: file.name, reason: "too_many_pixels" });
      continue;
    }
    const stored = putStagedFile(user, runId, file.name, bytes);
    // Content-addressed, so a retried batch is idempotent: the same photograph
    // twice is one row, and the page's retry button cannot double a day.
    // Not a rejection — nothing was wrong with it — so it is simply not
    // counted a second time in either array, and no new bytes actually
    // landed on disk for it either, so the running total is not charged for
    // it twice.
    if (seenIds.has(stored.id)) continue;
    // Accept what fits and refuse the rest, rather than failing the whole
    // batch: somebody who selects 400 photographs and crosses the line at
    // 380 keeps the 380. Charged against the bytes that actually landed —
    // a photograph this run already holds moves the journal's footprint by
    // nothing, and refusing a retry for crossing a ceiling it does not move
    // is how the retry path breaks near the limit. The file is hashed
    // before that is knowable, so a refusal takes back what it just wrote.
    if (!stored.alreadyPresent && stagedBytes + stored.bytes > JOURNAL_STAGING_MAX_BYTES) {
      removeStagedFile(user, runId, stored.id);
      rejected.push({ filename: file.name, reason: "journal_over_capacity" });
      continue;
    }
    seenIds.add(stored.id);
    if (!stored.alreadyPresent) stagedBytes += stored.bytes;
    accepted.push(analyseStaged(stored, bytes));
  }

  return { accepted, rejected, stagedBytes };
}

// ponytail: in-process queue per journal; holds only while one Node process serves the instance. Multi-process needs a file lock.
const queues = new Map<string, Promise<unknown>>();

/**
 * Stage a batch and append it to the run's manifest, one request at a time per
 * journal (B-2749). The share sheet uploads in parallel; without this each
 * request counted the run and the staging ceiling before its awaits, so several
 * together overshot both. The manifest is re-read inside the lock, so every
 * request sees the files the one before it accepted.
 */
export function stageAndAppend(user: string, current: RunManifest, files: File[]) {
  const run = (queues.get(user) ?? Promise.resolve()).then(async () => {
    const latest = readManifest(user, current.runId) ?? current;
    const { accepted, rejected, stagedBytes } = await stageFiles(user, latest, files);
    const have = new Set(latest.photos.map((p) => p.id));
    latest.photos.push(...accepted.filter((p) => !have.has(p.id)));
    writeManifest(user, latest);
    return { accepted, rejected, stagedBytes };
  });
  const tail = run.catch(() => undefined);
  queues.set(user, tail);
  void tail.then(() => queues.get(user) === tail && queues.delete(user));
  return run;
}
