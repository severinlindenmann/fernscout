import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { resolveAccess } from "@/lib/auth/handshake";
import { getUser } from "@/lib/users";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { gpsMonthsHeld, purgeGpsHistory } from "@/lib/gps/api";
import { gpsPurgeRequest } from "@/lib/api/v2/schemas/gps";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * The standalone purge's own cookie door — B1843 addendum. The studio
 * location page's own danger-zone panel calls this, the way
 * `DELETE /api/v2/{user}/gps` is the same thing for an agent holding a
 * token (`isHelperOwner`, not a bearer scope, the same split `.../inbox/[id]`
 * already has).
 *
 * `GET` names the months currently held — never a fix, so the panel can list
 * "March 2026, June 2026" without this route ever handing back a position.
 * `DELETE` takes `{"months": [...]}` or `{"all": true}` and really removes
 * the bytes (`lib/gps/store.ts`'s `deleteMonths`). Already-drawn
 * `trips/<trip>/track.json` files are untouched.
 *
 * **Owner-only, not just `isHelperOwner`-only** (security review, 2026-09-24).
 * `isHelperOwner` accepts the operator's admin cookie for any journal — the
 * right answer for support work on a day or a trip, but wrong for the most
 * sensitive thing this repository stores. `isOwnerOnly` re-checks the
 * resolved address against `config.json`'s own `owner.email`, so an admin
 * session opens every other helper door and none of this one.
 *
 * **`Cache-Control: private, no-store`** on every response — this is a
 * location history's own months and its own removal, and neither belongs in
 * a shared cache. **`foreignOrigin` on `DELETE`**, the same second layer
 * `app/[user]/trips/[trip]/delete/route.ts` (B1559) puts in front of a
 * cookie-only destructive call: `sameSite: "lax"` is the first line, this is
 * the second, for a proxy or a cookie set without the attribute.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };

async function isOwnerOnly(username: string): Promise<boolean> {
  if (!(await isHelperOwner(username))) return false;
  const journal = getUser(username);
  const access = await resolveAccess(username);
  return journal !== null && access.email === journal.owner.email;
}

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/gps">) {
  const { user } = await params;
  if (!(await isOwnerOnly(user))) return notYourJournal(request, user);

  return Response.json({ ok: true, monthsHeld: gpsMonthsHeld(user) }, { headers: NO_STORE });
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/helper/[user]/gps">) {
  const { user } = await params;
  if (!(await isOwnerOnly(user))) return notYourJournal(request, user);
  if (foreignOrigin(request)) {
    return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403, headers: NO_STORE });
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.value;
  const parsed = gpsPurgeRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }

  return Response.json({ ok: true, ...purgeGpsHistory(user, parsed.data) }, { headers: NO_STORE });
}
