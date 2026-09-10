import { isOwner } from "@/lib/contacts/session";
import { DELETION_TTL_MINUTES, humanBytes, requestDeletion, summarise } from "@/lib/deletions";

export const dynamic = "force-dynamic";

/**
 * The owner asking to delete their own journal, from `/[user]/me` — B1346.
 *
 * The page that answers "what do I have access to?" could answer "and how do
 * I stop" since `SignOut`, and could not answer "and how do I leave". The only
 * door was `DELETE /api/v1/<user>`, which needs a bearer token — so an owner
 * with a browser and no agent had no way to ask at all.
 *
 * **This is the same ask, not a second mechanism.** It calls `requestDeletion`
 * and nothing else: the mail still goes to the address in the journal's own
 * `config.json`, the link still works once, and the button in that mail is
 * still the only thing that deletes anything. A trip's own page deletes
 * outright (B1321) because the owner standing there is the person the mail was
 * trying to reach; a whole journal is deliberately not that — AGENTS.md keeps
 * it in the mailbox for everybody, and re-proving the address is worth the
 * detour when there is no undo behind it.
 *
 * Cookie only, the same shape as the trip route beside it: an `Authorization`
 * header is refused before it is read, so an agent cannot reach a door that
 * skips its own 202.
 */
const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own page, from a browser. An agent asks with " +
    "DELETE /api/v1/<user>, which mails the owner a confirmation link — " +
    "say a mail is waiting, and stop.",
};

export async function GET(request: Request, { params }: RouteContext<"/[user]/me/delete">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const summary = summarise({ kind: "journal", username: user });
  if (!summary) {
    return Response.json({ error: "no_such_journal" }, { status: 404 });
  }
  return Response.json({
    title: summary.title,
    trips: summary.trips,
    days: summary.days,
    files: summary.files,
    size: humanBytes(summary.bytes),
  });
}

export async function POST(request: Request, { params }: RouteContext<"/[user]/me/delete">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const asked = await requestDeletion({ kind: "journal", username: user });
  if (!asked.ok) {
    return Response.json({ error: asked.error, message: asked.message }, { status: asked.status });
  }
  // The address is echoed back so the page can say where to look — it is the
  // owner's own, and this reader has just proved they hold it.
  return Response.json({
    ok: true,
    deleted: false,
    mailedTo: asked.email,
    minutes: DELETION_TTL_MINUTES,
  });
}
