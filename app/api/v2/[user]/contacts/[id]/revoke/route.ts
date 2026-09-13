// POST /api/v2/{user}/contacts/{id}/revoke — B1623, phase 2 step 4.
//
// Reversible (B213): approving again restores both the journal grant and
// every trip place.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { getContact, revokeContact } from "@/lib/contacts";
import { isEnabled } from "@/lib/capabilities";
import { getUser } from "@/lib/users";
import { contactToDoc, sharedContactContext } from "@/lib/api/v2/social";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/[id]/revoke">) {
  const { user, id } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const before = await getContact(user, id);
  if (!before) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    return ok({ ok: true, contact: contactToDoc({ ...before, status: "blocked" as const }, await sharedContactContext(user)), dryRun: true });
  }

  const contact = await revokeContact(user, id);
  if (!contact) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);
  return ok({ ok: true, contact: contactToDoc(contact, await sharedContactContext(user)) });
}
