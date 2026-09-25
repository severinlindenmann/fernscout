import "server-only";
import fs from "node:fs";
import path from "node:path";
import { listDayInbox, removeDayInboxFile, dayInboxDir } from "./inbox";
import { storeUploads, type UploadCandidate } from "./api/media";
import { attachGallery } from "./api/entries";

/**
 * Move a date folder's staged photographs onto a just-created entry —
 * Phase 3's own version of what `attachStagedFiles` (`lib/api/staged.ts`)
 * does for the flat inbox, reading from `inbox/days/<date>/` instead.
 *
 * Composes the same two primitives `attachStagedFiles` composes
 * (`storeUploads`, `attachGallery`) rather than calling it, because its id
 * resolution (`findInboxFile`/`removeInboxFile`) only ever looks at the flat
 * bucket, a different location from where Phase 2 stages dated content —
 * see this task's own note in the plan for why widening that search space
 * is the wrong fix.
 */
export async function attachDayFolderMedia(
  username: string,
  ref: string,
  date: string,
  slug: string,
): Promise<{ ok: true; attached: number } | { ok: false; error: string }> {
  // B2081 — the day reads in the order it happened: capture time, then the
  // uploader's own filename. `listDayInbox` lists newest upload first, which
  // numbered a day's photographs backwards (01.jpg was the evening one).
  // A photograph with no capture time sorts after every timed one.
  const staged = listDayInbox(username, date).media.sort(
    (a, b) =>
      (a.takenAt ?? "\uffff").localeCompare(b.takenAt ?? "\uffff") || a.filename.localeCompare(b.filename),
  );
  if (staged.length === 0) return { ok: true, attached: 0 };

  const uploads: UploadCandidate[] = staged.map((entry) => {
    const file = path.join(dayInboxDir(username, date, "media"), entry.id);
    return {
      filename: entry.filename,
      bytes: fs.readFileSync(file),
      caption: entry.caption,
      visibility: entry.visibility,
      // Carried, not copied: the file's one sidecar moves onto the trip with
      // it, every key intact (B1864).
      sidecar: `${file}.meta.json`,
    };
  });

  const written = await storeUploads(ref, slug, uploads);
  if (!written.ok) return { ok: false, error: "invalid_media" };

  const attached = attachGallery(ref, slug, written.items);
  if (!attached.ok) return { ok: false, error: attached.error };

  for (const entry of staged) removeDayInboxFile(username, date, entry.id);
  return { ok: true, attached: attached.attached };
}
