import type { MigrationDb } from "./types";

/**
 * What happened in a conversation with the helper — B976.
 *
 * The owner asked to collect sessions so that, as operator, they could analyse
 * and improve them. Nothing was kept: `lib/helper/thread.ts` holds a
 * conversation in process memory for half an hour and drops it on every
 * deploy, and thirty-four deploys in one day each wiped every conversation on
 * the instance.
 *
 * **This is not `usage`, and the difference is the point.** That table is what
 * the instance was *charged* — tokens and seconds, per call. This is what
 * *happened* — which tools ran, what was proposed, whether anybody pressed it,
 * and which honesty guard fired. The first answers "what did last month cost";
 * only the second answers "what should we fix".
 *
 * ## Two kinds of row, and why they are one table
 *
 * A **turn** is somebody saying something and being answered. A **press** is
 * them accepting a proposal. They are one table because the only question
 * worth asking spans both — *a proposal was made, was it pressed?* — and a
 * join across two tables to answer it would be a join written wrong.
 *
 * That question is the clearest failure signal this product has, and today
 * nothing counts it.
 *
 * ## The words are the exception, not the rule
 *
 * `said` and `answered` are null unless the journal's owner consented
 * (`sessions` in `lib/helper/consent.ts`). Everything else is recorded for
 * everybody, because none of it is anybody's private business: a tool name is
 * not a holiday.
 *
 * The helper is **owner-only** — every `/api/helper/**` route gates on
 * `isHelperOwner` — so a transcript here holds the words of the person who
 * agreed to it and of nobody else. No guest, no buddy and no reader can reach
 * it. That is what makes consent sufficient rather than a formality.
 *
 * Kept indefinitely, which was decided rather than defaulted: the alternative
 * offered was a ninety-day sweep of anything carrying words.
 *
 * `owner_id` is the **username**, per the first convention in
 * `lib/db/owner.ts`, so a journal's rows go when the journal does
 * (`lib/deletions.ts`). A deleted journal that left its conversations behind
 * would not be a retention policy; it would be a bug.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db.schema
    .createTable("helper_sessions")
    .addColumn("id", "text", (c) => c.primaryKey().notNull())
    .addColumn("owner_id", "text", (c) => c.notNull())
    // One conversation. Minted when a thread starts and dropped with it, so it
    // lives exactly as long as the conversation does — which is what makes
    // "how many turns did that take" answerable at all.
    .addColumn("session_id", "text", (c) => c.notNull())
    // "turn" | "press". Text for the reason every other status column in this
    // schema is text: Postgres needs `create type` for a fixed list and SQLite
    // has no such thing. The list lives in lib/helper/sessions.ts.
    .addColumn("kind", "text", (c) => c.notNull())
    // Which language the person was answered in — B921 made this follow the
    // journal rather than the phone, and B972 the message rather than the
    // thread. Neither is checkable without knowing what actually happened.
    .addColumn("locale", "text", (c) => c.notNull().defaultTo(""))
    // A turn: the read tools that ran, comma-separated in the order they ran.
    // A press: empty.
    .addColumn("tools", "text", (c) => c.notNull().defaultTo(""))
    // A turn: the write tools it proposed. A press: the one tool pressed.
    // Together with `ok` below, this is the acceptance rate.
    .addColumn("proposed", "text", (c) => c.notNull().defaultTo(""))
    // Which honesty guard fired, if one did — "claim", "pending", "words",
    // "access", "day", "up", "total", "partial", "invented" — and whether the
    // retry recovered. Three process-global integers were the whole of this
    // before, reset on every restart.
    .addColumn("guard", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("recovered", "integer", (c) => c.notNull().defaultTo(0))
    // A press: whether the route accepted it, and the refusal if not. A
    // proposal nobody could press is the fault B968 and B935 were both about,
    // and both were found by a person driving the site rather than by this.
    .addColumn("ok", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("error", "text", (c) => c.notNull().defaultTo(""))
    // How many turns the thread held when this one ran. B957 is why: the
    // conversation forgets at twelve, and whether that hurts is a number
    // nobody has.
    .addColumn("thread_turns", "integer", (c) => c.notNull().defaultTo(0))
    // Null unless the owner consented. Not empty string — the difference
    // between "they said nothing" and "we do not keep their words" is a
    // difference this table has to be able to state.
    .addColumn("said", "text")
    .addColumn("answered", "text")
    .addColumn("created_at", "text", (c) => c.notNull())
    .execute();

  // The three questions: a period's rows, one journal's rows within it, and
  // one conversation's rows in order.
  await db.schema
    .createIndex("helper_sessions_created")
    .on("helper_sessions")
    .columns(["created_at"])
    .execute();
  await db.schema
    .createIndex("helper_sessions_owner")
    .on("helper_sessions")
    .columns(["owner_id", "created_at"])
    .execute();
  await db.schema
    .createIndex("helper_sessions_session")
    .on("helper_sessions")
    .columns(["session_id", "created_at"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("helper_sessions_session").execute();
  await db.schema.dropIndex("helper_sessions_owner").execute();
  await db.schema.dropIndex("helper_sessions_created").execute();
  await db.schema.dropTable("helper_sessions").execute();
}
