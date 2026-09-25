// POST /api/v2/{user}/deletions/{token} — B1734, ports
// app/api/v1/[user]/deletions/[token]/route.ts onto the v2 plumbing. Domain
// logic (`confirmDeletion`) is unchanged.
import { confirmDeletion } from "@/lib/deletions";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const dynamic = "force-dynamic";

/**
 * The button on the confirmation page, and the only thing in this codebase
 * that actually removes a journal.
 *
 * **POST, and only POST.** There is no `GET` here on purpose, and the omission
 * is the point of the whole design. Mail scanners, link previewers and
 * corporate security appliances follow links in mail; a `GET` that destroyed
 * a journal would eventually be followed by a robot, and there is no undo.
 *
 * No `Authorization` header, and that is not an oversight: the credential is
 * the token in the path, which reached the owner's mailbox and nowhere else.
 * An agent token would prove the wrong thing — the agent is the party this
 * step exists to keep out. This is the second, human-only half of the two v1
 * routes the v2 migration kept; it is not a document like the ones every
 * other door replaced, and moved here rather than staying behind at
 * `/api/v1`, which is retired (B1734). The mailed link itself never names
 * this address — it lands on `app/[user]/delete/[token]`, which composes
 * this endpoint fresh on every render, so a link already sitting in a mailbox
 * keeps working across this move.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/deletions/[token]">,
) {
  const { user, token } = await params;

  // The token is 256 bits, so this is not brute-force protection; it stops a
  // loop from turning one leaked link into a hammer on the filesystem.
  const limit = rateLimitFor("deletion-confirm", clientIp(request), {
    max: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    const res = fail("too_many_requests", ERROR_CODES.too_many_requests, { retryAfter: limit.retryAfter }, 429);
    res.headers.set("Retry-After", String(limit.retryAfter));
    return res;
  }

  const done = await confirmDeletion(user, token);
  if (!done.ok) {
    // Never a bare 404. Which refusal it was decides what the person does
    // next, and "you already deleted this" is a different sentence from
    // "this link expired".
    if (done.reason === "unknown") return fail("not_found", ERROR_CODES.not_found, undefined, 404);
    if (done.reason === "gone") return fail("gone", ERROR_CODES.gone, undefined, 410);
    if (done.reason === "used") return fail("deletion_link_used", ERROR_CODES.deletion_link_used, undefined, 409);
    return fail("deletion_link_expired", ERROR_CODES.deletion_link_expired, undefined, 409);
  }

  return ok({
    ok: true,
    deleted: true,
    kind: done.kind,
    user: done.username,
    ...(done.tripId ? { trip: done.tripId } : {}),
    title: done.title,
  });
}
