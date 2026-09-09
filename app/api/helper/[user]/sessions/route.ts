import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { sessionsOf } from "@/lib/helper/sessions";
import { liveSession } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * The room's own history panel, reading back what `sessionsOf` already
 * answers for `past_conversations` — B1109.
 *
 * A second door onto the same read rather than the tool's own route, because
 * the panel opens with a tap and owes nobody a sentence from a model: the
 * tool exists for "show me my earlier conversations" typed into the
 * conversation itself, and this exists for the clock icon beside it. Both
 * read the owner's own words, so both are cookie-only and owner-only, outside
 * `/api/v1` and outside the published contract, for the reason
 * `app/api/helper/[user]/day/route.ts` sets out at length.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/sessions">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  // `live` names the conversation a next sentence would extend, so the
  // panel can say which row is the one you are in — B1168. `null` when
  // nothing is in progress.
  return Response.json({ ok: true, live: await liveSession(user), sessions: await sessionsOf(user) });
}
