import "server-only";
import { newId } from "../db/owner";
import { recordPress } from "./sessions";

/**
 * The thread — B889, round 1 of `docs/plans/2026-09-07-helper-as-an-agent.md`.
 *
 * **A registry of rows can only answer what somebody wrote a row for.** Seven
 * rows is a menu with a text box in front of it, which is why four of the
 * owner's seven ordinary German sentences came back `unknown`. This file is
 * the other half: a list of *tools* the model may call, so a sentence nobody
 * anticipated is answered by the model choosing among reads rather than by
 * somebody having written a row for that sentence.
 *
 * **The tools moved out in B898.** `./tools.ts` is the registry now, and it
 * carries the contract as well as the rows: a tool declares its kind and the
 * shape it renders into, a write tool has no `run` to call, and the model's
 * list is generated from the array. This file is what is left when the tools
 * are taken out of it, which is the conversation itself.
 *
 * ## Where the conversation lives, and why it is a Map
 *
 * In this process's memory, keyed by journal, for `TTL_MS` below — see that
 * constant for what ends a conversation and why the number is what it is.
 *
 * The precedent for not inventing storage is `./draft.ts`: there is no
 * wizard-position field anywhere, because the step is a function of the draft
 * on disk and a second copy of a fact disagrees with the first within a month.
 * That reasoning does not reach here — nothing on disk knows what somebody
 * said out loud thirty seconds ago — so the conversation has to be *held*. The
 * question is only where, and the three candidates each answer themselves:
 *
 * - **Not the database.** A table outlives the conversation. What a person
 *   typed at their journal on a Tuesday would then sit in a backup, in a
 *   restore drill and in an export, and nobody asked for it to be kept. It is
 *   the same reason sent mail moved out from under `content/` in B636.
 * - **Not under `content/`.** That tree is the owner's own content and B510
 *   put everything else out of it. Chatter is not content.
 * - **Memory, then**, which is what `lib/rateLimit.ts` already does for the
 *   same shape of transient fact. A deploy or a restart drops every
 *   conversation, and the whole cost of that is one repeated sentence.
 *
 * What is kept is the plain text of each turn and nothing else — no tool
 * calls, no tool results. Trimming a history that carries `tool_use` blocks
 * can orphan a `tool_result` and earn a 400; the answer already carries what
 * the tools said, and a turn of text is a twentieth of the tokens.
 */

/**
 * One thing that was said, by one side — or a **note**, which is the third
 * role and the one B924 is about.
 *
 * The conversation has two audiences and they had one path. A note is written
 * *for the model* — "there is a proposal waiting to be pressed", "that one was
 * pressed" — and a note is never a turn: it is folded into the next user
 * message by `lib/helper/model.ts` and it is never assistant text. That is the
 * whole fix. While the marker sat inside the assistant's own words, the model
 * read its own last answer as prose that contained a bracketed line and, every
 * so often, wrote one of its own — which is why the leak was intermittent and
 * why no amount of prompting would have settled it.
 *
 * Deliberately not the SDK's `MessageParam`: this holds text and never a tool
 * block.
 */
export type Turn = { role: "user" | "assistant" | "note"; text: string };

/**
 * How much of a conversation is remembered.
 *
 * Six exchanges. Beyond that a person is on a different subject, and every
 * remembered turn is paid for again on the next one.
 */
const MAX_TURNS = 12;

/**
 * What ends a conversation — B1109.
 *
 * Two ways, and this is the only one that is a clock rather than a press:
 * `forget()` (the "start over" control, `DELETE /api/helper/<user>/ask`) ends
 * one outright, and a gap this long ends one by itself, because coming back
 * after it is starting again, which is what a person expects. Reopening the
 * room — a closed tab, a phone locked and unlocked, a link followed back in —
 * is **not** on this list and does not end a conversation: the thread lives
 * on the server, keyed by journal, so it survives exactly as long as this gap
 * allows regardless of what the browser did in between. That is also what
 * makes "resume the last conversation" (`app/agent/page.tsx`) an honest
 * thing to offer rather than a guess.
 *
 * Thirty minutes used to be this number and was the bug: a conversation held
 * up by a moment's thought, or by waiting on an answer, crossed it
 * constantly, so the same sitting was recorded as `helper_sessions` rows for
 * one turn each — the room's history list was a list of turns wearing a
 * "conversation" label (two rows in a row occasionally beat the clock, which
 * is why B1109's evidence showed the odd "(2 turns)" among sixteen single
 * ones). A gap of a few hours is what a person actually means by "still the
 * same conversation": long enough to survive a coffee, short enough that
 * returning tomorrow is unmistakably a new one. Nothing else changes:
 * `MAX_TURNS` above still caps what a model is shown regardless of how long
 * the thread has lived, so a longer TTL costs nothing per turn — it only
 * changes which rows in `helper_sessions` end up sharing a `session_id`.
 */
const TTL_MS = 4 * 60 * 60 * 1000;

/** Above this many journals mid-conversation, the expired ones are swept.
 *  Same shape as `lib/rateLimit.ts`, for the same reason. */
const MAX_THREADS = 1000;

const threads = new Map<string, { id: string; turns: Turn[]; touched: number }>();

/**
 * A name for one conversation — B976.
 *
 * The thread is keyed by journal, which is all it ever needed while nothing
 * outlived it. Storing what happened needs the turns of one sitting to be
 * grouped, and a person returning to an older conversation needs it to have a
 * name they can be sent back to.
 *
 * Minted when a conversation starts and dropped with it, so it lives exactly
 * as long as the conversation does: the same id for `TTL_MS` of talking,
 * a new one after `forget()` or after the TTL, which is the boundary a person
 * would draw too.
 */
function openThread(): { id: string; turns: Turn[]; touched: number } {
  return { id: newId(), turns: [], touched: Date.now() };
}

/** The conversation now in progress, starting one if there is none. */
export function sessionId(username: string): string {
  const thread = threads.get(username);
  if (thread && Date.now() - thread.touched < TTL_MS) return thread.id;
  const fresh = openThread();
  threads.set(username, fresh);
  return fresh.id;
}

function sweep(now: number) {
  if (threads.size <= MAX_THREADS) return;
  for (const [key, thread] of threads) {
    if (now - thread.touched >= TTL_MS) threads.delete(key);
  }
}

/** What has been said in this journal's conversation so far, oldest first. */
export function history(username: string): Turn[] {
  const thread = threads.get(username);
  if (!thread) return [];
  if (Date.now() - thread.touched >= TTL_MS) {
    threads.delete(username);
    return [];
  }
  return thread.turns;
}

/**
 * Add an exchange to the conversation.
 *
 * **A refused sentence is never remembered**, and that is a gate rather than
 * tidiness: B817 keeps removal language away from the model by matching it
 * before the model is called, and a refused sentence written into the history
 * would reach the model on the *next* turn instead. The route calls this only
 * on a turn that was actually answered.
 */
export function remember(username: string, said: string, answered: string): void {
  const now = Date.now();
  const turns = trimmed([
    ...history(username),
    { role: "user" as const, text: said },
    { role: "assistant" as const, text: answered },
  ]);
  threads.set(username, { id: sessionId(username), turns, touched: now });
  sweep(now);
}

/**
 * Twelve turns, and **the conversation knows when it dropped one** — B957.
 *
 * The trim itself is right and is a cost decision: every remembered turn is
 * paid for again on the next one. What was wrong is that it was invisible, so
 * the model could not tell a short conversation from a long one it had lost
 * the beginning of — and it does not behave as though it might be either.
 *
 * Somebody twenty-four turns into writing up a fifteen-day trip asked whether
 * they had said who they were travelling with. They had, in their first
 * message. Rather than say it was out of reach, the model read an unrelated
 * day, called it "the first day", and answered from its prose — confidently,
 * and wrongly. Their own words: *"it never admits a memory limit; it
 * fabricates a confident, wrong, artifact-grounded answer instead. That is the
 * hardest failure mode for a real user to catch, because it reads exactly like
 * a correct answer."*
 *
 * One note, replaced rather than accumulated: the fact is "the beginning is
 * gone", not "the beginning is gone, and again, and again".
 */
const FORGOT = "[earlier turns of this conversation are no longer in front of you: say so rather than answering from a day's prose, and ask them to tell you again]";

function trimmed(turns: Turn[]): Turn[] {
  if (turns.length <= MAX_TURNS) return turns;
  const kept = turns.slice(-MAX_TURNS);
  return kept.some((turn) => turn.text === FORGOT)
    ? kept
    : [{ role: "note" as const, text: FORGOT }, ...kept.slice(1)];
}

/**
 * Add a line the **model** reads and the person never sees — B924.
 *
 * It is kept in the same list so the ordering is right (a proposal is waiting
 * *after* that answer and *before* the next sentence), and `model.ts` is what
 * knows a note is not a turn.
 */
export function note(username: string, text: string): void {
  const now = Date.now();
  const turns = trimmed([...history(username), { role: "note" as const, text }]);
  threads.set(username, { id: sessionId(username), turns, touched: now });
  sweep(now);
}

/**
 * A write tool offered a proposal, in words the model can read back — B926.
 *
 * **Every proposal a person can see must enter the conversation, not only the
 * ones the model itself made this turn.** `start_day` chaining straight to
 * `draft_words` (B969) is answered by `POST /api/helper/<user>/proposal`
 * without calling the model at all, and that route used to leave the thread
 * untouched — so a person who read their notes into the day, had `start_day`
 * chain to a `draft_words` card carrying those notes, and then had that
 * *press* fail (a transient model error, no credits, anything) was left with
 * a conversation that had never heard of the draft it was shown. The only
 * trace of their notes was an *earlier* `start_day` proposal, itself since
 * marked `[written: start_day …]` — a stale, contradictory note about the
 * wrong tool. Asked to try again, the model had nothing but that to go on and
 * asked for the notes over.
 *
 * So both places a proposal reaches a screen — a model's own tool call
 * (`app/api/helper/[user]/ask/route.ts`) and a chained one with no model in
 * the loop (`app/api/helper/[user]/proposal/route.ts`) — call this, once,
 * rather than each writing the marker line by hand.
 */
export function proposed(username: string, tool: string, args: Record<string, string>): void {
  note(username, `[proposed, not written, waiting to be pressed: ${tool} ${JSON.stringify(args)}]`);
}

/**
 * What a write route did, in the conversation the proposal came from — B939.
 *
 * **The note belongs to the write, not to the client.** It used to be posted
 * by the browser after a successful press — a second call, from
 * `components/HelperAsk.tsx`, saying "that one went through". It worked, and
 * a tester who pressed the same routes with `curl` instead was told on the
 * next turn that their trip was *"waiting for you to press"* while it sat on
 * disk. The knowledge that a write must be announced lived in a React
 * component, so every other caller — a script, a second tab, a phone client
 * (B674) — left the conversation believing nothing had happened.
 *
 * `facts` is what the **route** produced rather than what it was given, which
 * is the other half. The old note was built from the proposal's arguments, so
 * it carried the trip's title and never the id the server derives at
 * creation: asked outright, the model said it did not know the id — honest,
 * and one question away from being unable to answer.
 */
export function wrote(username: string, tool: string, facts: Record<string, unknown>): void {
  note(username, `[written: ${tool} ${JSON.stringify(facts)}]`);
  /**
   * And kept — B976. Every successful write already passes through here, which
   * makes it the one place a press can be counted without eight routes each
   * remembering to.
   *
   * The pair with the turn's own `proposed` is what the data is for: a
   * proposal made and never pressed is the clearest failure signal this
   * product has. B935, B936 and B968 were each a proposal no press could
   * accept, and every one of them was found by a person driving the live site.
   */
  void recordPress({ owner: username, session: sessionId(username), tool, ok: true });
}

/**
 * A press the route would not take — B976, and the more informative half.
 *
 * Nothing is noted for the model: it already learns what happened from the
 * route's own answer, and a refusal written into the conversation would be a
 * fact about plumbing in the middle of somebody's holiday (B964).
 *
 * What this is for is the operator. `invalid_cost` on a category the model
 * supplied is exactly B968, which reached a live instance and was found by a
 * person pressing a card and reading the error — twice, on both of the costs
 * they logged.
 */
export function refused(username: string, tool: string, error: string): void {
  void recordPress({ owner: username, session: sessionId(username), tool, ok: false, error });
}

/**
 * End a conversation.
 *
 * `DELETE /api/helper/<user>/ask` is what calls this — B899. A person who has
 * confused the thread used to wait half an hour for the TTL; starting over is
 * a control now, because a conversation you cannot end is one you stop
 * trusting.
 */
export function forget(username: string): void {
  threads.delete(username);
}
