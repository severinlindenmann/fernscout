import { GPS_IMPORT_SCOPE, GPS_TOKEN_TTL_DAYS, issueGpsToken } from "@/lib/auth";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { fail, ok } from "@/lib/api/v2/route";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * Mint the owner's `write:gps` token — B2204.
 *
 * **Owner cookie only, deliberately narrower than `POST /api/auth/{user}/handover`.**
 * That route also accepts a live journal-wide agent bearer, so a long
 * job can renew itself without the owner watching. This one does not: it is
 * reached from the studio, in the owner's own browser, the moment the
 * iPhone shell is told to start recording — there is no legitimate agent
 * that should ever be minting a 30-day upload credential on the owner's
 * behalf, so the bearer fallback `isOwner` offers is not used here. Passing
 * no `request` to `isOwner` is what keeps it that way: with nothing to read
 * an `Authorization` header from, its bearer branch can never match, and
 * the only door left is the cookie `resolveAccess` already reads.
 *
 * **One call, not two.** `handover` mints a twenty-minute exchange credential
 * because the seven-day token behind it is a text string somebody might
 * paste into a chat log or leave on a screen (`/api/auth/{user}/handover`'s
 * own comment). This token never touches a clipboard or a screen: it goes
 * straight from this response into the app's own Keychain item
 * (`components/nativeShell.ts`'s `mintGpsToken`) and the studio page that
 * requested it shows nothing but "connected". The twenty-minute detour
 * would add a round trip for no exposure it actually prevents.
 *
 * **One active token is enough.** `issueGpsToken` revokes every live
 * `write:gps` row for this address before minting the new one, so
 * reconnecting a phone — a reinstall, a new device — replaces rather than
 * accumulates. The owner's other tokens (an ordinary agent token, a
 * handover) are untouched; only this scope is revoked.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/auth/[user]/gps-token">) {
  const { user } = await params;

  const journal = getUser(user);
  if (!journal || !isEnabled("auth", user)) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  // B2204's security review, finding 4: this is a cookie-only door — no
  // bearer, no CSRF token, `SameSite=lax` alone standing between it and a
  // cross-site POST — the same shape the postcard/photobook/trip-delete
  // doors already carry `foreignOrigin` for. Missing it here let a foreign
  // page rotate the phone's 30-day upload credential out from under it, from
  // a browser that merely still holds the owner's cookie.
  if (foreignOrigin(request)) {
    return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  }

  // No `request` passed — see the comment above: this is what keeps the
  // gate cookie-only rather than reusing `isOwner`'s bearer fallback.
  if (!(await isOwner(user))) {
    return fail(
      "forbidden",
      "Only the address that owns this journal, signed in in a browser, may mint a positions " +
        "token. A bearer token — even the owner's own agent token — cannot mint this one.",
      undefined,
      403,
    );
  }

  const email = journal.owner.email;
  if (!email) {
    return fail("no_owner_address", ERROR_CODES.no_owner_address, undefined, 409);
  }

  const { token, expiresAt } = await issueGpsToken(user, email);

  return ok({
    ok: true,
    token,
    expiresAt,
    scope: GPS_IMPORT_SCOPE,
    days: Number(GPS_TOKEN_TTL_DAYS),
    next:
      `This token writes positions only — \`POST /api/v2/${user}/import\` with ` +
      '`kind: "gps"` and dryRun false — and nothing else; every other call refuses it. ' +
      "Minting a new one revokes this one. It is listed, and can be revoked, on this " +
      `journal's own keys page (\`GET /api/auth/${user}/keys\`).`,
  });
}
