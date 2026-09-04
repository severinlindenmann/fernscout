import { authenticate, errorResponse, ownsUser } from "@/lib/api/auth";
import { draftQueue } from "@/lib/api/status";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Everything waiting for a person to approve it.
 *
 * Each draft now carries `publish` — the call that puts *that* day on the site.
 * This list is what an agent ends its report with, and until B28 it could say
 * what was waiting and not where the person went to say yes: the guide told an
 * agent four times that "a person publishes it" and never once how. A queue
 * that names the outstanding work and not the approval is half a queue.
 *
 * It also carries `test` on a draft nobody lived — `listDrafts` resolves it,
 * inheritance included, and the spread below passes it through (B134). Present
 * only when true; absent means real, which is the rule on every other surface
 * that reports this flag.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/drafts">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  return Response.json({
    user,
    // `draftQueue` rather than the loop that used to be here: `/status` reports
    // the same queue, and two hand-rolled copies of this shape are two chances
    // to get B134's inherited `test` flag wrong. Scoping comes with it — a
    // trip-scoped token sees that trip's drafts and no others (B91).
    drafts: await draftQueue(user, auth.session, serverSite().url),
    next:
      "Tell the person what is waiting and ask which to publish. `publish` is the call " +
      "that acts on their answer — it is refused once and hands you a confirmation code.",
  });
}
