// GET/DELETE /api/v2/{user}/inbox — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/content.md §11. Composes with, and never
// duplicates, journalStatus.inbox's counts (./status.ts) — same numbers, so a
// caller who already has a /status response can trust this without re-summing.
import { z } from "zod";

const inboxItem = z.strictObject({
  id: z.string(),
  filename: z.string(),
  bytes: z.number().int().nonnegative(),
  stagedAt: z.string(),
  caption: z.string().optional(),
  /** When the camera says this was taken — off the photograph's own EXIF,
   * never the upload time. Absent when the file carries none (WhatsApp
   * recompresses a photo sent as a photo and strips it) — B1842. */
  takenAt: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  /** `"exif"`/`"probe"` says these were measured, not typed — the one
   * exception to "nothing here is inferred" (`lib/sidecar.ts`). Absent
   * alongside `lat`/`lon`/`takenAt` when the server holds none. */
  measuredFrom: z.enum(["exif", "probe"]).optional(),
});

export const inboxList = z.strictObject({
  counts: z.strictObject({
    media: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  }),
  items: z.strictObject({
    media: z.array(inboxItem),
    files: z.array(inboxItem),
  }),
});

export type InboxList = z.infer<typeof inboxList>;
