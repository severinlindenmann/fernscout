// DELETE /api/v2/me/devices/{id} — ports
// app/api/v1/me/devices/[id]/route.ts onto the v2 plumbing.
import { listIdentities, revokeSession } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { fail, ok } from "@/lib/api/v2/route";
import { ERROR_CODES } from "@/lib/api/errorCodes";

export const dynamic = "force-dynamic";

/**
 * End one device's identity.
 *
 * The id is checked against this address's own list, not merely revoked —
 * `listIdentities` is scoped to the address the credential proves, so an id
 * belonging to anybody else is not in the list and answers `not_found`.
 */
export async function DELETE(_request: Request, context: RouteContext<"/api/v2/me/devices/[id]">) {
  if (!isEnabled("auth")) {
    return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  }

  const identity = await resolveIdentity();
  if (!identity) {
    return fail("not_signed_in", ERROR_CODES.not_signed_in, undefined, 401);
  }

  const { id } = await context.params;
  const mine = (await listIdentities(identity.email)).find((row) => row.id === id);
  if (!mine) {
    return fail("no_such_device", ERROR_CODES.no_such_device, undefined, 404);
  }

  await revokeSession(mine.id);

  // Signing THIS device out is allowed and is the ordinary "sign out"
  // button — the cookie is left in place deliberately, exactly as the v1
  // route documents: the token behind it is dead, so the next request
  // resolves to nobody.
  return ok({ ok: true, current: mine.id === identity.id });
}
