import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { journalStatus } from "@/lib/api/status";

export const dynamic = "force-dynamic";

/**
 * Where an agent stands, in one call — B91.
 *
 * Also the credential check the guide now opens with: a `401` here means go
 * and get a code, a `200` means you are in. That is why this route does the
 * cheapest possible thing before assembling anything — `authenticate` first,
 * and the scope question second.
 *
 * Nothing is cached. `force-dynamic` like every other authenticated route
 * here: this is a convenience view over live data and a stale one would be
 * worse than four calls, since an agent would act on a queue that had already
 * been emptied.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/status">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    // As the trips and drafts routes put it: the caller already proved who
    // they are, so naming the reason is safe.
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  return Response.json(await journalStatus(user, auth.session));
}
