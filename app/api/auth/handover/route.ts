import { SESSION_SCOPE, SESSION_TTL_MS, exchangeHandover, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * An agent's first call, when it was handed a prompt instead of a code — B283.
 *
 * The owner's page printed a `handover` credential that lasts twenty minutes
 * and does exactly one thing. This is the one thing: exchange it for a
 * seven-day agent token of the agent's own, and spend it in the process.
 *
 * `POST /api/v1/journals` is the shape this follows, including the part that
 * matters most in practice — a **spent** credential gets a sentence saying so
 * rather than a bare 401. An agent that reads "expired or already used" asks
 * the person for a fresh one; an agent that reads `401` retries, and then
 * tells them the site is broken.
 *
 * No user in the path. The handover session carries its journal, so taking the
 * name from the request as well would be a second answer to a question already
 * settled — and the wrong one to trust, since it comes from the caller.
 */
export async function POST(request: Request) {
  if (!isEnabled("auth")) {
    return Response.json(
      {
        error: "auth_disabled",
        message: "This server has authentication off entirely. /api/health says what is on.",
      },
      { status: 404 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!bearer) {
    return Response.json(
      {
        error: "missing_token",
        message:
          "Send the credential the owner gave you as `Authorization: Bearer <handover>`. " +
          "If you do not have one, ask them to open their journal's access page and copy " +
          "the block it offers.",
      },
      { status: 401 },
    );
  }

  // `"handover"` and nothing else. `resolveSession` compares the row's kind
  // against what is asked for, so an agent token, a guest cookie value or a
  // signup token presented here is refused by the same line — and a handover
  // credential is refused on every other route for the mirror-image reason.
  const session = await resolveSession(bearer, "handover");
  if (!session) {
    return Response.json(
      {
        error: "invalid_handover",
        message:
          `A handover credential lasts ${SESSION_TTL_MS.handover / 60_000} minutes and is ` +
          "spent by being exchanged once. This one is expired, already used, revoked, or not " +
          "a handover credential at all. Ask the person for a fresh one — nothing is wrong " +
          "with the journal.",
      },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await exchangeHandover(session);
  const base = serverSite().url;

  return Response.json({
    ok: true,
    token,
    expiresAt,
    scope: SESSION_SCOPE.agent,
    user: session.owner,
    journal: `${base}/${session.owner}`,
    status: `GET ${base}/api/v1/${session.owner}/status`,
    next:
      "This token is yours for seven days, on this journal and nothing else. Read " +
      `${base}/api/v1/${session.owner}/status` +
      " before you do anything: it says what is waiting, what you may write to, and what " +
      "this server can do. Everything you write arrives as a draft, and publishing is a " +
      "second call you make only when the person says so.",
  });
}
