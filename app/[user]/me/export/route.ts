import { isOwner } from "@/lib/contacts/session";
import { DELETION_TTL_MINUTES, requestExport } from "@/lib/deletions";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * The owner asking for a copy of their own journal, from `/[user]/me` — B1295.
 *
 * Beside `/[user]/me/delete`, which is the same shape for the opposite
 * reason: leaving and taking your things with you are the same moment, and
 * the page that offers one now offers the other. This calls `requestExport`
 * and nothing else — the mail still goes to the address in the journal's own
 * `config.json`, and the link in it still does the whole job in one press,
 * because there is nothing to confirm about downloading a copy.
 *
 * Cookie only, the same shape as the delete route beside it: an
 * `Authorization` header is refused before it is read. An agent already has
 * its own door — `GET /<user>/export.zip` with a bearer token — and does not
 * need this one.
 */
const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own page, from a browser. An agent already has its own door: " +
    "GET /<user>/export.zip with a bearer token that carries write:content.",
};

export async function POST(request: Request, { params }: RouteContext<"/[user]/me/export">) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // A button that mails a link is a button that mails a hundred links — the
  // same shape `deletion-confirm` uses for the same reason, on a request
  // rather than a confirm press: three asks an hour is far more than anybody
  // pressing this by hand needs, and far short of what a script could do to a
  // mailbox otherwise.
  const limit = rateLimitFor("export-request", clientIp(request), { max: 3, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const asked = await requestExport(user);
  if (!asked.ok) {
    return Response.json({ error: asked.error, message: asked.message }, { status: asked.status });
  }

  return Response.json({
    ok: true,
    mailedTo: asked.email,
    minutes: DELETION_TTL_MINUTES,
  });
}
