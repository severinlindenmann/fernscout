import "server-only";
import { readStagedFile } from "@/lib/staging/store";
import { readManifest, writeManifest, type PhotoRow } from "@/lib/staging/manifest";
import { storeInboxFile, moveInboxFileToDay, updateInboxMeta, type InboxMeta } from "@/lib/inbox";
import { appendWords } from "@/lib/dayReadiness";
import { withStorageQuota } from "@/lib/storageQuota";

/**
 * Move one confirmed day out of staging and into the journal.
 *
 * **The quota is checked here and nowhere earlier.** Staging deliberately
 * costs a journal nothing; the moment bytes cross into `content/<user>` they
 * are the journal's. So this is the one call that can refuse — and it refuses
 * *before* moving anything, because a half-committed day is worse than a
 * refused one.
 *
 * Everything after the move is somebody else's code, on purpose.
 * `storeInboxFile` + `moveInboxFileToDay` put the photographs where
 * `inbox/days/<date>/` expects them, `appendWords` writes the `words.md` that
 * path already reads, and `assemble-day` — not this file — creates the entry.
 * Re-implementing any of it here would be a second answer to a question that
 * already has one.
 *
 * A row's own `date` (set by the person, `PATCH .../extract/run`) wins over
 * whatever `takenAt` EXIF guessed; a dropped row is left exactly where it is,
 * in staging, for the sweep to clear when the run expires — deleting it here
 * would take away the person's chance to change their mind while the run is
 * still alive.
 */
export async function commitDay(
  username: string,
  runId: string,
  date: string,
): Promise<{ moved: number; entry: string | null }> {
  const manifest = readManifest(username, runId);
  if (!manifest) return { moved: 0, entry: null };

  const kept = manifest.photos.filter((p) => !p.dropped && effectiveDate(p) === date);
  const row = manifest.days.find((d) => d.date === date);
  if (kept.length === 0 && !row?.words) return { moved: 0, entry: null };

  const incomingBytes = kept.reduce((sum, p) => sum + p.bytes, 0);

  const move = (): number => {
    let moved = 0;
    for (const photo of kept) {
      const bytes = readStagedFile(username, runId, photo.id);
      // Gone from staging (swept, or never really there) — nothing to move,
      // and no reason to fail the whole day over one missing file.
      if (!bytes) continue;

      const meta: InboxMeta = {
        ...(photo.lat !== undefined ? { lat: photo.lat } : {}),
        ...(photo.lng !== undefined ? { lon: photo.lng } : {}),
        ...(photo.takenAt !== undefined ? { takenAt: photo.takenAt } : {}),
        // A real measurement the camera took, not a guess — same stance
        // `InboxMeta.measuredFrom` already documents for every other door.
        ...(photo.lat !== undefined || photo.takenAt !== undefined ? { measuredFrom: "exif" as const } : {}),
      };
      const { entry } = storeInboxFile(username, "media", photo.filename, bytes, meta);
      moveInboxFileToDay(username, entry.id, date);

      // Caption and visibility were set on the manifest's own row, in the
      // flow — carried across onto the inbox entry now that it has somewhere
      // to sit, never invented here.
      const patch: InboxMeta = {};
      if (photo.caption !== undefined) patch.caption = photo.caption;
      if (photo.visibility !== undefined) patch.visibility = photo.visibility;
      if (Object.keys(patch).length > 0) updateInboxMeta(username, entry.id, patch, date);

      moved += 1;
    }

    // The day's own prose, whatever was said answering any of its questions
    // — already assembled, blank-line separated, on the manifest's own
    // `DayRow.words`. Nothing here adds to it or interprets it.
    if (row?.words) appendWords(username, date, row.words);

    if (row) {
      row.committed = true;
      writeManifest(username, manifest);
    }

    return moved;
  };

  // `storageRefusal`'s own doc comment: markdown writes are deliberately not
  // gated, because a journal that could not correct a typo for want of disk
  // space would be held hostage by the thing it is being asked to fix. A day
  // with no kept photograph — every one of them dropped, only words left —
  // is exactly that case, so it skips the lock and the check entirely rather
  // than being refused over zero incoming bytes.
  if (incomingBytes === 0) return { moved: move(), entry: null };

  const result = await withStorageQuota(username, incomingBytes, move);
  if (!result.ok) return { moved: 0, entry: null };

  // Nothing in this task creates an entry — that is `assemble-day`'s own job,
  // asked for once the date folder has nothing left it is owed. Returning
  // `entry: null` here is honest: this call only ever stages a day folder.
  return { moved: result.value, entry: null };
}

/** The date a kept row belongs to — the person's own edit if they made one,
 *  the camera's own reading otherwise. Never a guess past either of those. */
function effectiveDate(photo: PhotoRow): string | undefined {
  return photo.date ?? photo.takenAt?.slice(0, 10);
}
