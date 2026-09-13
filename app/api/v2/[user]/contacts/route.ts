// GET/POST /api/v2/{user}/contacts — B1623, phase 2 step 4.
//
// The queue, owner side. `approveContact` remains the only thing that writes
// an `access_grants` row (docs/plans/2026-09-12-api-v2/social.md §2.3); this
// door only lists and creates rows that are `pending` until that call.
//
// Deliberately narrower than social.md's own read/write schema: no postal
// address, no `wantsEmailDigest`/`wantsPostcard`/`wantsWhatsapp` anywhere
// here — see the comment on `contactDoc` in lib/api/v2/schemas/social.ts for
// why, and this ticket's report for the full reasoning.
import { contactCreate } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, paginate, readDryRun } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { contactToDoc, sharedContactContext } from "@/lib/api/v2/social";
import { getContact, listContacts, normaliseEmail, requestContact } from "@/lib/contacts";
import { createInvite, inviteExpiry, inviteLinkUrl } from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { sendInviteMail } from "@/lib/contacts/mail";
import { newId } from "@/lib/db";
import { isEnabled } from "@/lib/capabilities";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  if (!getUser(user)) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const url = new URL(request.url);
  let limit = DEFAULT_LIMIT;
  const limitParam = url.searchParams.get("limit");
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      return fail("invalid_request", `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    }
    limit = n;
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const [all, ctx] = await Promise.all([listContacts(user), sharedContactContext(user)]);
  const docs = all.map((contact) => contactToDoc(contact, ctx));
  const { items, nextCursor } = paginate(docs, { limit, cursor }, (d) => d.id);
  return ok({ contacts: items, next_cursor: nextCursor });
}

export async function POST(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  const journal = getUser(user);
  if (!journal) return fail("no_such_journal", `No journal called "${user}".`, undefined, 404);
  if (!isEnabled("contacts", user)) {
    return fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409);
  }

  const parsed = await request.json().catch(() => null);
  const result = contactCreate.safeParse(parsed);
  if (!result.success) {
    return fail("invalid_request", "This is not a usable contact.", { problems: problemsFrom(result.error) });
  }
  const input = result.data;

  const email = normaliseEmail(input.email);
  const already = (await listContacts(user)).some((c) => c.email === email);
  if (already) {
    return fail("contact_exists", `"${email}" is already a contact of this journal.`, undefined, 409);
  }

  const locale = pickLocale(input.locale ?? null, null, journal.defaultLocale);

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    return ok(
      {
        id: "(preview)",
        name: input.name,
        locale,
        status: "pending",
        hasPostalAddress: false,
        createdVia: "invite:(preview)",
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        approvedAt: null,
        lastSeenAt: null,
        relationship: null,
        pendingTrips: [],
      },
      { status: 201 },
    );
  }

  // The owner typing an address is not the address proving it can be read —
  // reuses the same invite-and-mail machinery `POST /api/v1/{user}/invites`
  // always has, so this row is pre-approved the moment it confirms (B319).
  // No address or channel consent travels with this call — see the module
  // comment; the row starts with neither, exactly as `addSelfContact` does.
  const invite = await createInvite(user, {
    id: newId(),
    kind: "guest",
    name: input.name,
    locale,
    expiresAt: inviteExpiry(),
    email,
  });

  const created = await requestContact(user, {
    name: input.name,
    email,
    locale,
    address: undefined,
    wantsEmailDigest: false,
    wantsPostcard: false,
    wantsWhatsapp: false,
    createdVia: `invite:${invite.id}`,
  });
  if (created.outcome === "ignored") {
    return fail("contact_exists", "This address is blocked and cannot be re-added.", undefined, 409);
  }

  await sendInviteMail(user, journal, {
    email,
    locale,
    kind: "guest",
    url: inviteLinkUrl(serverSite().url, user, "guest", invite.token),
  });

  const contact = await getContact(user, created.contactId);
  if (!contact) return fail("invalid_request", "The contact could not be created.", undefined, 500);
  return ok(contactToDoc(contact, await sharedContactContext(user)), { status: 201 });
}
