import "server-only";
import { getDatabaseOrNull } from "../db";
import { newId } from "../db/owner";
import { helperConsent } from "./consent";

/**
 * What happened in a conversation, kept — B976.
 *
 * The owner asked to collect sessions so that, as operator, they could analyse
 * and improve them. Nothing was kept: `./thread.ts` holds a conversation in
 * process memory for a few hours of inactivity (see its `TTL_MS`) and drops
 * it on every deploy.
 *
 * ## Two things, and only one of them is about the operator
 *
 * **The words are the person's own history.** A conversation they can return
 * to is a conversation that was saved, so `said` and `answered` are written
 * for every journal. That is a feature they asked for, not a study of them.
 *
 * **The operator may read them unless somebody says not to.** `sessions` in
 * `./consent.ts`, turned off on `/<user>/me`. It is on by default, which is a
 * decision and not an oversight — so the notice on the first message of a
 * conversation has to say that plainly rather than implying a permission
 * nobody gave. Turning it off deletes nothing and stops nothing being
 * written; it stops somebody else reading it.
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
  // **On unless somebody turned it off** — the default is opt-in, decided
  // after the first version had it the other way round. So the question is
  // not "did they agree" but "did they refuse", and a journal nobody has
  // touched is one the operator may read.
  return !(helperConsent(username)?.declined ?? []).includes("sessions");
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

/* ------------------------------------------------------ reading it back --- */

/** What one conversation looked like, for the person whose it is. */
export type SessionSummary = {
  session: string;
  from: string;
  to: string;
  turns: number;
  /** The first thing they said, which is what makes a list of conversations
   *  readable at all. */
  opening: string;
};

/**
 * The owner's own conversations, newest first — B976, and what B984's history
 * is built on.
 *
 * Their words, shown to them, with no consent involved: this is the reading
 * that makes keeping them worth anything to the person who wrote them.
 */
export async function sessionsOf(username: string, limit = 30): Promise<SessionSummary[]> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return [];
    const rows = await handle.db
      .selectFrom("helper_sessions")
      .select(["session_id", "created_at", "said"])
      .where("owner_id", "=", username)
      .where("kind", "=", "turn")
      .orderBy("created_at", "desc")
      .limit(limit * 40)
      .execute();

    const bySession = new Map<string, SessionSummary>();
    // Newest first, so the last row seen for a session is its oldest — which
    // is where both the start and the opening line come from.
    for (const row of rows) {
      const found = bySession.get(row.session_id);
      if (found) {
        found.turns += 1;
        found.from = row.created_at;
        if (row.said) found.opening = row.said;
        continue;
      }
      bySession.set(row.session_id, {
        session: row.session_id,
        from: row.created_at,
        to: row.created_at,
        turns: 1,
        opening: row.said ?? "",
      });
    }
    return [...bySession.values()].slice(0, limit);
  } catch {
    return [];
  }
}

/** One conversation, oldest first — what reopening it draws. */
export async function turnsIn(username: string, session: string) {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return [];
    return await handle.db
      .selectFrom("helper_sessions")
      .select(["created_at", "said", "answered"])
      .where("owner_id", "=", username)
      // Scoped to the journal as well as to the session: an id is a random
      // string, and this is still not a thing to look up by id alone.
      .where("session_id", "=", session)
      .where("kind", "=", "turn")
      .orderBy("created_at")
      .execute();
  } catch {
    return [];
  }
}

/** What the operator can see about one journal, over a period. */
export type SessionStats = {
  owner: string;
  turns: number;
  sessions: number;
  proposed: number;
  pressed: number;
  refused: number;
  guards: { guard: string; count: number }[];
  /** Whether this journal's words may be read at all. */
  readable: boolean;
};

/**
 * What happened across the instance, per journal — B976.
 *
 * **No words.** This answers "what should we fix", and none of it is anybody's
 * private business: a tool name is not a holiday. The words are a separate
 * question with a separate switch, and a page that mixed the two would make
 * the switch meaningless.
 *
 * `proposed` against `pressed` is the number this was built for. A proposal
 * made and never pressed is the clearest failure signal this product has:
 * B935, B936 and B968 were each a proposal no press could accept, and all
 * three were found by a person driving the live site rather than by anything
 * that counted.
 */
export async function sessionStats(since: string): Promise<SessionStats[]> {
  try {
    const handle = await getDatabaseOrNull();
    if (!handle) return [];
    const rows = await handle.db
      .selectFrom("helper_sessions")
      .select(["owner_id", "session_id", "kind", "proposed", "guard", "ok"])
      .where("created_at", ">=", since)
      .execute();

    type Building = SessionStats & { seen: Set<string>; fired: Map<string, number> };
    const byOwner = new Map<string, Building>();
    for (const row of rows) {
      let stat = byOwner.get(row.owner_id);
      if (!stat) {
        stat = {
          owner: row.owner_id,
          turns: 0,
          sessions: 0,
          proposed: 0,
          pressed: 0,
          refused: 0,
          guards: [],
          readable: operatorMayRead(row.owner_id),
          seen: new Set<string>(),
          fired: new Map<string, number>(),
        };
        byOwner.set(row.owner_id, stat);
      }
      stat.seen.add(row.session_id);
      if (row.kind === "turn") {
        stat.turns += 1;
        if (row.proposed !== "") stat.proposed += row.proposed.split(",").length;
        if (row.guard !== "") stat.fired.set(row.guard, (stat.fired.get(row.guard) ?? 0) + 1);
      } else if (row.ok) {
        stat.pressed += 1;
      } else {
        stat.refused += 1;
      }
    }

    return [...byOwner.values()]
      .map(({ seen, fired, ...stat }) => ({
        ...stat,
        sessions: seen.size,
        guards: [...fired.entries()]
          .map(([guard, count]) => ({ guard, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.turns - a.turns);
  } catch {
    return [];
  }
}
