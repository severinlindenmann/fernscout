import { isEnabled } from "@/lib/capabilities";
import type { Say } from "@/lib/helper/intents";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { note } from "@/lib/helper/thread";
import { proposalFor, writeTool } from "@/lib/helper/tools";
import { requestLocale, translateIn } from "@/lib/locales";

export const dynamic = "force-dynamic";

/**
 * A proposal, without a model — B900.
 *
 * **It writes nothing, and it is not a way to write anything.** Two jobs, both
 * of them memory and prose:
 *
 * - `wrote: true` tells the conversation that a proposal was accepted, so the
 *   next turn knows the day exists rather than proposing it again. The
 *   *writing* already happened, at the helper route the proposal named, which
 *   is the only path to disk this feature has.
 * - Otherwise it returns the proposal for one write tool, which is how one
 *   accepted write hands on to the next: `draft_words` returns prose and
 *   writes nothing, so keeping those words is a second proposal on the screen
 *   with a second button under it. The chain cannot become a quieter way to
 *   write, because the second half is the same fields, the same button and the
 *   same route as if the model had proposed it.
 *
 * A name that is not a **write** tool lands nowhere: a read has nothing to
 * propose and a link has nothing to press.
 *
 * Cookie only, owner only, outside `/api/v1` and outside the published
 * contract, for the reason `../day/route.ts` sets out at length.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/proposal">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const name = typeof body.tool === "string" ? body.tool.trim() : "";
  const tool = writeTool(name);
  if (!tool) return Response.json({ error: "unknown_tool" }, { status: 404 });

  const given = (body.arguments ?? {}) as Record<string, unknown>;
  const args: Record<string, string> = {};
  for (const key of Object.keys(tool.properties)) {
    const value = given[key];
    if (typeof value === "string" && value.trim() !== "") args[key] = value.trim();
  }

  const locale = await requestLocale();
  const say: Say = (key, vars) =>
    translateIn(locale, key as Parameters<typeof translateIn>[1], vars);

  if (body.wrote === true) {
    // No sentence of theirs and no model call: one line of context so the next
    // turn does not offer to do what has just been done. A **note** rather
    // than a made-up exchange (B924) — nobody said this, and a marker written
    // as somebody's turn is a marker the model reads back as prose to imitate.
    note(user, `[written: ${tool.name} ${JSON.stringify(args)}]`);
    return Response.json({ ok: true });
  }

  const today =
    typeof body.today === "string" && DATE_RE.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  const { proposal, blocks } = await proposalFor(user, tool, args, say, today);
  return Response.json({ ok: true, proposal, blocks });
}
