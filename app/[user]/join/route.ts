import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * What is left of the open guestbook — B37.
 *
 * This used to be a form anybody who knew a username could fill in. It granted
 * nothing (decision 19), and that part of the reasoning was never wrong; what
 * was wrong is that the journal advertised a way in its owner had never
 * offered, and the owner then had a decision to make about a stranger. The
 * door now is the personal link, `/{user}/i/<token>`, and the endpoint behind
 * the form refuses anything without a live one.
 *
 * The address survives as a redirect rather than a 404 because people already
 * sent it to their families. A dead end reads as "the journal is gone" — the
 * same reasoning `app/[user]/s/[token]` gives for never landing a spent link
 * on a 404. `/{user}/me` says the true thing instead: ask the
 * person who sent you for a link.
 */
export async function GET(_request: Request, context: RouteContext<"/[user]/join">) {
  const { user: username } = await context.params;
  if (!getUser(username)) return new Response("Not found", { status: 404 });

  // 308: it is gone for good, and the method is preserved so a stray POST is
  // not quietly turned into a GET of somebody's access page.
  //
  // A relative `Location` rather than `serverSite().url`: this stays on the
  // host the reader is already on, so a self-hoster whose configured site URL
  // has drifted does not bounce their family to somewhere else.
  return new Response(null, { status: 308, headers: { location: `/${username}/me` } });
}
