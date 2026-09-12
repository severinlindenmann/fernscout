// Document mappers shared by the invite and contact routes — B1623, phase 2
// step 4. Lives here, not on one of the route files, because the v2 import
// boundary (test/api-v2-imports.test.ts) refuses ANY import from `app/`
// inside `app/api/v2/**` or `lib/api/v2/**` — including one v2 route file
// reaching into a sibling's — so a mapper two routes both need has to sit
// under `lib/api/v2/` rather than be exported from whichever route landed
// first.
import type { ContactDoc, InviteDoc } from "./schemas";
import { inviteDoc } from "./schemas";
import type { Invite } from "../../contacts/invites";
import type { ContactRecord } from "../../contacts";
import { normaliseEmail } from "../../contacts";
import { relationshipsFor } from "../../contacts/relationships";
import { peopleOf, pendingTripRequestsFor } from "../../tripPeople";
import { getTrips } from "../../trips";
import { getUser } from "../../users";
import type { DayLetterOutcome } from "../../digest/dayLetter";
import type { DayWhatsappOutcome } from "../../digest/dayWhatsapp";
import { maskNumber } from "../../whatsapp";

/** Never carries `url` — only the create response does (a lost link is
 * reissued, never looked up back through this list; the owner's copy of it
 * lives on `listInvitesWithLinks`, which the list route does not call). */
export function inviteToDoc(invite: Invite): InviteDoc {
  return inviteDoc.parse({
    id: invite.id,
    kind: invite.kind === "personal" ? "guest" : invite.kind,
    trip: invite.tripId,
    email: invite.email,
    name: invite.name,
    locale: invite.locale,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
    revokedAt: invite.revokedAt,
    uses: invite.uses,
  });
}

export type ContactDocContext = {
  ownerEmail: string | null;
  trips: { id: string; title: string; people: string[] }[];
  pendingMap: Map<string, string[]>;
};

/** Read once per list, and once per single-document GET — never per row. */
export async function sharedContactContext(owner: string): Promise<ContactDocContext> {
  const user = getUser(owner)!;
  const ownerEmail = user.owner.email ? normaliseEmail(user.owner.email) : null;
  const trips = await Promise.all(
    getTrips(owner).map(async (trip) => ({ id: trip.id, title: trip.title, people: await peopleOf(trip) })),
  );
  const pendingMap = await pendingTripRequestsFor(owner);
  return { ownerEmail, trips, pendingMap };
}

/**
 * `ContactRecord` -> `ContactDoc`, with the two facts every reader needs
 * computed once per request (`sharedContactContext`, never per row):
 * `relationship` (owner? guest? which trips' `people:` name them?) and
 * `pendingTrips` (a buddy-link request nobody has opened yet). Never carries
 * the postal address or the consent booleans — see the comment on
 * `contactDoc` in `./schemas/social.ts`.
 */
export function contactToDoc(contact: ContactRecord, ctx: ContactDocContext): ContactDoc {
  return {
    id: contact.id,
    name: contact.name,
    locale: contact.locale,
    status: contact.status,
    hasPostalAddress: contact.hasPostalAddress,
    createdVia: contact.createdVia,
    createdAt: contact.createdAt,
    confirmedAt: contact.confirmedAt,
    approvedAt: contact.approvedAt,
    lastSeenAt: contact.lastSeenAt,
    relationship: relationshipsFor(
      contact.email,
      ctx.ownerEmail,
      ctx.trips,
      contact.status === "active",
    ),
    pendingTrips: ctx.pendingMap.get(contact.id) ?? [],
  };
}

/**
 * How a `DayLetterOutcome`/`DayWhatsappOutcome` becomes the `results.mail` /
 * `results.whatsapp` shape in the `send` route's response — the same rule
 * v1's `lib/api/dayMail.ts`/`dayWhatsapp.ts` (route glue, not reused here:
 * the v2 import boundary refuses anything under `lib/api/` outside this
 * folder) always applied: a count, never an address; a failure is still
 * visible as its message.
 */
export function mailSendSummary(outcome: DayLetterOutcome): Record<string, unknown> {
  if (!outcome.ok) return { attempted: false, sent: 0, failed: 0, reason: outcome.reason };
  return {
    attempted: true,
    resend: outcome.resend,
    sent: outcome.sent.length,
    failed: outcome.failed.length,
    ...(outcome.failed.length > 0 ? { errors: outcome.failed.map((f) => f.error) } : {}),
  };
}

/** The WhatsApp counterpart — masks any failed number to its last four
 * digits, same as v1's `whatsappSummary`. */
export function whatsappSendSummary(outcome: DayWhatsappOutcome): Record<string, unknown> {
  if (!outcome.ok) {
    return {
      attempted: false,
      sent: 0,
      failed: 0,
      reason: outcome.reason,
      ...(outcome.reason === "no_credits" ? { needed: outcome.needed, balance: outcome.balance } : {}),
    };
  }
  return {
    attempted: true,
    resend: outcome.resend,
    sent: outcome.sent.length,
    failed: outcome.failed.length,
    ...(outcome.failed.length > 0
      ? { errors: outcome.failed.map((f) => ({ to: maskNumber(f.to), error: f.error })) }
      : {}),
  };
}
