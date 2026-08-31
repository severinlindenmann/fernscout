import { isEnabled } from "@/lib/capabilities";
import { isEmail, issueCode, signInUrl, type SessionKind } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { renderMail, type MailBlock } from "@/lib/mail/template";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { getTrip, tripRef } from "@/lib/trips";
import { isPersonOn } from "@/lib/tripPeople";

export const dynamic = "force-dynamic";

/**
 * Ask for a one-time code.
 *
 * Always answers `202`, whatever happens next. A different answer for a known
 * address than for an unknown one turns this endpoint into a way of asking
 * which of your family are registered, and — for agent codes — which address
 * owns the site. The mail is the side effect; the response carries no signal.
 */
export async function POST(request: Request) {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  // Read before rate-limiting, because which bucket applies depends on what
  // is being asked for.
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const username = typeof body.user === "string" ? body.user : "";
  const kind: SessionKind = body.kind === "agent" ? "agent" : "guest";

  // Agent requests get a smaller bucket than guest ones: they are the path
  // that now says whether an address owns a journal, so enumerating addresses
  // has to stay expensive. A person asking for their own code needs one or two.
  const limit = rateLimitFor(
    kind === "agent" ? "auth-request-agent" : "auth-request",
    clientIp(request),
    { max: kind === "agent" ? 5 : 10, windowMs: 15 * 60 * 1000 },
  );
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  // Optional, and only meaningful for an agent token: which trip the caller is
  // asking to write to. Somebody who is on a trip but does not own the journal
  // gets a token scoped to that trip and nothing else.
  const tripId = typeof body.trip === "string" ? body.trip.trim() : "";

  const accepted = Response.json({ status: "accepted" }, { status: 202 });
  if (!isEmail(email) || !username) return accepted;

  const user = getUser(username);
  if (!user) return accepted;

  /**
   * An agent token can write, so the address has to be one this journal
   * recognises: the owner, or somebody listed on the trip they named.
   *
   * **This answers truthfully, and that is a deliberate trade.** Every other
   * failure on this endpoint returns the same 202, because a status that
   * varied by address would let anyone ask which of somebody's family is
   * registered. Here the cost of that silence fell on the wrong person: an
   * agent asking for a code it was never going to receive waited, retried, and
   * had no way to learn it was knocking on a journal it does not own. Days
   * were lost to it.
   *
   * What leaks is narrower than it looks. Guest codes — the ones tied to a
   * reader's address — still answer 202 for everything, so the "who reads this
   * journal" question is as unanswerable as it was. What a caller can now
   * learn is whether a *given address owns a given journal*, which the journal
   * already tells its own owner and which the rate limit below makes slow to
   * enumerate.
   */
  if (kind === "agent" && !mayRequestAgentToken(user, tripId, email)) {
    console.warn(`[auth] agent code refused for ${username}: not the owner or on that trip`);
    return Response.json(
      {
        error: "not_authorised",
        message:
          `An agent code for "${username}" is only sent to the address that owns it, or to ` +
          `somebody listed on a trip — and "${email.trim()}" is neither. Ask whoever owns the ` +
          `journal which address to use. If you are on one of its trips, name the trip: ` +
          `{"user": "${username}", "email": "…", "kind": "agent", "trip": "<trip-id>"}.`,
      },
      { status: 403 },
    );
  }

  const { code, linkToken } = await issueCode(username, email, kind);
  const base = serverSite().url;

  /**
   * A reader gets a button; an agent gets a code.
   *
   * The button is first and the code is underneath, because one tap is what a
   * person opening this on a phone will actually do, and copying six digits
   * between two devices is where the other kind of reader gives up. Both work,
   * and using the code does not require having ignored the button.
   */
  const guestBlocks: MailBlock[] = linkToken
    ? [
        {
          kind: "paragraph",
          text: `Tap the button to open ${user.title}. It works once, for ten minutes.`,
        },
        { kind: "button", text: `Open ${user.title}`, href: signInUrl(base, username, linkToken) },
        {
          kind: "paragraph",
          text: `Or sign in by hand with this code: ${code}`,
        },
      ]
    : [
        { kind: "paragraph", text: `Your code is ${code}. It works for ten minutes.` },
        { kind: "button", text: `Open ${user.title}`, href: `${base}/${username}` },
      ];

  const agentBlocks: MailBlock[] = [
    { kind: "paragraph", text: `Your code is ${code}. It works for ten minutes.` },
    {
      kind: "paragraph",
      text:
        "Give this code to the agent that asked for it. It will exchange the code " +
        "for a token that can write to your journal for seven days.",
    },
  ];

  await sendMail(
    renderMail(
      email,
      kind === "agent" ? "Your Fernscout agent code" : `Sign in to ${user.title}`,
      {
        // What a phone shows next to the subject. The code, not the link:
        // a reader who only glances at the notification can still type it in.
        preheader: `Your code is ${code}`,
        title: kind === "agent" ? "Agent access code" : `Sign in to ${user.title}`,
        blocks: [
          ...(kind === "agent" ? agentBlocks : guestBlocks),
          {
            kind: "paragraph",
            text: "If you did not ask for this, ignore it — nothing has changed.",
          },
        ],
        footer: `Sent by ${serverSite().name}.`,
      },
      username,
    ),
  );

  return accepted;
}

/**
 * Whether this address may be sent an agent code for this journal.
 *
 * Two ways in. The journal's `owner.email` may write to all of it. Anyone in a
 * trip's `people:` block may write to that trip, and must name it in the
 * request — the code is one address plus one journal, so the trip has to be
 * stated before the token exists rather than chosen afterwards.
 */
function mayRequestAgentToken(
  user: { username: string; owner: { email?: string } },
  tripId: string,
  email: string,
): boolean {
  const address = email.trim().toLowerCase();
  if (user.owner.email === address) return true;
  if (!tripId) return false;
  const trip = getTrip(tripRef(user.username, tripId));
  return trip ? isPersonOn(trip, address) : false;
}
