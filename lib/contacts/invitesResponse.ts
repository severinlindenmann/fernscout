// The invite-link door's own logic, called only from
// `app/api/web/[user]/invites*` (a cookie, from the owner's own browser) —
// B2295 (one door for readers, B2291).
//
// This used to also back `GET/PUT/DELETE /api/v2/{user}/invites*`, the agent
// bearer door — removed per the owner's decision (B2291 "Design", D1): an
// agent proposes, reads and writes a journal's content, but letting somebody
// in happens only from `/<user>/studio/readers`, in the owner's own browser.
// The functions stayed here (not folded back into the route files) because
// there are two web routes that both need exactly this logic and neither may
// import the other's glue.
import { fail, ok, paginate, readDryRun, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { inviteToDoc } from "@/lib/api/v2/social";
import { inviteWrite } from "@/lib/api/v2/schemas";
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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function invitesListResponse(user: string, request: Request): Promise<Response> {
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

  const all = (await listInvites(user)).map(inviteToDoc);
  const { items, nextCursor } = paginate(all, { limit, cursor }, (d) => d.id);
  return ok({ invites: items, next_cursor: nextCursor });
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
