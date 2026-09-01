import { SESSION_SCOPE, SIGNUP_OWNER, issueRelayLink, openAgentSession, resolveSession, revokeSession, signInUrl } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { createJournal, sendWelcome } from "@/lib/journals";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Create a journal.
 *
 * The step that used to be `mkdir` on somebody's server, which meant an agent
 * asked to "set up a travel blog" could get no further than explaining that it
 * could not. It takes the token from `/api/auth/signup/verify`, which proves
 * one thing only: whoever holds it can read the address the journal will be
 * owned by.
 *
 * It answers with an **agent token for the journal it just made**, so the
 * caller can go straight on to creating a trip and writing days. Without that
 * the flow would end by telling the agent to go and ask for another code.
 */
export async function POST(request: Request) {
  if (!isEnabled("signup")) {
    return Response.json({ error: "signup_disabled" }, { status: 404 });
  }

  const limit = rateLimitFor("journals-create", clientIp(request), {
    max: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return Response.json(
      { error: "missing_token", message: "Start at POST /api/auth/signup/request." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="fernscout"' } },
    );
  }

  // Only a signup session reaches this. An agent token for an existing journal
  // is refused here rather than quietly allowed to make more: the address
  // behind it was verified for *that* journal, and a token that can mint
  // journals should have been issued for the purpose.
  const session = await resolveSession(match[1].trim(), "signup");
  if (!session || session.owner !== SIGNUP_OWNER) {
    /**
     * One message for both ways a signup token stops working — spent, or
     * expired — because `resolveSession` answers `null` to both and inventing
     * a distinction it cannot make would be worse than saying less.
     *
     * It names the spent case first all the same. An agent that created a
     * journal and then retried needs to know the first call *worked*, or it
     * reports a failure for something that succeeded.
     */
    return Response.json(
      {
        error: "invalid_token",
        message:
          "A signup token creates one journal and is spent by doing so. If you have already " +
          "created one, that succeeded — do not retry, and use the agent token it gave you. " +
          "Otherwise this token has expired (they last twenty minutes): start again at " +
          "POST /api/auth/signup/request.",
      },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof body[key] === "string" ? (body[key] as string) : undefined;
  const list = (key: string): string[] | undefined =>
    Array.isArray(body[key]) ? (body[key] as unknown[]).filter((v): v is string => typeof v === "string") : undefined;

  const username = str("username") ?? "";
  const title = str("title") ?? "";
  const ownerName = str("ownerName") ?? "";
  const ownerNickname = str("ownerNickname") ?? "";
  if (!username || !title || !ownerName || !ownerNickname) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'A journal needs at least {"username": "…", "title": "…", "ownerName": "…", ' +
          '"ownerNickname": "…"}. `ownerNickname` is what the site calls this person in ' +
          "its own voice and is never guessed from `ownerName` — ask them for it.",
      },
      { status: 400 },
    );
  }

  // Refused rather than quietly read as `public`: this is the field that
  // decides whether a stranger can come across somebody's journal, and an
  // agent that sent "hidden" or "unlisted" meant to ask for something.
  const visibility = str("visibility");
  if (visibility !== undefined && visibility !== "public" && visibility !== "private") {
    return Response.json(
      {
        error: "invalid_request",
        message:
          `visibility must be "public" or "private", got ${JSON.stringify(visibility)}. ` +
          "public is listed on this server's own index; private is reachable by anyone " +
          "sent the address and appears on no list. Neither decides who may read a trip — " +
          "that is the trip's own visibility.",
      },
      { status: 400 },
    );
  }

  const created = createJournal({
    visibility,
    username,
    title,
    tagline: str("tagline"),
    ownerEmail: session.email,
    ownerName,
    ownerNickname,
    startLocation: str("startLocation"),
    defaultLocale: str("defaultLocale"),
    locales: list("locales"),
    baseCurrency: str("baseCurrency"),
    displayCurrencies: list("displayCurrencies"),
    units: str("units") === "imperial" ? "imperial" : "metric",
  });

  if (!created.ok) {
    // 409 for "that name is taken", 400 for "that name is not a name".
    const status = created.error === "username_taken" ? 409 : created.error === "too_many_journals" ? 403 : 400;
    return Response.json(
      {
        error: created.error,
        message: created.message,
        // Only where there is one. A `next` on every refusal would train an
        // agent to stop reading it.
        ...(created.next ? { next: created.next } : {}),
      },
      { status },
    );
  }

  /**
   * The signup token is spent, now that it has been used.
   *
   * The mail that carried the code says "it can create one journal, **once**",
   * and until B55 that was not true: nothing revoked the session, so it lived
   * its full twenty minutes and could create journals until the per-address
   * cap stopped it. Three, not one.
   *
   * **After `createJournal` succeeds and never before.** A token burned on a
   * refused request would strand somebody who mistyped a username — the name
   * is taken, or not a name — with a dead credential and no way back except
   * another round through their email. Every refusal above returns without
   * reaching this line, which is the point of it being here rather than at the
   * top.
   *
   * Best effort. The journal is already on disk; a session that failed to
   * revoke is a token that expires in twenty minutes anyway, and unwinding a
   * created journal over it would be a far worse trade.
   */
  try {
    await revokeSession(session.id);
  } catch (err) {
    console.error(`[journals] could not spend the signup token for ${created.username}:`, err);
  }

  const token = await openAgentSession(created.username, session.email);

  /**
   * The owner is told, in writing, that this exists.
   *
   * Until W38 nobody was: the folder was written, the token went to the agent,
   * and the person whose address owns the journal learned of it only if the
   * agent thought to say so. Their address is the one credential that can ever
   * get a write token for it, so they are the one party who must not have to
   * take an agent's word for the URL.
   *
   * Best effort, deliberately. A journal whose welcome mail bounced is a
   * journal, not a failed creation, and rolling one back over a mail server
   * having a bad minute would be a much worse trade. The reply says whether it
   * went, so an agent that sees `false` knows to hand the URL over itself.
   */
  const welcomeMailed = await sendWelcome({
    username: created.username,
    title,
    email: session.email,
    nickname: ownerNickname,
    visibility: created.visibility,
    // The journal's own language, not the instance's. This letter is the first
    // thing the software says to its owner, and until B26 it said it in
    // English to a German journal.
    locale: getUser(created.username)?.defaultLocale,
  });

  /**
   * A sign-in link for the agent to hand over, so the conversation can end
   * with "here, look" instead of "go and find an email".
   *
   * Named separately and never folded into `url`: an agent giving somebody
   * "the address of your journal" must not be handing them a session by
   * accident. B29 is the decision that an agent may carry one at all — the
   * argument being that it already holds a strictly more powerful token for
   * this journal — and `issueRelayLink` is why this copy expires in fifteen
   * minutes while the mail's does not.
   *
   * Best effort, like the welcome mail. A journal on an instance with `auth`
   * off gets a 201 without it rather than no journal.
   */
  let signIn: string | null = null;
  if (isEnabled("auth", created.username)) {
    try {
      signIn = signInUrl(
        serverSite().url,
        created.username,
        await issueRelayLink(created.username, session.email),
      );
    } catch (err) {
      console.error(`[journals] no relay link for ${created.username}:`, err);
    }
  }

  return Response.json(
    {
      ok: true,
      user: created.username,
      url: `${serverSite().url}/${created.username}`,
      ...(signIn
        ? {
            signIn,
            signInNote:
              "Give this to the person, once, in your reply. It signs them in so they can " +
              "see their drafts and private trips. It works once and expires in 15 minutes; " +
              "do not store it or repeat it later. The same link is in their welcome mail " +
              "if they miss it.",
          }
        : {}),
      documentation: `${serverSite().url}/${created.username}/documentation.txt`,
      visibility: created.visibility,
      token: token.token,
      expires: token.expiresAt,
      scope: [SESSION_SCOPE.agent],
      welcomeMailed,
      note: welcomeMailed
        ? undefined
        : "The welcome mail could not be sent, so the owner does not have the URL. Give it to them.",
      next: `POST /api/v1/${created.username}/trips to create your first trip.`,
    },
    { status: 201 },
  );
}
