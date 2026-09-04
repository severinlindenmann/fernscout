import { LOCALE_LIST } from "@/lib/api/agentCopy";
import { SESSION_SCOPE, SIGNUP_OWNER, issueRelayLink, openAgentSession, resolveSession, revokeSession, signInUrl } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import { createJournal, sendWelcome } from "@/lib/journals";
import { clientIp, rateLimitFor, rateLimitStatus } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;

/**
 * Two budgets, because creating a journal and failing to create one are not
 * the same act — B217.
 *
 * A signup token survives a refused creation, deliberately and in writing:
 * `/agent.md` says "a taken username is worth correcting rather than starting
 * over", so somebody picking a name does not have to go back to their inbox
 * every time one is gone. One bucket counted *attempts*, so the promise held
 * at the credential and broke at the address — three or four corrections and
 * the agent was locked out for the rest of the hour, holding a token that was
 * still perfectly good and standing next to a person who was still waiting.
 *
 * Splitting them keeps the thing the limit is actually for. Name enumeration
 * *is* a sequence of refusals, so refusals still cost — just not against the
 * budget that decides whether the eventual real creation is allowed. Twenty an
 * hour is far more than a conversation about a name needs and far less than a
 * useful sweep of a namespace.
 */
const CREATED = { max: 5, windowMs: HOUR };
const REFUSED = { max: 20, windowMs: HOUR };

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

  const ip = clientIp(request);

  /**
   * Both budgets are *read* here and neither is spent, because which one this
   * request belongs to is not knowable yet. A refusal takes a slot from
   * `REFUSED` on its way out — see `refuse` — and a creation takes one from
   * `CREATED` once it has actually happened.
   */
  const createBudget = rateLimitStatus("journals-create", ip, CREATED);
  if (!createBudget.ok) return tooMany("journals_created", createBudget.retryAfter);
  const refusalBudget = rateLimitStatus("journals-create-refused", ip, REFUSED);
  if (!refusalBudget.ok) return tooMany("failed_attempts", refusalBudget.retryAfter);

  /**
   * Every way this route says no, and the only thing that spends the refusal
   * budget.
   *
   * A helper rather than a call beside each `return` so that a refusal added
   * later cannot quietly become free — the shape of the route is that nothing
   * returns a 4xx except through here.
   */
  const refuse = (
    body: Record<string, unknown>,
    status: number,
    headers?: Record<string, string>,
  ) => {
    rateLimitFor("journals-create-refused", ip, REFUSED);
    return Response.json(body, { status, ...(headers ? { headers } : {}) });
  };

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return refuse(
      { error: "missing_token", message: "Start at POST /api/auth/signup/request." },
      401,
      { "WWW-Authenticate": 'Bearer realm="fernscout"' },
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
    return refuse(
      {
        error: "invalid_token",
        message:
          "A signup token creates one journal and is spent by doing so. If you have already " +
          "created one, that succeeded — do not retry, and use the agent token it gave you. " +
          "Otherwise this token has expired (they last twenty minutes): start again at " +
          "POST /api/auth/signup/request.",
      },
      401,
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
    return refuse(
      {
        error: "invalid_request",
        message:
          'A journal needs at least {"username": "…", "title": "…", "ownerName": "…", ' +
          '"ownerNickname": "…"}. `ownerNickname` is what the site calls this person in ' +
          "its own voice and is never guessed from `ownerName` — ask them for it.",
      },
      400,
    );
  }

  // Required rather than defaulted: this is the field that decides whether a
  // stranger can come across somebody's journal, and silence must not decide
  // it on their behalf any more than an unrecognised value may (B263 — a
  // journal asked to be private was created public because nothing here
  // insisted on an answer).
  const visibility = str("visibility");
  if (visibility === undefined) {
    return refuse(
      {
        error: "invalid_request",
        message:
          'visibility is required — "public" or "private". public is listed on this ' +
          "server's own index, its landing page and its sitemap; private is on none of " +
          "them and reachable by anyone sent the address. There is no default worth " +
          "picking for somebody: ask which they want.",
      },
      400,
    );
  }
  // Refused rather than quietly read as `public`: this is the field that
  // decides whether a stranger can come across somebody's journal, and an
  // agent that sent "hidden" or "unlisted" meant to ask for something.
  if (visibility !== "public" && visibility !== "private") {
    return refuse(
      {
        error: "invalid_request",
        message:
          `visibility must be "public" or "private", got ${JSON.stringify(visibility)}. ` +
          "public is listed on this server's own index; private is reachable by anyone " +
          "sent the address and appears on no list. Neither decides who may read a trip — " +
          "that is the trip's own visibility.",
      },
      400,
    );
  }

  // Required for the same reason: it decides the language of the site's own
  // chrome and of the welcome mail — the first thing this software ever says
  // to the owner — and defaulting it to English on their behalf is exactly
  // the silent decision B263 is about.
  const defaultLocale = str("defaultLocale");
  if (defaultLocale === undefined) {
    return refuse(
      {
        error: "invalid_request",
        message:
          "defaultLocale is required — the language the owner writes in. It sets the " +
          "language of the site's own chrome and of the welcome mail this server sends " +
          "the moment the journal is created. There is no default worth picking for " +
          `somebody: ask which language they write in, and send the code — ${LOCALE_LIST}.`,
      },
      400,
    );
  }
  // Checked against the maintained set rather than stored as whatever string
  // arrives: "Deutsch", "German" and "de-DE" are all things an agent will
  // send, and a journal whose defaultLocale is not one this build ships would
  // render in English while its config claimed otherwise.
  if (!(MAINTAINED_LOCALES as readonly string[]).includes(defaultLocale)) {
    return refuse(
      {
        error: "invalid_request",
        message:
          `defaultLocale must be one of ${LOCALE_LIST}, got ${JSON.stringify(defaultLocale)}. ` +
          'Send the code, not the language\'s name — "Deutsch" and "German" are both "de".',
      },
      400,
    );
  }

  // `locales` stays optional — defaulting it to [defaultLocale] is a real
  // default, not a decision taken on somebody's behalf — but any language it
  // does name is checked against the same maintained set.
  const locales = list("locales");
  if (locales) {
    const bad = locales.find((code) => !(MAINTAINED_LOCALES as readonly string[]).includes(code));
    if (bad !== undefined) {
      return refuse(
        {
          error: "invalid_request",
          message:
            `locales has ${JSON.stringify(bad)}; each entry must be one of ${LOCALE_LIST} — ` +
            "which of them a reader may switch the journal into. Left out, the journal " +
            "offers only defaultLocale.",
        },
        400,
      );
    }
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
    defaultLocale,
    locales,
    baseCurrency: str("baseCurrency"),
    displayCurrencies: list("displayCurrencies"),
    units: str("units") === "imperial" ? "imperial" : "metric",
  });

  if (!created.ok) {
    // 409 for "that name is taken", 400 for "that name is not a name".
    const status = created.error === "username_taken" ? 409 : created.error === "too_many_journals" ? 403 : 400;
    return refuse(
      {
        error: created.error,
        message: created.message,
        // Only where there is one. A `next` on every refusal would train an
        // agent to stop reading it.
        ...(created.next ? { next: created.next } : {}),
      },
      status,
    );
  }

  /**
   * The slot is spent here, on the outcome rather than on the attempt. Five
   * journals an hour from one address is the rule; the four mistyped names in
   * front of this one are not journals and no longer count as though they
   * were.
   */
  rateLimitFor("journals-create", ip, CREATED);

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
              "Give this to the person, once, in your reply, and give it to them now. It " +
              "signs them in so they can see their drafts and private trips. It works once " +
              "and expires in 15 minutes, and asking this server for a sign-in code for " +
              "their address invalidates it early; do not store it or repeat it later. " +
              "Their welcome mail carries a second, standing link to the same place — a " +
              "different token that does not expire, not this one.",
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

/**
 * A 429 that says which budget ran out.
 *
 * The old one was a bare `too_many_requests` with a `retryAfter`, which reads
 * as "the server is busy" — so an agent that had just been refused four
 * usernames had no way to learn that the refusals were what spent the budget,
 * and no way to tell that apart from having created five journals. Two
 * different situations with two different things to say to the person waiting.
 *
 * `reason` is a stable token for the machine and `message` is the sentence to
 * read out; `retryAfter` is unchanged and is still in the header as well.
 */
function tooMany(reason: "journals_created" | "failed_attempts", retryAfter: number): Response {
  const minutes = Math.max(1, Math.ceil(retryAfter / 60));
  return Response.json(
    {
      error: "too_many_requests",
      reason,
      retryAfter,
      message:
        reason === "journals_created"
          ? `This network address has created ${CREATED.max} journals in the last hour, which ` +
            `is the limit. Nothing is wrong with your token. Try again in ${minutes} ` +
            `minute${minutes === 1 ? "" : "s"}, when the oldest one falls out of the window.`
          : `${REFUSED.max} attempts from this network address were refused in the last hour ` +
            `— taken names, names that are not names, or requests missing a field — so this ` +
            `one was not tried. Your token is still good and creating a journal is still ` +
            `allowed; it is the guessing that has stopped. Try again in ${minutes} ` +
            `minute${minutes === 1 ? "" : "s"}, and check the username with the person first.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
