// Where an agent stands — B1587, phase 0. Read-only, the pre-flight call.
//
// Capabilities live here (and in /api/health), not in the journal document:
// they are the operator's facts, since the per-journal features block left
// journal config (decided 2026-09-12).
import { z } from "zod";
import { FEATURE_NAMES } from "../../../config";

export const statusDoc = z.strictObject({
  journal: z.string(),
  /** What this instance can do — the operator's plumbing, read-only. */
  capabilities: z.partialRecord(z.enum(FEATURE_NAMES), z.boolean()),
  /** Drafts waiting for a person to read back and ask to publish. */
  drafts: z.array(z.strictObject({ trip: z.string(), slug: z.string() })),
  trips: z.array(z.strictObject({ id: z.string(), title: z.string() })),
  /** Limits a caller can read before hitting them. */
  limits: z.strictObject({
    imageMaxEdge: z.number().int().positive(),
    uploadMaxBytes: z.number().int().positive(),
    storageUsedBytes: z.number().int().nonnegative(),
    storageCeilingBytes: z.number().int().positive(),
  }),
  /** What this token is: journal-wide or scoped to one trip. */
  token: z.strictObject({
    scope: z.enum(["owner", "trip"]),
    trip: z.string().optional(),
    expiresAt: z.string(),
  }),
});

export type StatusDoc = z.infer<typeof statusDoc>;
