import { confirmDeletion } from "@/lib/deletions";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * The button on the confirmation page, and the only thing in this codebase
 * that actually removes a journal.
 *
 * **POST, and only POST.** There is no `GET` here on purpose, and the omission
 * is the point of the whole design. Mail scanners, link previewers and
 * corporate security appliances follow links in mail; a `GET` that destroys a
 * journal will eventually be followed by a robot, and there is no undo. The
 * two places this repository has reasoned about it both land on the same side
 * now: `app/[user]/u/[token]/route.ts` refuses to unsubscribe on GET, because
 * the loss is invisible and irreversible, and `app/[user]/s/[token]` stopped
 * signing anybody in on GET after B142 — the argument that it was harmless
 * ("the worst a scanner can mint is a read session nobody uses") was tested in
 * production and lost. Deletion was never near that line, so the link in the
 * mail lands on a page (`app/[user]/delete/[token]`) and the page's button
 * arrives here. This route is the one that was right first.
 *
 * No `Authorization` header, and that is not an oversight: the credential is
 * the token in the path, which reached the owner's mailbox and nowhere else.
 * An agent token would prove the wrong thing — the agent is the party this
 * step exists to keep out.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/deletions/[token]">,
) {
  const { user, token } = await params;

  // The token is 256 bits, so this is not brute-force protection; it stops a
  // loop from turning one leaked link into a hammer on the filesystem.
  const limit = rateLimitFor("deletion-confirm", clientIp(request), {
    max: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const done = await confirmDeletion(user, token);
  if (!done.ok) {
    // Never a bare 404. Which refusal it was decides what the person does
    // next, and "you already deleted this" is a different sentence from "this
    // link expired".
    const status = done.reason === "unknown" ? 404 : done.reason === "gone" ? 410 : 409;
    return Response.json({ error: done.reason, deleted: false }, { status });
  }

  return Response.json({
    ok: true,
    deleted: true,
    kind: done.kind,
    user: done.username,
    ...(done.tripId ? { trip: done.tripId } : {}),
    title: done.title,
  });
}
