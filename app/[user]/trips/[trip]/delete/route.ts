import { isOwner } from "@/lib/contacts/session";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { deleteTrip, humanBytes, summarise } from "@/lib/deletions";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Deleting a trip, from the trip's own page — B1321.
 *
 * B38's rule — an agent never deletes, the mailbox link does — was written
 * for a caller the server cannot see: a token in a conversation, whose "the
 * owner asked me to" is unverifiable. The mail was the way to reach a person.
 * The owner standing on the trip's page with their own browser session *is*
 * that person, already reached, and routing them through their inbox to press
 * a button they are looking at was ceremony with nothing left to prove. So
 * this door exists, the same shape as `visibility/route.ts` and
 * `day/[slug]/unpublish/route.ts` beside it:
 *
 * - **Not under `/api/v1/`.** An agent's `DELETE /api/v1/<user>/trips/<trip>`
 *   is unchanged: still a 202, still a mail, still a link only a mailbox
 *   holds. Nothing a token can reach deletes anything.
 * - **The owner's cookie only.** `isOwner` without the request, and any
 *   `Authorization` header at all is refused before it is read.
 * - **The same remover.** `deleteTrip` — the tables, the folder, the
 *   tombstone and the 410 notice, identical to the mailbox path.
 *
 * `GET` answers what is about to go — days, files, size — so the button's
 * confirmation names the inventory instead of asking blind (B28's lesson,
 * one level down: the number is what makes the question answerable).
 */
const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "Deleting is the owner's own act, from a browser. An agent asks with " +
    "DELETE /api/v1/<user>/trips/<trip>, which mails the owner a confirmation link — " +
    "say a mail is waiting, and stop.",
};

export async function GET(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/delete">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user, trip } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const summary = summarise({ kind: "trip", username: user, tripId: trip });
  if (!summary) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  return Response.json({
    title: summary.title,
    days: summary.days,
    files: summary.files,
    size: humanBytes(summary.bytes),
  });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/delete">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  if (foreignOrigin(request)) {
    return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  }
  const { user, trip } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const summary = summarise({ kind: "trip", username: user, tripId: trip });
  if (!summary) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  // The tombstone's `requestedBy` is the journal's own address, same as the
  // mailbox path records — the cookie has already proved it is this person.
  const email = getUser(user)?.owner.email?.trim().toLowerCase() ?? user;
  await deleteTrip(user, trip, email);
  return Response.json({ ok: true, redirect: `/${user}` });
}
