import "server-only";

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
 * In this process's memory, keyed by journal, for half an hour.
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

/** Half an hour of nothing said, and the conversation is over. Somebody
 *  returning after that is starting again, which is what they expect. */
const TTL_MS = 30 * 60 * 1000;

/** Above this many journals mid-conversation, the expired ones are swept.
 *  Same shape as `lib/rateLimit.ts`, for the same reason. */
const MAX_THREADS = 1000;

const threads = new Map<string, { turns: Turn[]; touched: number }>();

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
  const turns = [
    ...history(username),
    { role: "user" as const, text: said },
    { role: "assistant" as const, text: answered },
  ].slice(-MAX_TURNS);
  threads.set(username, { turns, touched: now });
  sweep(now);
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
  const turns = [...history(username), { role: "note" as const, text }].slice(-MAX_TURNS);
  threads.set(username, { turns, touched: now });
  sweep(now);
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
