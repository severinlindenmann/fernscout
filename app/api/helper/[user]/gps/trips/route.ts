import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { isJournalOwnerCookie } from "@/lib/contacts/session";
import { isEnabled } from "@/lib/capabilities";
import { recordedTrips } from "@/lib/gps/api";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * "Your route" page's own trip list — B2226. Counts and a last-received
 * instant per trip that actually holds a fix, never a coordinate
 * (`recordedTrips`, `lib/gps/api.ts`).
 *
 * **Owner-only, not just `isHelperOwner`-only** — the same second check
 * `app/api/helper/[user]/gps/route.ts` (B1843 addendum) makes: `isHelperOwner`
 * admits the operator's admin cookie for support work on a day or a trip,
 * which is the wrong answer for a location history. The address is
 * re-resolved and compared against `config.json`'s own `owner.email`.
 */
async function isOwnerOnly(username: string): Promise<boolean> {
  return (await isHelperOwner(username)) && (await isJournalOwnerCookie(username));
}

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/gps/trips">) {
  const { user } = await params;
  if (!(await isOwnerOnly(user))) return notYourJournal(request, user);
  if (!isEnabled("routeRecording", user)) {
    return Response.json({ error: "capability_off" }, { status: 404, headers: NO_STORE });
  }

  return Response.json({ ok: true, trips: recordedTrips(user) }, { headers: NO_STORE });
}
