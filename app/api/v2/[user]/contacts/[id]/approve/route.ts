// POST /api/v2/{user}/contacts/{id}/approve — B1623, phase 2 step 4.
//
// The safety shape this whole area rests on: `approveContact` is the ONLY
// thing in the codebase that writes an `access_grants` row. See
// docs/plans/2026-09-12-api-v2/social.md §2.3.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { approveContact, getContact } from "@/lib/contacts";
import { sendApprovedMail } from "@/lib/contacts/mail";
import { isEnabled } from "@/lib/capabilities";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { contactToDoc, sharedContactContext } from "@/lib/api/v2/social";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/[id]/approve">) {
  const { user, id } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const before = await getContact(user, id);
  if (!before) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);
  if (!before.confirmedAt) {
    return fail(
      "not_confirmed",
      "This address has not confirmed itself yet — approving it now would let somebody in " +
        "nobody has proved can read this address.",
      undefined,
      409,
    );
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    return ok({
      ok: true,
      contact: contactToDoc({ ...before, status: "active" as const }, await sharedContactContext(user)),
      tripsOpened: [],
      dryRun: true,
    });
  }

  const result = await approveContact(user, id);
  if (!result) {
    return fail(
      "not_confirmed",
      "This address has not confirmed itself yet, or there is no such contact — either way, " +
        "approving it now would let somebody in nobody has proved can read this address.",
      undefined,
      409,
    );
  }

  await sendApprovedMail(user, journal, result.contact);

  // Titles, not ids — the owner reads this, not an agent (B244).
  const tripsOpenedTitles = result.tripsOpened.map(
    (tripId) => getTrip(tripRef(user, tripId))?.title ?? tripId,
  );

  return ok({
    ok: true,
    contact: contactToDoc(result.contact, await sharedContactContext(user)),
    tripsOpened: tripsOpenedTitles,
  });
}
