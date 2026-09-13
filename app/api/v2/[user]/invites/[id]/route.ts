// GET/PUT/DELETE /api/v2/{user}/invites/{id} — B1623, phase 2 step 4.
//
// PUT is the create door (S2/V10) — client-chosen id, matching the pattern
// `.../figures/{id}` already established. An invite has no update once
// created — only "exists" or "revoked" — so a PUT to an id already taken is
// always a refusal, never an edit: `revokeInvite` and a fresh id are how an
// owner changes their mind.
import { inviteWrite } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { contactsReady, inviteToDoc } from "@/lib/api/v2/social";
import {
  createInvite,
  inviteExpiry,
  inviteLinkUrl,
  listInvites,
  revokeInvite,
} from "@/lib/contacts/invites";
import { mailFailedNote } from "@/lib/contacts/inviteMailNote";
import { pickLocale } from "@/lib/contacts/locale";
import { sendInviteMail } from "@/lib/contacts/mail";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

async function guard(request: Request, user: string) {
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth;
  const ready = await contactsReady(user);
  if (!ready.ok) return ready;
  return auth;
}

/**
 * The three verbs' own logic, apart from who is asking — B1595. Each is
 * called here after `requireJournalOwner` + `contactsReady` (bearer), and by
 * `app/api/web/[user]/invites/[id]/route.ts` after its own cookie-only
 * `isOwner` check plus the same `contactsReady` — a v2 route file cannot
 * import a sibling's glue and there is none to duplicate here besides this
 * split.
 */
export async function inviteGetResponse(user: string, id: string): Promise<Response> {
  const invite = (await listInvites(user)).find((row) => row.id === id);
  if (!invite) return fail("not_found", `No invite "${id}" on this journal.`, undefined, 404);
  const doc = inviteToDoc(invite);
  return ok(doc, { etag: etagFor(doc) });
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/invites/[id]">) {
  const { user, id } = await params;
  const guarded = await guard(request, user);
  if (!guarded.ok) return guarded.response;
  return inviteGetResponse(user, id);
}

export async function invitePutResponse(user: string, id: string, request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("invalid_request", "The body must be an invite document.");
  }
  const bodyId = (body as Record<string, unknown>).id;
  if (bodyId !== undefined && bodyId !== id) {
    return fail("invalid_request", `The body's "id" ("${String(bodyId)}") must match the URL ("${id}"), or be left out.`);
  }

  const result = inviteWrite.safeParse({ ...(body as Record<string, unknown>), id });
  if (!result.success) {
    return fail("invalid_request", "This invite document is not usable.", { problems: problemsFrom(result.error) });
  }
  const write = result.data;

  const existing = (await listInvites(user)).find((row) => row.id === id);
  if (existing) {
    return fail(
      "stale_document",
      'An invite with this id already exists. Invites have no update — revoke it ' +
        "(DELETE) and PUT a fresh id if you meant to change it.",
      { current: inviteToDoc(existing) },
      409,
    );
  }

  let tripTitle: string | null = null;
  if (write.kind === "buddy") {
    const trip = getTrip(tripRef(user, write.trip!));
    if (!trip) return fail("unknown_trip", `"${user}" has no trip called "${write.trip}".`, undefined, 404);
    tripTitle = trip.title;
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", "dryRun must be true, false, or absent.");
  }
  if (dryRun) {
    // No mail, no row — a preview cannot mint a token nobody will ever use.
    return ok({ ...write, createdAt: new Date().toISOString(), revokedAt: null, uses: 0 }, { status: 201 });
  }

  const created = await createInvite(user, {
    id,
    kind: write.kind,
    tripId: write.trip ?? null,
    name: write.name,
    locale: write.locale,
    expiresAt: write.expiresAt ?? inviteExpiry(),
    email: write.email ?? null,
  });
  const stored = (await listInvites(user)).find((row) => row.id === created.id);
  if (!stored) return fail("invalid_request", "The invite could not be created.", undefined, 500);

  const url = inviteLinkUrl(serverSite().url, user, write.kind, created.token);

  const sent = write.email
    ? (await sendInviteMail(user, getUser(user)!, {
        email: write.email,
        locale: pickLocale(stored.locale, getUser(user)!.defaultLocale),
        kind: write.kind,
        url,
        tripTitle,
      })) !== null
    : null;

  const doc = inviteToDoc(stored);
  return ok(
    {
      ...doc,
      url,
      ...(write.email ? { note: sent ? undefined : mailFailedNote(write.email, user) } : {}),
    },
    { status: 201 },
  );
}

export async function PUT(request: Request, { params }: RouteContext<"/api/v2/[user]/invites/[id]">) {
  const { user, id } = await params;
  const guarded = await guard(request, user);
  if (!guarded.ok) return guarded.response;
  return invitePutResponse(user, id, request);
}

export async function inviteDeleteResponse(user: string, id: string, request: Request): Promise<Response> {
  const invite = (await listInvites(user)).find((row) => row.id === id);
  if (!invite) return fail("not_found", `No invite "${id}" on this journal.`, undefined, 404);

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) return ok({ id, revoked: true, dryRun: true });

  await revokeInvite(user, id);
  return ok({
    id,
    revoked: true,
    note: "The link stops working. Everybody already approved stays in — revoking an invite " +
      "removes nothing anybody already has.",
  });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]/invites/[id]">) {
  const { user, id } = await params;
  const guarded = await guard(request, user);
  if (!guarded.ok) return guarded.response;
  return inviteDeleteResponse(user, id, request);
}
