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
  const staged = listDayInbox(username, date).media;
  if (staged.length === 0) return { ok: true, attached: 0 };

  const uploads: UploadCandidate[] = staged.map((entry) => ({
    filename: entry.filename,
    bytes: fs.readFileSync(path.join(dayInboxDir(username, date, "media"), entry.id)),
    caption: entry.caption,
  }));

  const written = await storeUploads(ref, slug, uploads);
  if (!written.ok) return { ok: false, error: "invalid_media" };

  const attached = attachGallery(ref, slug, written.items);
  if (!attached.ok) return { ok: false, error: attached.error };

  for (const entry of staged) removeDayInboxFile(username, date, entry.id);
  return { ok: true, attached: attached.attached };
}
