import { isEnabled } from "@/lib/capabilities";
import { balanceOf, refund, spend } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import type { Block } from "@/lib/helper/blocks";
import { HELPER_TURN_CREDITS, noCreditsAnswer } from "@/lib/helper/creditGate";
import { refusalFor, sayIn } from "@/lib/helper/intents";
import { answerInThread, statusKeyFor, type ToolKind } from "@/lib/helper/model";
import { describeSelection, isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { recordTurn } from "@/lib/helper/sessions";
import { forget, history, proposed, remember, sessionId } from "@/lib/helper/thread";
import { speechProvider } from "@/lib/helper/transcribe";
import { requestLocale } from "@/lib/locales";
import { clientIp, rateLimitFor } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * A sentence in, a conversation out — B685, B889, B900, and B1091.
 *
 * **A flat `HELPER_TURN_CREDITS` a turn**, spent before the model is ever
 * called and refunded if the call throws — the same before/refund shape
 * `write-day` already uses, and the reason it lives here rather than inside
 * `answerInThread`: this route is the one door, `lib/helper/model.ts` stays
 * model-only. A sentence the refusal table below catches, or a turn refused
 * for want of credits, never reaches a model at all, so neither is charged.
 * `lib/rateLimit.ts` is the brake beneath the credit, for the same reasons it
 * always was. A *write* proposal may cost something more on top — one of
 * them does — and it is charged by the route the press posts to, once, when
 * it is accepted. A proposal corrected three times and then abandoned costs
 * only the turns that produced it.
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

/** Wide enough for a whole day's dictated notes (roughly a thousand tokens),
 *  narrow enough to leave room in the prompt for history and tools — see
 *  B1039 below. */
const MAX_SAID = 4000;

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
    // The scope rather than the file, for the reason the POST gate gives at
    // length — B976. A record can now hold a no.
    consented: hasHelperConsent(user, "words"),
    speech: isEnabled("transcription", user),
    consentedSpeech: hasHelperConsent(user, "speech"),
    speechProvider: speechProvider(),
    // B1039 — readable before the box is filled, the way `/api/health`
    // carries an upload's own size ceiling.
    sayLimit: MAX_SAID,
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

  const said = typeof body.said === "string" ? body.said.trim() : "";
  if (said === "") return Response.json({ error: "no_question" }, { status: 400 });
  /**
   * B1039 — a dictated day's notes are longer than "one sentence", and this
   * box used to cut them to 500 characters with nothing said: half a day's
   * write-up went to the model, and the person had no way to know less
   * arrived than they typed. `search`'s own box caps at 300 for the "one
   * sentence" case (`app/api/helper/[user]/search/route.ts`); this one is
   * where a whole day's notes legitimately land, so the ceiling is wide
   * enough for that and a refusal past it rather than a silent cut —
   * AGENTS.md's "an empty field beats a plausible fiction" applies exactly
   * as much to a shortened one.
   */
  if (said.length > MAX_SAID) {
    return Response.json({ error: "too_long", limit: MAX_SAID }, { status: 400 });
  }

  const locale = await requestLocale();
  const say = sayIn(locale);

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
    /**
     * Recorded, though never remembered — B1195. The gate keeps removal
     * language out of the model thread (B817, unchanged), but the person
     * SAW this exchange: their sentence, and the refusal they were
     * answered with. A stored conversation that silently omits it lies by
     * omission on reopening — a persona sent seven messages and the
     * history counted six. The words are their own history
     * (lib/helper/sessions.ts); what the model re-reads is a separate
     * decision that stands.
     */
    void recordTurn({
      owner: user,
      session: await sessionId(user),
      locale,
      tools: [],
      proposed: [],
      guard: `refusal:${refused.name}`,
      recovered: false,
      threadTurns: (await history(user)).length,
      said,
      answered: say(refused.key),
      origin: "web",
    });
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

  /**
   * Their words go to a provider, so the same panel guards this as guards a
   * write-up. Free or not, it is the sentence that leaves the machine.
   *
   * **The scope, not the file** — B976. This asked whether a consent record
   * existed at all, which was the same question while the file only ever held
   * yeses and vanished when the last one went. It stopped being the same
   * question the moment a record could hold a *no*: a person who turned off
   * the operator reading their conversations would have left a file behind,
   * and this would have read it as agreeing to send their words to a model.
   */
  if (!hasHelperConsent(user, "words")) {
    return Response.json({ error: "consent_required" }, { status: 403 });
  }

  /**
   * The credit, after consent and before the model — B1091, the same gate
   * order `write-day` already uses. A ledger ref that is merely unique
   * rather than meaningful: unlike a day's write-up this turn names no trip
   * and no date, and the reason on the row is what an operator reconciles
   * against, not this string.
   */
  const ledgerRef = `${user}/ask/${Date.now()}`;
  if (!(await spend(user, HELPER_TURN_CREDITS, "ask_thread", ledgerRef))) {
    const balance = (await balanceOf(user)) ?? 0;
    const noCredits = noCreditsAnswer(
      say,
      balance,
      `/${encodeURIComponent(user)}/account#buy`,
    );
    return Response.json({
      ok: true,
      kind: "read",
      answer: noCredits,
      looked: [],
      blocks: [{ shape: "say", text: noCredits }] satisfies Block[],
      proposals: [],
    });
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
   *
   * **One turn, run exactly once, whichever door answers it** — B1213
   * (D19). Streaming is a second way of *delivering* this turn's answer, not
   * a second turn: the honesty guards inside `answerInThread`, `remember`,
   * `recordTurn` and the proposals kept all happen here, so a streamed turn
   * and a plain one can never disagree about what was recorded or charged.
   * `onToolStart`, when given one, is told as each tool starts — never what
   * it returned, only its `kind` (`./model.ts`'s `withoutPlumbing` is the
   * reason a tool's *name* never reaches a screen either).
   */
  async function runTurn(
    onToolStart?: (tool: { name: string; kind: ToolKind }) => void,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let thread;
    try {
      thread = await answerInThread(
        user,
        context === "" ? said : `${said}\n${context}`,
        await history(user),
        today,
        say,
        // What is ticked, resolved by the tool that needs it — B925. Nobody
        // is asked to read an id off a screen that shows none.
        selected,
        // The ambiguity anchor — B1224: a message too short to carry a
        // language ("ja") is answered in the person's own UI language,
        // never a guess.
        locale,
        // The web channel, said explicitly: `onToolStart` rides after
        // B1237's channel parameter in the signature.
        "web",
        onToolStart,
      );
    } catch {
      // The credit bought nothing — B1091, the same refund `write-day` gives
      // for the identical reason.
      await refund(user, HELPER_TURN_CREDITS, ledgerRef);
      return { status: 502, body: { error: "model_failed" } };
    }
    // Nothing said and nothing drawn is a failed turn, and it is honest to
    // say so: their own words are still in the box. A turn that drew
    // something and said nothing is not — the blocks are the answer.
    if (thread.answer === "" && thread.blocks.length === 0) {
      return { status: 502, body: { error: "model_failed" } };
    }

    /**
     * What is remembered, and **who each half is written for** — B924.
     *
     * "no, the 14th" is the sentence this whole feature is for, and it is
     * only answerable if the next turn knows what was proposed. So the
     * arguments ride along in one bracketed line, marked as *not written* so
     * a later turn cannot mistake a proposal for a fact about the journal.
     *
     * That line used to be glued onto the end of the assistant's own answer,
     * which is how it reached a person's screen: the model read its last
     * answer back as prose containing a bracketed marker and, every so
     * often, wrote one itself — a proposal "waiting to be pressed" with no
     * card and no button. It is a **note** now (`lib/helper/thread.ts`): the
     * model sees it, it is never assistant text, and there is nothing left
     * to imitate.
     */
    remember(user, said, thread.answer);
    /**
     * What happened, kept — B976.
     *
     * After `remember`, so the thread has this turn in it and the count is
     * the conversation as it now stands. Not awaited and never able to fail
     * the turn: the person has their answer, and losing it to an analytics
     * insert would be trading the product for the bookkeeping.
     *
     * `sessionId`/`history` are awaited here rather than left unresolved —
     * the cache `remember` just wrote to is warm, so this costs nothing
     * beyond the `await` itself (B1054).
     */
    void recordTurn({
      owner: user,
      session: await sessionId(user),
      locale,
      tools: thread.looked,
      proposed: thread.proposals.map((proposal) => proposal.tool),
      guard: thread.guard,
      recovered: thread.recovered,
      threadTurns: (await history(user)).length,
      said,
      answered: thread.answer,
      origin: "web",
    });
    for (const proposal of thread.proposals) {
      proposed(user, proposal.tool, proposal.arguments);
    }

    return {
      status: 200,
      body: {
        ok: true,
        kind: "read",
        answer: thread.answer,
        // What it actually ran, in order — so the claim its answer makes
        // about what it looked at is checkable from outside.
        looked: thread.looked,
        /**
         * What the turn draws — B898. The tools' own blocks in the order
         * they ran, and then the model's sentence as a `say`. The model
         * chose the tools and no part of it chose a shape.
         */
        blocks: [
          ...thread.blocks,
          ...(thread.answer === "" ? [] : [{ shape: "say" as const, text: thread.answer }]),
        ] satisfies Block[],
        /**
         * Proposals a write tool made — B900. **Nothing has been written**:
         * each carries the helper route its press posts to, and the press
         * is the person's.
         */
        proposals: thread.proposals,
      },
    };
  }

  /**
   * Content negotiation, not a flag — B1213 (D19). `Accept` is a header
   * every `fetch` already carries, so a caller that never asks for NDJSON
   * (an older client, a test, WhatsApp's own dispatch) gets exactly the JSON
   * body it always got, and a new client talking to an instance that has not
   * deployed this yet reads a `content-type` it did not ask for and falls
   * back — `HelperAsk.tsx`'s `ask()` is what does that.
   */
  const wantsStream = (request.headers.get("accept") ?? "").includes("application/x-ndjson");
  if (!wantsStream) {
    const { status, body: answered } = await runTurn();
    return Response.json(answered, status === 200 ? undefined : { status });
  }

  /**
   * One NDJSON line per tool start, then one `{done: …}` line carrying
   * **exactly** the body the non-streaming branch above answers with — a
   * status event never replaces the final answer, it only fills the wait
   * before it. A turn that fails still answers `200` here, because the
   * stream's own headers are already sent by the time `runTurn` can know
   * that: the failure rides inside `done` instead, the same
   * `{ error: "model_failed" }` shape the plain path would have sent as a
   * 502, and the client reads it the same way.
   */
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      };
      const { body: answered } = await runTurn((tool) => {
        line({ status: say(statusKeyFor(tool.kind)) });
      });
      line({ done: answered });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
}
