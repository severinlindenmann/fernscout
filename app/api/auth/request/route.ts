import { isEnabled } from "@/lib/capabilities";
import {
  CODE_TTL_MINUTES,
  isEmail,
  issueCode,
  revokeCodes,
  safeDestination,
  signInUrl,
  type SessionKind,
} from "@/lib/auth";
import { sendTransactional } from "@/lib/mail";
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

  /**
   * Where the button in the mail should land — the page the form was sitting
   * on. Only the trip gate sends one; `/<user>/me` deliberately does not, and
   * neither does anything that mails a link without a reader in front of it.
   *
   * **Stored, never echoed.** It goes into the row beside the link's hash and
   * is read back at redemption, so no URL anywhere carries a redirect target
   * somebody can substitute. `safeDestination` refuses anything that is not a
   * path inside this journal — checked here so nothing unusable is written
   * down, and again on the way out, which is the check that counts.
   */
  const destination = safeDestination(username, body.destination);

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
  if (kind === "agent" && !(await mayRequestAgentToken(user, tripId, email))) {
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

  const { code, linkToken } = await issueCode(username, email, kind, destination);
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
          text: `Tap the button to open ${user.title}. It works once, for ${CODE_TTL_MINUTES} minutes.`,
        },
        { kind: "button", text: `Open ${user.title}`, href: signInUrl(base, username, linkToken) },
        {
          kind: "paragraph",
          text: `Or sign in by hand with this code: ${code}`,
        },
      ]
    : [
        { kind: "paragraph", text: `Your code is ${code}. It works for ${CODE_TTL_MINUTES} minutes.` },
        { kind: "button", text: `Open ${user.title}`, href: `${base}/${username}` },
      ];

  const agentBlocks: MailBlock[] = [
    { kind: "paragraph", text: `Your code is ${code}. It works for ${CODE_TTL_MINUTES} minutes.` },
    {
      kind: "paragraph",
      text:
        "Give this code to the agent that asked for it. It will exchange the code " +
        "for a token that can write to your journal for seven days.",
    },
  ];

  /**
   * Guarded, and a failure takes the code back — see the note on the signup
   * route, which had the same defect and lost somebody a working code to it.
   *
   * The answer breaks this endpoint's own rule that every outcome is a 202,
   * and that is fine: "this server could not send mail at all" says nothing
   * about the address, which is the thing the uniform 202 exists to protect.
   */
  try {
    /**
     * Sent whatever the journal's own `features.mail.enabled` says.
     *
     * A one-time code is not a letter to a reader — it is the door. A journal
     * that has switched its mail off has said "do not write to my readers",
     * and reading that as "and lock me out of my own journal" would make the
     * setting unrecoverable: the code is the only way to get a session or a
     * token, so there would be nothing left to switch it back on with. See
     * `sendTransactional` in lib/mail, and B60.
     */
    await sendTransactional(
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
              text:
                `Asked for at ${requestedAt()}. If you have an older mail like this one, ` +
                "its code no longer works — the newest is the only live one.",
            },
            {
              kind: "paragraph",
              text: "If you did not ask for this, ignore it — nothing has changed.",
            },
          ],
          footer: `Sent by ${serverSite().name}.`,
        },
        username,
      ),
      "a one-time sign-in code the recipient just asked for",
    );
  } catch (err) {
    console.error(`[auth] ${kind} code for ${username} could not be sent:`, err);
    await revokeCodes(username, email, kind).catch(() => {});
    return Response.json(
      {
        error: "mail_failed",
        message:
          "The code could not be sent, so no code is live for this address. Try again in a " +
          "minute; if it keeps failing, this server's mail is broken.",
      },
      { status: 503, headers: { "Retry-After": "60" } },
    );
  }

  return accepted;
}

/** `14:32 UTC on 1 September` — enough to tell two identical mails apart,
 * without pretending to know the reader's timezone. */
function requestedAt(): string {
  const now = new Date();
  const time = now.toISOString().slice(11, 16);
  const day = now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `${time} UTC on ${day}`;
}

/**
 * Whether this address may be sent an agent code for this journal.
 *
 * Two ways in. The journal's `owner.email` may write to all of it. Anyone in a
 * trip's `people:` block may write to that trip, and must name it in the
 * request — the code is one address plus one journal, so the trip has to be
 * stated before the token exists rather than chosen afterwards.
 */
async function mayRequestAgentToken(
  user: { username: string; owner: { email?: string } },
  tripId: string,
  email: string,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (user.owner.email === address) return true;
  if (!tripId) return false;
  const trip = getTrip(tripRef(user.username, tripId));
  // `isPersonOn` reads the trip's `people:` block **and** the buddy places the
  // owner has approved (B33), so somebody who joined by link asks for a token
  // through this same door rather than needing to be typed into a file first.
  return trip ? isPersonOn(trip, address) : false;
}
