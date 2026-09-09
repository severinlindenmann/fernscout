import "server-only";
import fs from "node:fs";
import { attachGallery } from "./entries";
import { storeUploads, type KeptOriginal, type SkippedUpload, type UploadCandidate } from "./media";
import { findInboxFile, removeInboxFile } from "../inbox";
import type { PhotoVisibility } from "../photos";
import type { GalleryItem } from "../types";
import type { Problem } from "../validate/media";

/**
 * Photographs that are already on this disk, put on a day — B915.
 *
 * The inbox (`lib/inbox.ts`) has held staged files since B663 and exactly one
 * door could take them out of it: the JSON branch of
 * `POST /api/v1/<user>/trips/<trip>/media`, which reads a bearer token. So the
 * files pane in the room (B902) could offer a photograph, resolve it, describe
 * it to a model — and end in a link, because a browser holds a cookie and no
 * token.
 *
 * This is that branch, lifted out whole, so the cookie door
 * (`app/api/helper/[user]/day/attach/route.ts`) and the token door are the
 * same three steps in the same order and there is one implementation of what
 * "attach a staged file" means:
 *
 * 1. resolve every id against disk — an id is a reference and never a fact,
 *    and nothing is written if one of them answers to nothing;
 * 2. through the ordinary pipeline (`storeUploads`), which owns every rule
 *    about formats, sizes, the quota and duplicates. A file byte-for-byte
 *    identical to one already on the day comes back in `skipped` rather than
 *    being stored twice — the inbox names a file by a hash of its bytes, so
 *    the same photograph offered twice is recognised at both ends;
 * 3. **and then** out of the inbox. That order matters: the other one deletes
 *    somebody's only copy on a batch that then fails to store.
 *
 * A caption on the sidecar becomes the gallery item's caption unless the
 * caller gives one, because that is what it was written for.
 */
export type AttachStaged =
  | { ok: false; error: "unknown_inbox_file"; missing: string[] }
  | { ok: false; error: "invalid_media"; problems: Problem[] }
  | {
      ok: true;
      items: GalleryItem[];
      kept: KeptOriginal[];
      advice: string[];
      skipped: SkippedUpload[];
      attached: { ok: true; attached: number } | { ok: false; error: string; bug?: boolean };
      /** The ids that have left the inbox, so a pane that was offering them
       *  can stop — B915. */
      moved: string[];
    };

export async function attachStagedFiles(
  username: string,
  ref: string,
  day: string,
  ids: string[],
  said: { captions?: (string | undefined)[]; visibilities?: (PhotoVisibility | undefined)[] } = {},
): Promise<AttachStaged> {
  const staged: UploadCandidate[] = [];
  const missing: string[] = [];
  for (const [at, id] of ids.entries()) {
    const found = findInboxFile(username, id);
    if (!found || found.entry.kind !== "media") {
      missing.push(id);
      continue;
    }
    staged.push({
      filename: found.entry.filename,
      bytes: fs.readFileSync(found.file),
      caption: said.captions?.[at] || found.entry.caption,
      visibility: said.visibilities?.[at],
    });
  }
  if (missing.length > 0) return { ok: false, error: "unknown_inbox_file", missing };

  const written = await storeUploads(ref, day, staged);
  if (!written.ok) return { ok: false, error: "invalid_media", problems: written.problems };

  for (const id of ids) removeInboxFile(username, id);

  return {
    ok: true,
    items: written.items,
    kept: written.kept,
    advice: written.advice,
    skipped: written.skipped,
    attached: attachGallery(ref, day, written.items),
    moved: ids,
  };
}
