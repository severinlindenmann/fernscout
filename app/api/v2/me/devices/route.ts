import { cookies } from "next/headers";
import { GUEST_COOKIE, IDENTITY_COOKIE, revokeBrowserSessions } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import { fail, ok, withV2Log } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const dynamic = "force-dynamic";

/**
 * Sign out everywhere — `/me`'s second sign-out button.
 *
 * Ends every browser sign-in this address holds on the instance: the
 * identity on each device *and* each journal's reader cookie. Ending only
 * the identities would leave a journal cookie alive on a lost phone, still
 * opening that journal, which is exactly what somebody pressing this is
 * trying to stop. Agent keys and GPS tokens are left alone — see
 * `revokeBrowserSessions`.
 *
 * Cookie-only (`resolveIdentity` refuses bearer, handover and guest
 * credentials), and origin-checked because `SameSite=lax` is otherwise the
 * only thing between a foreign page and signing somebody out of everything.
 */
export const DELETE = withV2Log(async function DELETE(request: Request) {
  if (!isEnabled("auth")) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }
  if (foreignOrigin(request)) {
    return fail("foreign_origin", ERROR_CODES.foreign_origin, undefined, 403);
  }

  const identity = await resolveIdentity();
  if (!identity) {
    return fail("not_signed_in", ERROR_CODES.not_signed_in, undefined, 401);
  }

  const revoked = await revokeBrowserSessions(identity.email);

  // This browser's own cookies go too: their sessions are among the ones
  // just revoked, and a cookie naming a dead session only costs a lookup.
  const jar = await cookies();
  jar.delete(GUEST_COOKIE);
  jar.delete(IDENTITY_COOKIE);

  return ok({ ok: true, revoked });
}, { route: "/api/v2/me/devices" });
