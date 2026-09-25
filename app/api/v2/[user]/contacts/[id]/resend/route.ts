// POST /api/v2/{user}/contacts/{id}/resend — B1623, phase 2 step 4.
//
// Re-mail the pending invite this row is still waiting on. Rate-limited per
// contact, unchanged from v1: this is the one action here that mails a
// stranger's inbox on every call.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { getContact } from "@/lib/contacts";
import { listInvitesWithLinks } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { sendInviteMail } from "@/lib/contacts/mail";
import { rateLimitFor } from "@/lib/rateLimit";
import { isEnabled } from "@/lib/capabilities";
import { getTrip, tripRef } from "@/lib/trips";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/[id]/resend">) {
  const { user, id } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const contact = await getContact(user, id);
  if (!contact) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);
  if (contact.confirmedAt) {
    return fail("invalid_request", "This address already confirmed itself — there is nothing left to resend.", undefined, 409);
  }

  const limit = rateLimitFor("contact-resend", contact.id, { max: 3, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) {
    return fail("too_many_requests", "Too many resends for this contact recently.", { retryAfter: limit.retryAfter }, 429);
  }

  const via = contact.createdVia ?? "";
  if (!via.startsWith("invite:")) {
    return fail("invalid_request", "This row was not created through an invite, so there is no link to resend.", undefined, 409);
  }
  const invite = (await listInvitesWithLinks(user, serverSite().url)).find(
    (candidate) => candidate.id === via.slice("invite:".length),
  );
  if (!invite || !invite.url) {
    return fail("invalid_request", "The invite behind this row is revoked, expired, or its link cannot be recovered.", undefined, 409);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) return ok({ ok: true, sent: false, dryRun: true });

  const tripTitle = invite.tripId ? (getTrip(tripRef(user, invite.tripId))?.title ?? null) : null;
  const sent =
    (await sendInviteMail(user, journal, {
      email: contact.email,
      locale: pickLocale(contact.locale, journal.defaultLocale),
      kind: invite.kind,
      url: invite.url,
      tripTitle,
    })) !== null;

  return ok({ ok: true, sent });
}
