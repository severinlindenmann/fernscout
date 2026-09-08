import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent, helperConsent } from "@/lib/helper/consent";
import type { Block } from "@/lib/helper/blocks";
import { refusalFor, type Say } from "@/lib/helper/intents";
import { answerInThread } from "@/lib/helper/model";
import { describeSelection, isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { forget, history, remember } from "@/lib/helper/thread";
import { speechProvider } from "@/lib/helper/transcribe";
import { requestLocale, translateIn } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * A sentence in, a conversation out — B685, B889, and B900.
 *
 * **Free.** Nothing here touches the ledger, and that is a decision rather
 * than an oversight: at roughly a third of a rappen a turn, metering the front
 * door would cost more in people not daring to knock than it could ever
 * recover. A *write* may cost something — one of them does — and it is charged
 * by the route the press posts to, once, when it is accepted. A proposal
 * corrected three times and then abandoned costs nothing at all.
 * `lib/rateLimit.ts` is the brake instead.
 *
 * **One path, since B900.** There was a router in front of this: a model that
 * classified the sentence into a row of `lib/helper/intents.ts`, answered it
 * from the row, and only sent what fitted no row to the conversation. So a
 * sentence a row happened to cover never reached a tool at all. The rows are
 * gone; every sentence that is not refused goes to `answerInThread` with the
 * whole registry (`lib/helper/tools.ts`) in front of it.
 *
 * **A read runs; a write proposes.** A read tool executes and draws its own
 * block. A write tool has no `run` to call: it returns a proposal — the
 * fields, a sentence, and the helper route a press posts to — and the person
 * edits, presses, or says what is wrong and the conversation carries on.
 * Nothing in this file writes anything.
 *
 * **The refusal table still runs first**, from the raw sentence, before their
 * words leave the machine, and a refused sentence is not remembered either so
 * it cannot reach a model on the following turn instead. That is B817's guard
 * and B900 did not move it.
 *
 * Cookie only, owner only, bearer refused by construction — `isHelperOwner`.
 */

/** Fifteen minutes. Well above a person thinking out loud, well below a
 *  script working through a phrasebook. */
const LIMIT = { max: 40, windowMs: 15 * 60 * 1000 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether this box belongs on the page asking, and what it needs to draw
 * itself — B844.
 *
 * `/agent` reads all five of these on the server and hands them to
 * `HelperAsk` as props. A journal page cannot: the day card and the trip
 * overview are client components several levels below a page that knows
 * nothing about the helper, and threading five props through `TripStory` and
 * `StoryPager` to reach them would put the capability into the props of every
 * page that renders a day.
 *
 * So the component asks, the same shape `InviteToRead` already has beside it:
 * a 404 means "not yours, or switched off here", and the answer to a 404 is
 * to draw nothing at all rather than a box that explains itself after being
 * pressed. Owner only, so this reveals nothing about somebody else's journal
 * — `notYourJournal` gives the same answer for a journal that is not yours as
 * for one that does not exist.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/ask">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  return Response.json({
    ok: true,
    consented: Boolean(helperConsent(user)),
    speech: isEnabled("transcription", user),
    consentedSpeech: hasHelperConsent(user, "speech"),
    speechProvider: speechProvider(),
  });
}

/**
 * Start the conversation over — B899.
 *
 * `forget()` has existed since B889 and nothing called it, so somebody who had
 * confused the thread waited half an hour for the TTL to run out. A
 * conversation you cannot end is one you stop trusting, and this is the whole
 * of ending it: the map entry goes, and the next sentence starts from nothing.
 *
 * `DELETE` on the same address rather than a route of its own — there is no
 * body to read and nothing to document beyond "the conversation is gone", and
 * a second file would be a second place to keep the owner check in step.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/helper/[user]/ask">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }
  forget(user);
  return Response.json({ ok: true });
}

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/ask">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const limited = rateLimitFor("helper-ask", clientIp(request), LIMIT);
  if (!limited.ok) {
    return Response.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const said = typeof body.said === "string" ? body.said.trim().slice(0, 500) : "";
  if (said === "") return Response.json({ error: "no_question" }, { status: 400 });

  const locale = await requestLocale();
  const say: Say = (key, vars) =>
    translateIn(locale, key as Parameters<typeof translateIn>[1], vars);

  /**
   * B817 — before the model, and before their words leave the machine.
   *
   * A sentence about taking something down is answered here, deterministically,
   * and never reaches the router. That ordering is the whole fix: a refusal
   * decided *after* routing is a refusal that can be argued with by a confident
   * guess, and the guess this replaces opened the screen that creates a day.
   * Nothing is written, nothing is opened, and no confidence can reach past it.
   */
  const refused = refusalFor(said);
  if (refused) {
    return Response.json({
      ok: true,
      intent: `refuse_${refused.name}`,
      // A sentence shown in the answer box, which is what `read` already is.
      kind: "read",
      refused: refused.name,
      slots: {},
      confidence: 1,
      answer: say(refused.key),
      // B898 — one sentence, drawn as the `say` shape, so the conversation
      // has one way of drawing a turn and a refusal is not a special case
      // the surface has to know about.
      blocks: [{ shape: "say", text: say(refused.key) }] satisfies Block[],
    });
  }

  // Their words go to a provider, so the same panel guards this as guards a
  // write-up. Free or not, it is the sentence that leaves the machine.
  if (!helperConsent(user)) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  // The person's own today, because "yesterday" is answered from where they
  // are standing. Anything that is not a date falls back to the server's.
  const today =
    typeof body.today === "string" && DATE_RE.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  /**
   * What is selected in the files pane, if anything — B902.
   *
   * The browser sends ids; **this resolves them against disk** and drops what
   * nothing answers to, so a sentence going to a model can only ever name a
   * file this journal actually has. It rides as one bracketed line after
   * their words — the same shape B900 uses to carry a waiting proposal — and
   * it is *not* remembered: the pane sends what is selected on every turn, so
   * a thread cannot come to believe in a selection that has been cleared.
   *
   * Nothing selected is the ordinary case and produces nothing at all, which
   * is what keeps the pane an addition rather than a requirement.
   */
  const selected = Array.isArray(body.selected)
    ? body.selected.filter((id): id is string => typeof id === "string")
    : [];
  const context = selected.length > 0 ? describeSelection(user, selected) : "";

  /**
   * The whole of it — B900. The conversation so far, one new sentence, and
   * the registry. Reads run; writes propose and write nothing.
   */
  let thread;
  try {
    thread = await answerInThread(user, context === "" ? said : `${said}\n${context}`, history(user), today, say);
  } catch {
    return Response.json({ error: "model_failed" }, { status: 502 });
  }
  // Nothing said and nothing drawn is a failed turn, and it is honest to say
  // so: their own words are still in the box. A turn that drew something and
  // said nothing is not — the blocks are the answer.
  if (thread.answer === "" && thread.blocks.length === 0) {
    return Response.json({ error: "model_failed" }, { status: 502 });
  }

  /**
   * What is remembered, and why a proposal is part of it.
   *
   * "no, the 14th" is the sentence this whole feature is for, and it is only
   * answerable if the next turn knows what was proposed. The turn's own prose
   * says a proposal is waiting; it does not say the trip was called Japan and
   * ran from the first to the fourteenth. So the arguments ride along, in one
   * bracketed line the model reads as context — and marked as *not written*,
   * so a later turn cannot mistake a proposal for a fact about the journal.
   */
  const remembered = [
    thread.answer,
    ...thread.proposals.map(
      (proposal) =>
        `[proposed, not written, waiting to be pressed: ${proposal.tool} ${JSON.stringify(proposal.arguments)}]`,
    ),
  ].join("\n");
  remember(user, said, remembered);

  return Response.json({
    ok: true,
    kind: "read",
    answer: thread.answer,
    // What it actually ran, in order — so the claim its answer makes about
    // what it looked at is checkable from outside.
    looked: thread.looked,
    /**
     * What the turn draws — B898. The tools' own blocks in the order they
     * ran, and then the model's sentence as a `say`. The model chose the
     * tools and no part of it chose a shape.
     */
    blocks: [
      ...thread.blocks,
      ...(thread.answer === "" ? [] : [{ shape: "say" as const, text: thread.answer }]),
    ] satisfies Block[],
    /**
     * Proposals a write tool made — B900. **Nothing has been written**: each
     * carries the helper route its press posts to, and the press is the
     * person's.
     */
    proposals: thread.proposals,
  });
}
