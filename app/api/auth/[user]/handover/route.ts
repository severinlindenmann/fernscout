import { SESSION_SCOPE, SESSION_TTL_MS, issueHandover, resolveSession } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok } from "@/lib/api/v2/route";

export const dynamic = "force-dynamic";

/**
 * A twenty-minute credential the owner can paste into an agent — B283, moved
 * here from `/api/v1/{user}/handover` for v2 (`docs/plans/2026-09-12-api-v2/auth.md`
 * §2.5): minting and exchanging a credential belongs under `/api/auth`
 * regardless of which journal it names, so both halves now live together —
 * this route mints, `POST /api/auth/handover` exchanges (unchanged, and
 * unmoved).
 *
 * ## What this changes about decision 24, and what it does not
 *
 * Decision 24 said browsers never edit, and that agent tokens arrive in
 * `Authorization: Bearer` and nowhere else while guest sessions arrive in a
 * cookie and nowhere else. **The second half is now narrower than it reads:**
 * this route, reached with the owner's guest cookie, issues a bearer credential
 * that leads to a write token. The author decided that deliberately, after
 * being shown the alternative.
 *
 * What is preserved is the part that mattered: the browser still cannot write.
 * What it can do is hand over a credential that **expires in twenty minutes and
 * can only be exchanged** — never used to read, never used to write. The
 * seven-day token exists only in the agent's own memory, because this page
 * never sees it.
 *
 * Why not print the seven-day token here, which is simpler? `SESSION_TTL_MS`:
 * a guest cookie lasts a year, an agent token seven days. Printing the agent
 * token would have made a year-old cookie on a phone in a drawer a way to
 * issue write credentials indefinitely, and the clipboard, the screenshot and
 * the terminal scrollback would each have held a live one for a week. Twenty
 * minutes does not remove the first (the cookie can ask again) and does remove
 * the second, which is the exposure a person can actually be surprised by.
 *
 * ## Who may
 *
 * The journal's owner, cookie or bearer — `isOwner`, the same guard
 * `POST /api/v1/{user}/invites` uses and for the same reason: the control this
 * exists for is on a page the owner is reading in a browser, and the cookie is
 * `SameSite=lax` so a cross-site POST does not carry it.
 *
 * **A live agent token counts, and that means a token can renew itself** — ask
 * here with the bearer, spend the credential at `POST /api/auth/handover`, and
 * seven days start again with the owner never seeing a code. B776 looked at
 * this and left it: it is what lets a long job survive a week, every renewal
 * is a fresh row on the owner's access page, and revoking is immediate. What
 * B776 did change is that `/agent.md` and that page now say so, instead of
 * both implying a token expires by itself.
 *
 * **Never a guest, and never somebody on a trip — and this half is new in v2.**
 * `docs/v2-migration/00-decisions.md` and `03-build-order.md` both say
 * "handover-mint refuses short tokens" without naming the mechanism; it comes
 * from `docs/plans/2026-09-12-api-v2/challenge-security.md` finding 2, which
 * is about a *different* shape of short-lived credential (a client-held
 * "bridge" token for the `/agent` web helper) that `00-decisions.md`'s V1
 * already rules out entirely (no client-held bridge token; the helper reaches
 * v2 through an in-process cookie proxy instead). What is left, and what this
 * route actually guards against, is narrower and concrete: `isOwner`'s bearer
 * check reads `agent.owner === username && agent.email === ownerEmail` and
 * never looks at `agent.scope` for an ordinary owner match (only for the
 * cross-journal admin fallback) — so a trip-scoped agent token minted to the
 * *owner's own address* (nothing stops an owner requesting one for
 * themselves) would satisfy `isOwner` and could otherwise mint a journal-wide
 * handover credential from a credential that is only supposed to write one
 * trip. That is a widening, and it is the concrete escalation this route
 * refuses: a bearer resolving to a live `agent` session whose `scope` is not
 * the unqualified `SESSION_SCOPE.agent` (`"write:content"`) is `forbidden`,
 * checked *before* `isOwner`, regardless of whose address it belongs to.
 *
 * **This is the checkable half of "handover-mint refuses short tokens", not
 * the whole of it.** The decision log names no database column, no `origin`
 * marker and no broader "is this credential short-lived" test, and inventing
 * one (the challenge-security recommendation's `origin: "web-bridge"` flag)
 * is not this ticket's call to make — it belongs to whoever designs the
 * bridge-proxy the decision log already committed to instead. What is built
 * here is the one thing stated at the mechanism level: refuse a trip-scoped
 * bearer outright.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/auth/[user]/handover">) {
  const { user } = await params;

  const journal = getUser(user);
  if (!journal || !isEnabled("auth", user)) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const agent = bearer ? await resolveSession(bearer, "agent") : null;
  if (agent && agent.scope !== SESSION_SCOPE.agent) {
    return fail(
      "forbidden",
      "This bearer token is scoped to one trip, and a trip-scoped token cannot mint a " +
        "journal-wide handover credential — that would be a widening. Ask the owner's own " +
        "cookie session, or an unscoped owner agent token, to do this instead.",
      undefined,
      403,
    );
  }

  if (!(await isOwner(user, request))) {
    return fail(
      "forbidden",
      "Only the address that owns this journal may hand it to an agent — not a guest, " +
        "and not a token scoped to one of its trips.",
      undefined,
      403,
    );
  }

  // `isOwner` already returns false for a journal that names no owner address
  // (`lib/contacts/session.ts:31`), so this is unreachable — but the type says
  // the field is optional and a narrowing that leans on another function's
  // internals is the kind that stops being true quietly.
  const email = journal.owner.email;
  if (!email) {
    return fail("no_owner_address", ERROR_CODES.no_owner_address, undefined, 409);
  }

  const { token, expiresAt } = await issueHandover(user, email);
  const base = serverSite().url;

  return ok({
    ok: true,
    // Named `handover` rather than `token` so that a reader of a log or a
    // response cannot mistake it for the thing it is exchanged for.
    handover: token,
    expiresAt,
    minutes: SESSION_TTL_MS.handover / 60_000,
    exchange: `POST ${base}/api/auth/handover`,
    next:
      "Give this to an agent. Its first call is `POST /api/auth/handover` with this as its " +
      "bearer token, which spends it and answers with a 7-day token of the agent's own. " +
      "Then `GET " +
      `${base}/api/v1/${user}/status` +
      "` before anything else.",
  });
}
