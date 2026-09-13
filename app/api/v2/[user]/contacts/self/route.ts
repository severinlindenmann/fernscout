// POST /api/v2/{user}/contacts/self — B1623, phase 2 step 4.
//
// The owner, added as their own contact — B1393. A gap in social.md's own
// table (the v1 admin panel's "self" action is not named in its migration
// ledger); kept as its own action here rather than dropped, since nothing
// else in v2 exercises `addSelfContact`. Name and address come from this
// journal's own config.json, never from the request — see `addSelfContact`.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { addSelfContact } from "@/lib/contacts";
import { isEnabled } from "@/lib/capabilities";
import { getUser } from "@/lib/users";
import { contactToDoc, sharedContactContext } from "@/lib/api/v2/social";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/self">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) return ok({ ok: true, dryRun: true });

  const result = await addSelfContact(user);
  if (!result.ok) {
    return fail("invalid_request", result.error, undefined, 409);
  }
  return ok({ ok: true, contact: contactToDoc(result.contact, await sharedContactContext(user)) });
}
