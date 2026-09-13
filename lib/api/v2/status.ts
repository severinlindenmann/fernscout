// The two pre-flight reads, assembled — B1608, phase 2 step 3. The wire
// shapes are `instanceStatus`/`journalStatus` in `./schemas/status`; this is
// where each field actually comes from.
//
// Reuses `writableTrips` and `listDrafts` — real domain reads, not response
// glue — rather than v1's own `journalStatus`/`draftQueue`
// (`lib/api/status.ts`), whose shapes carry v1-only fields (`malformed`,
// `suggestions`, `next`, a nested `{count, items}` on drafts) that the v2
// schema does not have and does not want. That does not make the v2 shape
// frozen, though — `drafts` was widened past `{trip, slug}` to include
// `title` and `test` (00-decisions.md, Q14: "widen: yes"; see
// 06-contract-deltas.md), because a caller reading the review queue needs
// to say which day is waiting without a GET per row.
import type { Session } from "../../auth";
import { describeScope } from "../../auth";
import { resolveCapabilities } from "../../capabilities";
import { FEATURE_NAMES, type FeatureName } from "../../config";
import { balanceOf } from "../../credits";
import { POSTCARD_CREDITS } from "../../credits/pricing";
import { COSTS_FORMATS } from "@/importers/costs";
import { importFormats } from "../../gps/api";
import { listInbox } from "../../inbox";
import { getTrips } from "../../trips";
import { storageFor } from "../../storageQuota";
import {
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  VIDEO_FORMATS,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
} from "../../validate/media";
import { listDrafts } from "../entries";
import { writableTrips } from "../auth";
import { v2Slug } from "./days";
import { MEDIA_KINDS } from "./schemas/media";
import type { InstanceStatus, JournalStatus } from "./schemas/status";

/** `GET /api/v2/status` — no journal, no auth. What this server can do and
 * what things cost, read from the same sources `/api/health` reads. */
export function buildInstanceStatus(): InstanceStatus {
  const resolved = resolveCapabilities();
  const capabilities: Partial<Record<FeatureName, boolean>> = {};
  for (const name of FEATURE_NAMES) capabilities[name] = resolved[name].enabled;

  const formats = importFormats();
  // Read from the costs importers directly, not from `importFormats()`.
  // B1624 took the `costs` kind out of that registry — a bank statement no
  // longer arrives through `/import`, it goes to the media door and is read
  // back at `/statements/{src}` — but the formats themselves did not go
  // anywhere, and a caller still has to know which ones this server reads
  // before sending one. A limit belongs where a caller can read it before
  // they hit it (AGENTS.md).
  const bankExport = [...COSTS_FORMATS];
  const gpsHistory = formats.find((f) => f.kind === "gps")?.formats.map((f) => f.id) ?? [];

  return {
    capabilities,
    limits: {
      imageMaxEdge: IMAGE_MAX_EDGE,
      imageMaxBytes: IMAGE_MAX_BYTES,
      videoMaxBytes: VIDEO_MAX_BYTES,
      videoMaxSeconds: VIDEO_MAX_SECONDS,
      itemsPerDay: MAX_ITEMS_PER_DAY,
    },
    media: {
      kinds: [...MEDIA_KINDS],
      imageFormats: [...IMAGE_FORMATS],
      videoFormats: [...VIDEO_FORMATS],
      importFormats: { bank_export: bankExport, gps_history: gpsHistory },
    },
    // Fixed per-send prices only — `lib/helper/credits.ts`'s per-photo and
    // per-second model prices are usage-priced, not a single figure a caller
    // could quote ahead of a call, so they are left out rather than reported
    // as one number that is only ever true by coincidence.
    pricing: { email: 1, whatsapp: 1, postcard: POSTCARD_CREDITS },
  };
}

/**
 * `GET /api/v2/{user}/status` — where this journal and this token stand.
 *
 * Scoping is `writableTrips` and nothing else, same rule as v1's
 * `journalStatus` (`lib/api/status.ts`): a trip-scoped token sees its own
 * trip's drafts and no others.
 *
 * `credits` is one number here rather than v1's null-for-a-scoped-token —
 * the v2 schema declares it a required `int`, with no room for "not this
 * token's business", so a trip-scoped token reads the same balance an owner
 * token would. That is a narrower privacy stance than v1's and is worth a
 * second look before this ships past ALPHA (see the parcel report).
 *
 * `drafts` carries `title` and `test` alongside `trip`/`slug` (00-decisions.md,
 * "drafts+title+test"; Q14 answered "widen: yes") — an agent reading the
 * review queue has to say WHICH day is waiting and whether it is content
 * nobody lived, and `listDrafts` already resolves both, `test` inheriting
 * from the trip the same way B116 fixed for v1. See 06-contract-deltas.md.
 */
export async function buildJournalStatus(user: string, session: Session): Promise<JournalStatus> {
  const trips = await writableTrips(session, getTrips(user));
  // B1633 — `listDrafts` (v1) hands back the bare slug; v2 addresses a day
  // by its whole filename stem. `v2Slug` converts at this boundary so a
  // slug taken straight out of the drafts list is one `GET .../days/{slug}`
  // can actually find, rather than the obvious-and-wrong thing to send.
  const drafts = trips.flatMap((trip) =>
    listDrafts(trip.ref).map((d) => ({
      trip: trip.id,
      slug: v2Slug(d.date, d.slug),
      title: d.title,
      ...(d.test ? { test: d.test } : {}),
    })),
  );
  const storage = await storageFor(user);
  const inbox = listInbox(user);

  return {
    journal: user,
    credits: (await balanceOf(user)) ?? 0,
    drafts,
    trips: trips.map((t) => ({ id: t.id, title: t.title })),
    storage: { usedBytes: storage.usedBytes, maxBytes: storage.limitBytes },
    inbox: { media: inbox.media.length, files: inbox.files.length },
    token: describeScope(session),
  };
}
