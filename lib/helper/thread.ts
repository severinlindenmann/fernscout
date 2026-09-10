import "server-only";
import { getDatabaseOrNull } from "../db";
import { newId } from "../db/owner";
import { trustedCaller } from "./caller";
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
 * ## Where the conversation lives — B1054
 *
 * A `Map`, anchored on `globalThis` for the reason B1168's comment on it
 * gives, **is still the fast path**: within one warm process, every read and
 * write here is exactly as cheap as it always was. What changed is that the
 * Map is no longer the *only* copy. `helper_threads` (one row per journal,
 * `lib/db/migrations/029-helper-threads.ts`) holds the same state durably,
 * written fire-and-forget on every mutation and read back only on a cold
 * cache — the first read for a journal since a restart, or after its TTL has
 * quietly run out. A second door (WhatsApp) and a browser restart both need
 * exactly this: not a faster Map, a Map that survives losing the process.
 *
 * **Notes are model-only, still.** `proposed()`, `wrote()` and `refused()`
 * push `[proposed: …]` turns the person never sees, and `model.ts` folds them
 * onto the *next* user message rather than sending them as turns of their own
 * (B924). They are part of the same `turns` array and travel through the same
 * persistence — there was never a reason to keep them out of it.
 *
 * **Durability is best-effort.** A failed database write leaves the in-memory
 * copy — which is still correct for this process — as the only one, exactly
 * as it always was before this table existed; nothing here throws for it.
 */

/** Which door the conversation is happening through, and (since B1054) which
 *  door said or heard one particular turn. Not a `Caller["how"]` from
 *  `./caller.ts` — that answers who proved a request, this answers where a
 *  turn was said, and a `cookie`-proven caller's turns are always `web`. */
export type Channel = "web" | "whatsapp";

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
 *
 * `origin` is absent on a note (nobody's door said it) and on a turn nobody
 * has ever marked — every row written before B1054 — and present on every
 * turn written after: which door this half of the exchange happened on.
 */
export type Turn = { role: "user" | "assistant" | "note"; text: string; origin?: Channel };

/**
 * How much of a conversation is remembered.
 *
 * Six exchanges. Beyond that a person is on a different subject, and every
 * remembered turn is paid for again on the next one. A token budget, not an
 * artefact of living in memory — a longer-lived WhatsApp thread needs this
 * trim more, not less.
 */
/**
 * Sixteen since B1198 — twelve ran out at seven exchanges, inside one
 * ordinary sitting: a persona was told "I don't have the earlier turns in
 * front of you" about a suggestion the model had made two turns before,
 * which is honest and reads as malfunction. Eight exchanges clears a real
 * sitting; the budget this trades against is B1053's to win back.
 */
const MAX_TURNS = 16;

/**
 * What ends a conversation, per channel — B1054, and B1109 before it.
 *
 * A gap this long ends a conversation by itself, because coming back after it
 * is starting again — what a person expects. **The number is not the same for
 * both doors.** A web room is a sitting: somebody sits down, works, and the
 * old thirty-minute figure was the bug B1109 fixed (see the history on that
 * ticket) by widening it to four hours. A messenger is read once at the end
 * of a day; at thirty minutes, or even four hours, every WhatsApp message
 * would be a cold start and the model would re-ask which trip and which day
 * on every single one. So WhatsApp gets a day's own worth of quiet — long
 * enough that "yesterday" still means something the next evening — and the
 * web room keeps the shorter number that already works for it.
 *
 * `MAX_TURNS` above still caps what a model is shown regardless of how long
 * the thread has lived, so a longer TTL costs nothing per turn.
 */
const TTL_MS: Record<Channel, number> = {
  web: 4 * 60 * 60 * 1000,
  whatsapp: 24 * 60 * 60 * 1000,
};

function ttlFor(channel: Channel): number {
  return TTL_MS[channel];
}

/** Above this many journals mid-conversation, the expired ones are swept.
 *  Same shape as `lib/rateLimit.ts`, for the same reason. */
const MAX_THREADS = 1000;

type ThreadState = { id: string; turns: Turn[]; touched: number; channel: Channel };

/**
 * Anchored on `globalThis`, not a bare module-level `Map` — B1168.
 *
 * Next compiles the page and each route handler as separate server chunks,
 * and a module can be instantiated once per chunk: `app/agent/page.tsx`
 * adopting a conversation wrote into one Map while the ask route answered
 * from another, so the adoption silently never happened. This is the
 * *cache* now, not the only copy (see the module doc), so a chunk starting
 * with an empty Map simply hydrates from `helper_threads` on its first read.
 */
const threads = ((globalThis as { __fsHelperThreads?: Map<string, ThreadState> })
  .__fsHelperThreads ??= new Map());

function openThread(channel: Channel): ThreadState {
  return { id: newId(), turns: [], touched: Date.now(), channel };
}

/** Whether a thread — cached or freshly loaded — is still inside its own
 *  channel's TTL. A type guard so a caller can narrow `ThreadState |
 *  undefined` in one line. */
function isFresh(thread: ThreadState | undefined, now = Date.now()): thread is ThreadState {
  return thread !== undefined && now - thread.touched < ttlFor(thread.channel);
}

function sweep(now: number) {
  if (threads.size <= MAX_THREADS) return;
  for (const [key, thread] of threads) {
    if (!isFresh(thread, now)) threads.delete(key);
  }
}

/**
 * One journal's durable reads and writes, in the order they were issued —
 * B1362.
 *
 * Fire-and-forget is right (see `persist`) and *unordered* is not. Every
 * function below opens its own promise chain, so on an asynchronous driver
 * they land in whatever order the pool feels like: a `forget()` whose `DELETE`
 * overtakes the `UPSERT` fired a moment before it leaves the row behind, and
 * the next cold read resurrects a conversation the person ended. On
 * `better-sqlite3` — synchronous, one statement at a time — that could not
 * happen, which is why it was CI's Postgres leg and not a laptop that found
 * it: `forget ends the adopted conversation like any other` and the WhatsApp
 * "new chat" command both failed there and nowhere else.
 *
 * Serialising per journal is enough, because a journal is the row: two
 * journals have nothing to order against each other, and holding one queue
 * for the whole instance would put every conversation behind the slowest
 * write. Reads go through it too — a read is what a stale write corrupts, and
 * `loadFromDb` after a `drop` must see the drop.
 *
 * The tail is dropped once nothing is queued behind it, so this map does not
 * grow with the number of journals ever seen.
 */
const inFlight = new Map<string, Promise<unknown>>();

function serial<T>(username: string, run: () => Promise<T>): Promise<T> {
  const next = (inFlight.get(username) ?? Promise.resolve()).then(run, run);
  const settled = next.catch(() => undefined);
  inFlight.set(username, settled);
  void settled.then(() => {
    if (inFlight.get(username) === settled) inFlight.delete(username);
  });
  return next;
}

/**
 * Fire-and-forget durability for one journal's thread — B1054.
 *
 * One row per journal (`onConflict` on `owner_id`), so a journal never holds
 * two live rows to disagree with itself. Never awaited by a caller: the
 * in-memory cache has already been updated by the time this is called, so a
 * person's turn is never waiting on a database write to feel instant.
 */
function persist(username: string, state: ThreadState): void {
  void serial(username, async () => {
    try {
      const handle = await getDatabaseOrNull();
      if (!handle) return;
      const row = {
        session_id: state.id,
        channel: state.channel,
        turns: JSON.stringify(state.turns),
        touched_at: new Date(state.touched).toISOString(),
      };
      await handle.db
        .insertInto("helper_threads")
        .values({ owner_id: username, ...row })
        .onConflict((oc) => oc.column("owner_id").doUpdateSet(row))
        .execute();
    } catch {
      // Best-effort — see the module doc. The in-memory cache still holds
      // the correct state for this process.
    }
  });
}

function drop(username: string): void {
  void serial(username, async () => {
    try {
      const handle = await getDatabaseOrNull();
      if (!handle) return;
      await handle.db.deleteFrom("helper_threads").where("owner_id", "=", username).execute();
    } catch {
      // As above.
    }
  });
}

function loadFromDb(username: string): Promise<ThreadState | null> {
  return serial(username, () => readFromDb(username));
}

async function readFromDb(username: string): Promise<ThreadState | null> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return null;
    const row = await handle.db
      .selectFrom("helper_threads")
      .selectAll()
      .where("owner_id", "=", username)
      .executeTakeFirst();
    if (!row) return null;
    const channel: Channel = row.channel === "whatsapp" ? "whatsapp" : "web";
    let turns: Turn[] = [];
    try {
      const parsed: unknown = JSON.parse(row.turns);
      if (Array.isArray(parsed)) turns = parsed as Turn[];
    } catch {
      turns = [];
    }
    const state: ThreadState = { id: row.session_id, turns, touched: new Date(row.touched_at).getTime(), channel };
    return isFresh(state) ? state : null;
  } catch {
    return null;
  }
}

/**
 * The live thread for this journal — the cache if it is warm, the database
 * if it is not, `undefined` if neither has one that is still inside its TTL.
 *
 * The only place a database read happens in this file; every mutation below
 * reads the cache directly instead, because by the time one runs, whatever
 * called it has already resolved this once in the same request (see
 * `app/api/helper/[user]/ask/route.ts`).
 */
async function live(username: string): Promise<ThreadState | undefined> {
  const cached = threads.get(username);
  if (isFresh(cached)) return cached;
  if (cached) threads.delete(username);
  const loaded = await loadFromDb(username);
  if (!loaded) return undefined;
  threads.set(username, loaded);
  return loaded;
}

/** The cache only, read synchronously — what `remember`/`note`/`wrote`
 *  and their neighbours use. They run after a request has already resolved
 *  `live()` once (the ask route reads `history()` before it ever writes), so
 *  the cache is warm; a cold cache here behaves exactly as it always did
 *  before this table existed, which is "start a new thread". */
function cached(username: string): ThreadState | undefined {
  const thread = threads.get(username);
  if (!isFresh(thread)) {
    if (thread) threads.delete(username);
    return undefined;
  }
  return thread;
}

function syncSessionId(username: string, channel: Channel = "web"): string {
  const thread = cached(username);
  if (thread) return thread.id;
  const opened = openThread(channel);
  threads.set(username, opened);
  persist(username, opened);
  return opened.id;
}

function syncTurns(username: string): Turn[] {
  return cached(username)?.turns ?? [];
}

/** The conversation now in progress, starting one if there is none. */
export async function sessionId(username: string, channel: Channel = "web"): Promise<string> {
  const thread = await live(username);
  if (thread) return thread.id;
  return syncSessionId(username, channel);
}

/** What has been said in this journal's conversation so far, oldest first. */
export async function history(username: string): Promise<Turn[]> {
  const thread = await live(username);
  return thread?.turns ?? [];
}

/**
 * When this thread was last touched, in epoch milliseconds — `null` for no
 * live thread at all — B1303.
 *
 * The system prompt has always promised "long gap, new subject: ask —
 * continue, or fresh" with nothing behind it: `Turn` carries no timestamp, so
 * the model had no way to know how long ago the previous turn was short of
 * the thread having actually expired. This is what a caller reads *before*
 * that expiry to fold an honest elapsed-time note in — see
 * `lib/whatsapp/dispatch.ts`.
 */
export async function lastTouched(username: string): Promise<number | null> {
  const thread = await live(username);
  return thread?.touched ?? null;
}

/**
 * Add an exchange to the conversation.
 *
 * **A refused sentence is never remembered**, and that is a gate rather than
 * tidiness: B817 keeps removal language away from the model by matching it
 * before the model is called, and a refused sentence written into the history
 * would reach the model on the *next* turn instead. The route calls this only
 * on a turn that was actually answered.
 *
 * `channel` marks both halves of this exchange with where they happened
 * (B1054's "every turn carries its origin") and decides which TTL the thread
 * now runs on — the channel of the *most recent* touch, so a WhatsApp reply
 * into a thread a browser started keeps it alive on WhatsApp's clock from
 * then on.
 */
export function remember(username: string, said: string, answered: string, channel: Channel = "web"): void {
  const now = Date.now();
  const turns = trimmed([
    ...syncTurns(username),
    { role: "user" as const, text: said, origin: channel },
    { role: "assistant" as const, text: answered, origin: channel },
  ]);
  const id = syncSessionId(username, channel);
  const state: ThreadState = { id, turns, touched: now, channel };
  threads.set(username, state);
  persist(username, state);
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
const FORGOT = "[the earliest turns of this conversation are no longer in front of you. If they ask about something you cannot see, ask them to say it again in a word or two — never announce a memory problem unprompted, and never answer from a day's prose instead]";

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
export function note(username: string, text: string, channel: Channel = "web"): void {
  const now = Date.now();
  const turns = trimmed([...syncTurns(username), { role: "note" as const, text }]);
  const id = syncSessionId(username, channel);
  const state: ThreadState = { id, turns, touched: now, channel };
  threads.set(username, state);
  persist(username, state);
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
/**
 * The channel a call carries when nobody names one — B1230.
 *
 * `proposed()`, `wrote()` and `refused()` below all defaulted to `"web"`
 * (B1193's own fix threaded an explicit `channel` through the two WhatsApp
 * call sites that existed then). Since B1230 a route's own `wrote()` call
 * runs *inside* a WhatsApp accept tap too — `lib/helper/caller.ts`'s
 * `runAsCaller` — and that route has no `channel` argument to pass, having
 * been written once for a browser's cookie session. Reading the same trusted
 * caller `isHelperOwner` already reads is what lets that note land on
 * `"whatsapp"` without touching the route at all.
 */
function ambientChannel(): Channel {
  return trustedCaller()?.how === "whatsapp" ? "whatsapp" : "web";
}

export function proposed(username: string, tool: string, args: Record<string, string>, channel: Channel = ambientChannel()): void {
  note(username, `[proposed, not written, waiting to be pressed: ${tool} ${JSON.stringify(args)}]`, channel);
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
export function wrote(username: string, tool: string, facts: Record<string, unknown>, channel: Channel = ambientChannel()): void {
  note(username, `[written: ${tool} ${JSON.stringify(facts)}]`, channel);
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
  void recordPress({ owner: username, session: syncSessionId(username, channel), tool, ok: true });
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
  void recordPress({ owner: username, session: syncSessionId(username), tool, ok: false, error });
}

/**
 * The conversation that is actually live, or `null` — B1168.
 *
 * `sessionId()` above answers "which id would a turn land under", minting a
 * fresh thread to do it; this answers the read-only half — is there a
 * conversation in progress at all — which is what lets `/agent` resume only
 * what a next sentence would truly continue, instead of drawing a dead
 * conversation as though typing would extend it.
 */
export async function liveSession(username: string): Promise<string | null> {
  const thread = await live(username);
  return thread ? thread.id : null;
}

/**
 * Make a stored conversation the live one — B1168.
 *
 * Reopening used to be reading only: the turns were drawn from
 * `helper_sessions`, and the next sentence extended whatever thread happened
 * to be in memory, recorded under *its* id — so the continuation of the
 * conversation on screen landed in the history as a separate one-turn
 * conversation. Adopting closes that gap: the thread takes the stored
 * session's id and its last turns, so what is on screen and what answers are
 * the same conversation again — and, since B1054, that adoption is itself
 * written through to `helper_threads`, so it survives a restart too.
 *
 * A no-op when that session is already live — reopening the conversation you
 * are in must not reset its clock or its turns.
 */
export async function adopt(
  username: string,
  session: string,
  turns: { said: string | null; answered: string | null; origin?: string | null }[],
): Promise<void> {
  const now = threads.get(username);
  if (now && now.id === session && isFresh(now)) return;
  /**
   * **The durable copy, not the analytics log, when both name this same
   * session — B1243.** `turns` above is read from `helper_sessions`, which
   * never carries a note (`proposed()`/`wrote()` write only to
   * `helper_threads`, B924/B939). A cold cache — the first request on a
   * fresh process, or simply a worker that has not touched this journal yet
   * — used to fall straight to rebuilding from that note-free log even when
   * the session being reopened is the very session `helper_threads` still
   * holds in full: a pressed write's own note, and everything that made the
   * proposal make sense, silently gone the moment somebody reopened the
   * conversation that already knew it. Reloading the durable row and using
   * *its* turns whenever its id matches keeps the notes; only a session
   * `helper_threads` no longer holds (a genuinely older, superseded one)
   * falls back to reconstructing from what `helper_sessions` kept instead.
   */
  const durable = await loadFromDb(username);
  if (durable && durable.id === session) {
    threads.set(username, durable);
    persist(username, durable);
    return;
  }
  const flat: Turn[] = [];
  for (const turn of turns) {
    const origin: Channel | undefined = turn.origin === "whatsapp" ? "whatsapp" : turn.origin === "web" ? "web" : undefined;
    if (turn.said) flat.push({ role: "user", text: turn.said, ...(origin ? { origin } : {}) });
    if (turn.answered) flat.push({ role: "assistant", text: turn.answered, ...(origin ? { origin } : {}) });
  }
  // The channel this thread runs its TTL on from here: whatever the most
  // recent turn was marked with, or `web` — the only door that can reopen a
  // conversation this way today.
  const channel: Channel = flat.length > 0 && flat[flat.length - 1].origin === "whatsapp" ? "whatsapp" : "web";
  const state: ThreadState = { id: session, turns: trimmed(flat), touched: Date.now(), channel };
  threads.set(username, state);
  persist(username, state);
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
  drop(username);
}
