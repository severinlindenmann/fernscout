// GET/POST /api/v2/{user}/import/photos — B2195. Photographs handed over by
// the iPhone share sheet into a staging run; the studio's guided import
// resumes it. Trip and day are declined here: the studio decides both.
import { z } from "zod";

const stagedPhoto = z.strictObject({
  id: z.string(),
  filename: z.string(),
  bytes: z.number().int().nonnegative(),
  kind: z.enum(["image", "video"]),
});

const limits = {
  maxFilesPerRequest: z.number().int().positive(),
  maxFilesPerRun: z.number().int().positive(),
  imageBytes: z.number().int().positive(),
  videoBytes: z.number().int().positive(),
  stagedLimitBytes: z.number().int().positive(),
};

export const importPhotosDoc = z.strictObject({
  ...limits,
  stagedBytes: z.number().int().nonnegative(),
  /** Runs holding photographs, so a caller can read back what it handed over. */
  runs: z.array(
    z.strictObject({ runId: z.string(), photos: z.number().int().nonnegative(), expiresAt: z.string(), via: z.literal("share").optional() }),
  ),
});

export const importPhotosResult = z.strictObject({
  runId: z.string(),
  expiresAt: z.string(),
  accepted: z.array(stagedPhoto),
  rejected: z.array(z.strictObject({ filename: z.string(), reason: z.string() })),
  stagedBytes: z.number().int().nonnegative(),
  ...limits,
});
