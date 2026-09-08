import "server-only";
import { getDatabaseOrNull } from "../db";
import { newId } from "../db/owner";
import { hasHelperConsent } from "./consent";

/**
 * What happened in a conversation, kept — B976.
 *
 * The owner asked to collect sessions so that, as operator, they could analyse
 * and improve them. Nothing was kept: `./thread.ts` holds a conversation in
 * process memory for half an hour and drops it on every deploy.
 *
 * ## Two things, and only one of them is about the operator
 *
 * **The words are the person's own history.** A conversation they can return
 * to is a conversation that was saved, so `said` and `answered` are written
 * for every journal. That is a feature they asked for, not a study of them.
 *
 * **Consent decides whether the operator may read them.** `sessions` in
 * `./consent.ts`, revocable on `/<user>/me`. Turning it off deletes nothing
 * and stops nothing being written — it stops somebody else reading it — and
 * both the panel and the first message of a conversation say so in those
 * words, because a person who assumed otherwise would be misled by silence.
 *
 * What makes that workable rather than a formality: the helper is
 * **owner-only**. Every `/api/helper/**` route gates on `isHelperOwner`, so a
 * stored conversation holds the words of one person and that person is the one
 * who reads it back.
 *
 * ## Never throws
 *
 * The same rule `recordUsage` follows and for the same reason: by the time
 * this runs, somebody has been given their answer. Losing the answer to an
 * analytics insert would be trading the product for the bookkeeping.
 */

/** A row is one of these. Text in the column, closed here. */
export const SESSION_KINDS = ["turn", "press"] as const;
type SessionKind = (typeof SESSION_KINDS)[number];

/** One exchange: what was said, what came back, and what the turn did. */
export type TurnRecord = {
  owner: string;
  session: string;
  locale: string;
  /** Read tools that ran, in order. */
  tools: string[];
  /** Write tools that proposed something. */
  proposed: string[];
  /** Which honesty check caught it, and whether asking again worked. */
  guard: string;
  recovered: boolean;
  /** How many turns the thread held — B957 is why this is worth knowing. */
  threadTurns: number;
  said: string;
  answered: string;
};

/** One press of a proposal, and whether the route took it. */
export type PressRecord = {
  owner: string;
  session: string;
  tool: string;
  ok: boolean;
  /** The refusal, where there was one. `invalid_cost`, `unknown_trip`. */
  error?: string;
};

async function insert(row: Record<string, unknown>): Promise<void> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return;
    await handle.db
      .insertInto("helper_sessions")
      .values({ id: newId(), created_at: new Date().toISOString(), ...row } as never)
      .execute();
  } catch {
    // Deliberately silent. See the note above: this must never be the reason
    // somebody's turn failed, and a log line per dropped row on a database
    // that is down is a second problem on top of the first.
  }
}

/**
 * Record one exchange.
 *
 * **The words always go in.** They are the person's own history and returning
 * to a conversation is what they are for; a conversation that was not saved is
 * one nobody can come back to. Consent is not asked here and does not belong
 * here — it decides who **else** may read what is kept, which is a question
 * about a reader and is answered where the reading happens
 * (`operatorMayRead`).
 *
 * Writing it once, plainly, because the first version of this file got it
 * backwards: gating the write would have made the opt-out silently delete a
 * person's own history, which is neither what was asked for nor what anybody
 * would expect a privacy control to do.
 */
export async function recordTurn(turn: TurnRecord): Promise<void> {
  await insert({
    owner_id: turn.owner,
    session_id: turn.session,
    kind: "turn" satisfies SessionKind,
    locale: turn.locale,
    tools: turn.tools.join(","),
    proposed: turn.proposed.join(","),
    guard: turn.guard,
    recovered: turn.recovered ? 1 : 0,
    thread_turns: turn.threadTurns,
    said: turn.said,
    answered: turn.answered,
  });
}

/**
 * Record one press.
 *
 * **This is the half that makes the data worth having.** A proposal made and
 * never pressed is the clearest failure signal this product has, and nothing
 * counted it: B935, B936 and B968 were each a proposal no press could accept,
 * and all three were found by a person driving the live site rather than by
 * anything here.
 *
 * No words: a press carries none of the person's own prose, only which tool
 * and whether it worked.
 */
/**
 * Whether the operator may read this journal's conversations — B976.
 *
 * The whole of what the control on `/<user>/me` turns off, and the reason the
 * notice on the first message can say truthfully that turning it off deletes
 * nothing: what changes is a reader, not a record.
 */
export function operatorMayRead(username: string): boolean {
  return hasHelperConsent(username, "sessions");
}

export async function recordPress(press: PressRecord): Promise<void> {
  await insert({
    owner_id: press.owner,
    session_id: press.session,
    kind: "press" satisfies SessionKind,
    proposed: press.tool,
    ok: press.ok ? 1 : 0,
    error: press.error ?? "",
  });
}
