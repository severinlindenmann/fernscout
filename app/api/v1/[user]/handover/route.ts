import { SESSION_TTL_MS, issueHandover } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * A twenty-minute credential the owner can paste into an agent — B283.
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
 * Never a guest, and never somebody on a trip. A buddy's write access is
 * scoped to their trip and their token is minted from a code naming it
 * (B230); a handover credential carries the journal, so issuing one to a trip
 * person would quietly widen what they hold.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/handover">) {
  const { user } = await params;

  const journal = getUser(user);
  if (!journal || !isEnabled("auth", user)) {
    return Response.json(
      {
        error: "auth_disabled",
        message:
          "This journal does not have sign-in switched on, so it cannot issue a credential " +
          "of any kind. /api/health says which capabilities are on.",
      },
      { status: 404 },
    );
  }

  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may hand it to an agent — not a guest, " +
          "and not a token scoped to one of its trips.",
      },
      { status: 403 },
    );
  }

  // `isOwner` already returns false for a journal that names no owner address
  // (`lib/contacts/session.ts:31`), so this is unreachable — but the type says
  // the field is optional and a narrowing that leans on another function's
  // internals is the kind that stops being true quietly.
  const email = journal.owner.email;
  if (!email) {
    return Response.json({ error: "no_owner_address" }, { status: 409 });
  }

  const { token, expiresAt } = await issueHandover(user, email);
  const base = serverSite().url;

  return Response.json({
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
