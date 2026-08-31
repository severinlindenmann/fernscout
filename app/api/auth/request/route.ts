import { isEnabled } from "@/lib/capabilities";
import { isEmail, issueCode, type SessionKind } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
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

  const limit = rateLimitFor("auth-request", clientIp(request), {
    max: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.ok) {
    return Response.json(
      { error: "too_many_requests", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const username = typeof body.user === "string" ? body.user : "";
  const kind: SessionKind = body.kind === "agent" ? "agent" : "guest";
  // Optional, and only meaningful for an agent token: which trip the caller is
  // asking to write to. Somebody who is on a trip but does not own the journal
  // gets a token scoped to that trip and nothing else.
  const tripId = typeof body.trip === "string" ? body.trip.trim() : "";

  const accepted = Response.json({ status: "accepted" }, { status: 202 });
  if (!isEmail(email) || !username) return accepted;

  const user = getUser(username);
  if (!user) return accepted;

  // An agent token can write, so the address has to be one this journal
  // recognises: the owner, or somebody listed on the trip they named. There is
  // no self-registration on this path, and the answer is 202 either way — a
  // different status would turn this into an address oracle.
  if (kind === "agent" && !mayRequestAgentToken(user, tripId, email)) {
    console.warn(`[auth] agent code refused for ${username}: not the owner or on that trip`);
    return accepted;
  }

  const { code } = await issueCode(username, email, kind);
  const base = serverSite().url;

  await sendMail(
    renderMail(
      email,
      kind === "agent" ? "Your Fernscout agent code" : `Your code for ${user.title}`,
      {
        preheader: `Your code is ${code}`,
        title: kind === "agent" ? "Agent access code" : "Your sign-in code",
        blocks: [
          { kind: "paragraph", text: `Your code is ${code}. It works for ten minutes.` },
          kind === "agent"
            ? {
                kind: "paragraph",
                text:
                  "Give this code to the agent that asked for it. It will exchange the code " +
                  "for a token that can write to your journal for seven days.",
              }
            : {
                kind: "button",
                text: `Open ${user.title}`,
                href: `${base}/${username}`,
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
  );

  return accepted;
}

/**
 * Whether this address may be sent an agent code for this journal.
 *
 * Two ways in. The journal's `ownerEmail` may write to all of it. Anyone in a
 * trip's `people:` block may write to that trip, and must name it in the
 * request — the code is one address plus one journal, so the trip has to be
 * stated before the token exists rather than chosen afterwards.
 */
function mayRequestAgentToken(
  user: { username: string; ownerEmail?: string },
  tripId: string,
  email: string,
): boolean {
  const address = email.trim().toLowerCase();
  if (user.ownerEmail?.trim().toLowerCase() === address) return true;
  if (!tripId) return false;
  const trip = getTrip(tripRef(user.username, tripId));
  return trip ? isPersonOn(trip, address) : false;
}
