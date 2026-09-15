// The two pre-flight reads — B1587, owner review round. Both read-only.
//
// GET /api/v2/status         — the INSTANCE: what this server can do and
//                              what things cost. No journal, no auth.
// GET /api/v2/{user}/status  — the JOURNAL and the calling agent: where
//                              things stand right now for this token.
//
// The split keeps each fact in one place: a capability is the operator's,
// a draft is the journal's, and neither answers for the other.
import { z } from "zod";
import { FEATURE_NAMES } from "../../../config";
import { MEDIA_KINDS } from "./media";

/** What this instance is able to do, and on what terms. */
export const instanceStatus = z.strictObject({
  /** The operator's plumbing — where the per-journal features block went. */
  capabilities: z.partialRecord(z.enum(FEATURE_NAMES), z.boolean()),
  /** Upload ceilings, readable before hitting them. */
  limits: z.strictObject({
    imageMaxEdge: z.number().int().positive(),
    imageMaxBytes: z.number().int().positive(),
    videoMaxBytes: z.number().int().positive(),
    videoMaxSeconds: z.number().int().positive(),
    itemsPerDay: z.number().int().positive(),
  }),
  /** What the media door accepts: the kinds, and the file formats per kind
   * (MIME types for photos and video, importer names for exports). */
  media: z.strictObject({
    kinds: z.array(z.enum(MEDIA_KINDS)),
    imageFormats: z.array(z.string()),
    videoFormats: z.array(z.string()),
    importFormats: z.strictObject({
      bank_export: z.array(z.string()),
      gps_history: z.array(z.string()),
    }),
  }),
  /** What paid actions cost, in credits — from the operator's own costs
   * block, so an agent can say a price before proposing a postcard. */
  pricing: z.record(z.string(), z.number().nonnegative()),
  /**
   * The source names a caller may never write — B1783.
   *
   * A reading this server looked up carries `source: "open-meteo"`, comes
   * back on every read and in a sync's byte mirror, and is refused by name on
   * the way back in (`day.ts`: "this source name is the server's own"). That
   * refusal is right, and it is only usable if a client can tell which names
   * it applies to before it sends one: B1580 published the list on
   * `/api/health` for exactly this, and a v2 client reads *this* document
   * before it writes, not the operator's page. A client that had to hardcode
   * the name is a client that will be wrong the day a second archive is added
   * — and it was: a folder of 189 synced-down days could not be written back.
   *
   * A deny list, not an enum on the field: every other source is valid,
   * because `source` names whatever actually took the reading and no server
   * can enumerate that.
   */
  weather: z.strictObject({ reservedSources: z.array(z.string()) }),
});

/** Where this journal and this token stand right now. */
export const journalStatus = z.strictObject({
  journal: z.string(),
  /** The journal's credit balance. Nothing an agent holds can raise it.
   * Not an integer: since B987 a balance is stored in hundredths and
   * `balanceOf` hands back the fraction, so `.int()` here answered 500 on
   * every journal whose balance had ever been part-spent (B1756). */
  credits: z.number(),
  /** Days waiting for a person to read back and ask to publish — `title` so
   * an agent can say which one without a GET per row (00-decisions.md,
   * "drafts+title+test"), `test` so it can tell content nobody lived from
   * one worth asking to publish. Widened from `{trip, slug}` per Q14
   * ("widen: yes") — see 06-contract-deltas.md. */
  drafts: z.array(
    z.strictObject({ trip: z.string(), slug: z.string(), title: z.string(), test: z.boolean().optional() }),
  ),
  trips: z.array(z.strictObject({ id: z.string(), title: z.string() })),
  storage: z.strictObject({
    usedBytes: z.number().int().nonnegative(),
    /** null = the instance set no ceiling. */
    maxBytes: z.number().int().positive().nullable(),
  }),
  /** Files that belong to no day yet, per inbox shelf. */
  inbox: z.strictObject({
    media: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  }),
  /** What this token is: journal-wide or scoped to one trip. */
  token: z.strictObject({
    scope: z.enum(["owner", "trip"]),
    trip: z.string().optional(),
    expiresAt: z.string(),
  }),
});

export type InstanceStatus = z.infer<typeof instanceStatus>;
export type JournalStatus = z.infer<typeof journalStatus>;
