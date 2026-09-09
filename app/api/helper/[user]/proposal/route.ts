import { isEnabled } from "@/lib/capabilities";
import type { Say } from "@/lib/helper/intents";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { proposed } from "@/lib/helper/thread";
import { proposalFor, writeTool } from "@/lib/helper/tools";
import { requestLocale, translateIn } from "@/lib/locales";

export const dynamic = "force-dynamic";

/**
 * A proposal, without a model — B900.
 *
 * **It writes nothing, and it is not a way to write anything.** It returns the
 * proposal for one write tool, which is how one accepted write hands on to the
 * next: `draft_words` returns prose and writes nothing, so keeping those words
 * is a second proposal on the screen with a second button under it. The chain
 * cannot become a quieter way to write, because the second half is the same
 * fields, the same button and the same route as if the model had proposed it.
 *
 * It used to have a second job — `wrote: true`, posted by the browser after a
 * successful press, was what told the conversation the write had happened.
 * B939 moved that to the routes that do the writing, because a caller that is
 * not our own page never made the call and was told on the next turn that
 * nothing had been saved.
 *
 * **What it proposes still has to enter the conversation, even though no
 * model was asked** — B926. This is the one place a proposal can reach a
 * person's screen with the thread never having heard of it: `start_day`
 * chaining straight to `draft_words` calls here, not the model, so notes
 * somebody had already given rode onto this card and nowhere else. If that
 * press then failed, the next turn had only a stale, differently-worded note
 * about the *first* tool to go on. `lib/helper/thread.ts`'s `proposed()` is
 * the same marker `app/api/helper/[user]/ask/route.ts` writes for a proposal
 * the model made itself, so a later turn cannot tell the two apart and does
 * not need to.
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

  const today =
    typeof body.today === "string" && DATE_RE.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  const { proposal, blocks } = await proposalFor(user, tool, args, say, today);
  if (proposal) proposed(user, proposal.tool, proposal.arguments);
  return Response.json({ ok: true, proposal, blocks });
}
