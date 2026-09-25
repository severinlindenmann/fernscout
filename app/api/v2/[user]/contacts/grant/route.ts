// POST /api/v2/{user}/contacts/grant — B1904, D11's bearer twin.
//
// `POST /api/v2/{user}/contacts` files a `pending` row an invite still has
// to be clicked and confirmed; `POST .../contacts/{id}/approve` explicitly
// refuses an unconfirmed row (409 `not_confirmed`) — the ordinary door never
// lets a caller skip the address proving itself. D11 is the one capability
// that does skip it: the owner names an address from inside the studio and
// it can read immediately, on the owner's word alone
// (`lib/contacts/grantContactAccess`, `confirmContactByOwner`'s own doc
// comment explains why that is safe there). Until this route, D11 had no
// bearer door — `app/api/helper/[user]/reader/grant/route.ts` is cookie-only
// and says so explicitly — so a person's own agent could not do what the
// owner can do from a browser. This route reuses `grantContactAccess` and
// `sendGrantedMail` verbatim; nothing about the grant's mechanics is
// reimplemented here.
//
// **This is the first v2 endpoint that widens who can read a journal rather
// than changing its content.** Every other owner-authenticated v2 write
// changes a document; this one hands a third party — an address the caller
// merely NAMES, never proves control of — standing read access the moment
// it returns. A leaked bearer token now reaches further than it did before
// this route existed: it can read the journal itself AND deputise a reader
// of its choosing. What still holds, and must keep holding if this route is
// ever touched again: no token, signed URL or other forwardable credential
// is minted here — `grantContactAccess` writes the `access_grants` row
// straight from the server, so a *link* still grants nothing; the mail
// still tells the named address rather than asking it, and carries the
// self-serve manage link that lets it decline everything (the same "way to
// decline" D11 requires); a blocked address is refused, never silently
// re-granted (`requestContact`'s own blocked check); and an address that
// already proved itself through the ordinary door keeps its own
// `confirmed_at` — `confirmContactByOwner`'s `where confirmed_at is null`
// guard is what makes that true, and this route does not bypass it.
import { contactCreate } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { contactToDoc, sharedContactContext } from "@/lib/api/v2/social";
import { grantContactAccess } from "@/lib/contacts";
import { sendGrantedMail } from "@/lib/contacts/mail";
import { pickLocale } from "@/lib/contacts/locale";
import { isEnabled } from "@/lib/capabilities";
import { getUser } from "@/lib/users";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/grant">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = jsonBody.value;
  const result = contactCreate.safeParse(parsed);
  if (!result.success) {
    return fail("invalid_request", "This is not a usable contact.", { problems: problemsFrom(result.error) });
  }
  const input = result.data;
  const locale = pickLocale(input.locale ?? null, null, journal.defaultLocale);

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    const now = new Date().toISOString();
    return ok({
      ok: true,
      contact: {
        id: "(preview)",
        name: input.name,
        locale,
        status: "active",
        hasPostalAddress: false,
        createdVia: "owner-grant",
        createdAt: now,
        confirmedAt: now,
        approvedAt: now,
        lastSeenAt: null,
        relationship: null,
        pendingTrips: [],
      },
      dryRun: true,
    }, { status: 201 });
  }

  const granted = await grantContactAccess(user, { name: input.name, email: input.email, locale });
  if (!granted.ok) {
    return fail(
      "contact_blocked",
      "This address was blocked by the owner and cannot be re-granted access this way.",
      undefined,
      409,
    );
  }

  // Best effort, same rule every other mail in this area follows (B272): the
  // grant already exists by the time this runs, so a send failure here must
  // not undo it — the owner still sees the address as `active` and can
  // resend from the contacts page.
  await sendGrantedMail(user, journal, granted.contact);

  return ok({ ok: true, contact: contactToDoc(granted.contact, await sharedContactContext(user)) }, { status: 201 });
}
