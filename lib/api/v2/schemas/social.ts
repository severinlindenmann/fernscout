// Invites, contacts and channels — B1623, phase 2 step 4. See
// docs/plans/2026-09-12-api-v2/social.md for the design.
//
// None of these are asked-or-declined documents (decision 3's carve-out):
// an invite or a contact is a plain resource, not something assembled section
// by section, so there is no `declined` map here.
import { z } from "zod";
import { ID_RE } from "../../../tripWrite";
import { isoInstant } from "./shared";

/** `personal` is retired as something a caller may CREATE (folded into
 * `guest` — the C-cut in social.md §3); the read side still resolves an old
 * `personal` row, which `lib/contacts/invites.ts`'s own `toKind` already
 * guarantees without this schema's help. */
export const INVITE_KINDS = ["guest", "buddy"] as const;

export const inviteWrite = z
  .strictObject({
    /** Client-chosen, forever (rule 6). */
    id: z.string().regex(ID_RE),
    kind: z.enum(INVITE_KINDS),
    /** Required for `buddy`, refused for `guest` — a guest link is
     * journal-wide (B41). */
    trip: z.string().regex(ID_RE).optional(),
    /** The owner vouching for an address — mails the link and pre-approves
     * it (B319). Absent = a link to copy and hand over another way. */
    email: z.email().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    locale: z.string().optional(),
    /** Absent = 30 days (server default) — never `null`; a link that never
     * expires is the shared password again, wearing a URL. */
    expiresAt: isoInstant.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === "buddy" && !val.trip) {
      ctx.addIssue({ code: "custom", path: ["trip"], message: "A buddy link needs a trip." });
    }
    if (val.kind === "guest" && val.trip !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["trip"],
        message: "A guest link is journal-wide and refuses a trip. Mark the trip `private` to hold it back instead.",
      });
    }
  });

export const inviteDoc = z
  .strictObject({
    id: z.string().regex(ID_RE),
    kind: z.enum(INVITE_KINDS),
    trip: z.string().regex(ID_RE).nullable(),
    email: z.email().nullable(),
    name: z.string().nullable(),
    locale: z.string().nullable(),
    expiresAt: isoInstant.nullable(),
    createdAt: isoInstant,
    revokedAt: isoInstant.nullable(),
    uses: z.number().int().nonnegative(),
    /** Present exactly once, in the create response — see route. */
    url: z.string().optional(),
  })
  .strict();
export type InviteDoc = z.infer<typeof inviteDoc>;

export const CONTACT_STATUSES = ["pending", "active", "blocked"] as const;

/**
 * **Deliberately narrower than social.md §2.3.** The dispatch brief for this
 * ticket says, in its own words: "A contact's postal address and its
 * explicit postcard/digest consent are the most sensitive rows in the
 * database. Nothing you build reads them out" — and its own test brief adds
 * "a contacts listing carries no email or postal address". `/api/v2` is the
 * bearer (agent-reachable) door — an agent holding a journal's token is
 * exactly the caller those instructions mean to keep away from an address,
 * whichever kind, even though the owner's own cookie-only
 * `/api/contacts/admin` page (untouched by this ticket) still shows all of
 * it to the owner in their own browser. So neither address, and the three
 * consent booleans (`wantsEmailDigest`/`wantsPostcard`/`wantsWhatsapp`), are
 * ever read back here — `hasPostalAddress` survives as the one bit that
 * says whether something is on file without saying what it is, matching how
 * `GET .../postcards/recipients` already answers with a name, a town and a
 * country and never the address itself. `email` IS still accepted on write
 * (`contactCreate`/`contactPatch`) — it is how the owner names who to mail —
 * but it is echoed back to nobody; see this ticket's report for the full
 * reasoning, since this narrows the design doc rather than following it.
 */
export const contactCreate = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  locale: z.string().optional(),
});

/** Owner corrections — every field optional, `PATCH`'s whole contract. */
export const contactPatch = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().optional(),
  locale: z.string().optional(),
});

export const contactDoc = z.strictObject({
  id: z.string(),
  name: z.string().nullable(),
  locale: z.string().nullable(),
  status: z.enum(CONTACT_STATUSES),
  hasPostalAddress: z.boolean(),
  createdVia: z.string().nullable(),
  createdAt: isoInstant,
  confirmedAt: isoInstant.nullable(),
  approvedAt: isoInstant.nullable(),
  lastSeenAt: isoInstant.nullable(),
  relationship: z
    .strictObject({
      owner: z.boolean(),
      guest: z.boolean(),
      buddyOf: z.array(z.strictObject({ id: z.string(), title: z.string() })),
    })
    .nullable(),
  /** Trip ids this contact has asked to join that nobody has opened yet —
   * v1's `pendingTripRequestsFor`, promoted onto the API (social.md §2.3). */
  pendingTrips: z.array(z.string()),
});
export type ContactDoc = z.infer<typeof contactDoc>;

export const CHANNEL_NAMES = ["mail", "whatsapp"] as const;

/** Plain optional, deliberately against the asked-or-declined default (rule
 * 2's carve-out): a mute switch is a toggle with an existing value, not a
 * section of a document being assembled from nothing. */
export const channelsPatch = z.strictObject({
  mail: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

/** `null` where the server does not offer the channel at all, so a switch
 * that cannot exist never reads back as a confident `false`. */
export const channelsDoc = z.strictObject({
  mail: z.boolean().nullable(),
  whatsapp: z.boolean().nullable(),
});

export const SEND_CHANNELS = ["mail", "whatsapp"] as const;

export const daySend = z.strictObject({
  channels: z.array(z.enum(SEND_CHANNELS)).min(1),
});
