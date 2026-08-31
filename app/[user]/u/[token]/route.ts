import { isEnabled } from "@/lib/capabilities";
import { manageUrl, unsubscribeContact } from "@/lib/contacts";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The address in every `List-Unsubscribe` header.
 *
 * Two callers, two meanings, and the difference matters:
 *
 * - **POST** is the mail client acting on its own — RFC 8058 one-click, the
 *   "Unsubscribe" button Gmail and Apple Mail put next to the sender's name.
 *   It stops everything immediately, because a machine pressed it deliberately.
 * - **GET** is a person clicking the link in the footer, and it only *takes*
 *   them to their details page. Unsubscribing on a GET would mean link
 *   scanners, mail previews and prefetchers quietly unsubscribing people who
 *   never touched anything, which is the classic way to lose a reader without
 *   either of you noticing.
 *
 * Setting the header without handling the POST would be a promise the software
 * does not keep: the client shows an unsubscribe button, the button does
 * nothing, and the reader reaches for "mark as spam" instead.
 */
export async function POST(request: Request, context: RouteContext<"/[user]/u/[token]">) {
  const { user: username, token } = await context.params;
  if (!getUser(username) || !isEnabled("contacts", username)) {
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("contacts-unsubscribe", clientIp(request), {
    max: 40,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const done = await unsubscribeContact(username, token);
  if (!done) return Response.json({ error: "unknown_token" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function GET(_request: Request, context: RouteContext<"/[user]/u/[token]">) {
  const { user: username, token } = await context.params;
  if (!getUser(username) || !isEnabled("contacts", username)) {
    return new Response("Not found", { status: 404 });
  }
  return Response.redirect(manageUrl(serverSite().url, username, token), 302);
}
