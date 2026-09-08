import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { recordHelperConsent, revokeHelperConsent } from "@/lib/helper/consent";
import { SESSION_KINDS, operatorMayRead, recordPress, recordTurn } from "@/lib/helper/sessions";
import { forget, sessionId, wrote } from "@/lib/helper/thread";

/**
 * What is kept about a conversation, and what is not — B976.
 *
 * Nothing was, before this: `lib/helper/thread.ts` holds a conversation in
 * process memory for half an hour and drops it on every deploy. The owner
 * asked to collect sessions so that, as operator, they could analyse and
 * improve them.
 *
 * The two halves, which are what these tests are about:
 *
 * - **The words are the person's own history.** They are kept for every
 *   journal, because being able to return to a conversation is a thing that
 *   was asked for and their own words are theirs.
 * - **Consent decides whether the operator may read them**, and turning it
 *   off deletes nothing and stops nothing being written.
 */

let dir: string;

async function rows() {
  const { db } = (await getDatabase())!;
  return db.selectFrom("helper_sessions").selectAll().orderBy("created_at").execute();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sessions-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  clearConfigCache();
  clearUserCache();
  forget("alex");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  forget("alex");
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

const TURN = {
  owner: "alex",
  session: "s1",
  locale: "de",
  tools: ["trips", "days"],
  proposed: ["start_day"],
  guard: "",
  recovered: false,
  threadTurns: 4,
  said: "mach mir den 2. mai",
  answered: "Ein Tag für den 2. Mai wartet auf deinem Bildschirm.",
};

describe("what a turn leaves behind", () => {
  test("what happened is kept for everybody", async () => {
    await recordTurn(TURN);
    const [row] = await rows();
    expect(row.kind).toBe("turn");
    expect(row.owner_id).toBe("alex");
    expect(row.tools).toBe("trips,days");
    expect(row.proposed).toBe("start_day");
    expect(row.locale).toBe("de");
    expect(row.thread_turns).toBe(4);
  });

  test("and the words are kept too, because they are theirs to come back to", async () => {
    await recordTurn(TURN);
    const [row] = await rows();
    expect(row.said).toBe("mach mir den 2. mai");
    expect(row.answered).toContain("wartet");
  });

  test("which guard caught it, and whether asking again worked", async () => {
    await recordTurn({ ...TURN, guard: "pending", recovered: true });
    const [row] = await rows();
    expect(row.guard).toBe("pending");
    expect(row.recovered).toBe(1);
  });
});

/**
 * The scope is not the other four. `words`, `photos` and `speech` record who a
 * person's things are **sent to**; this one sends nothing anywhere and decides
 * who may **read** what is already kept.
 */
describe("who may read them", () => {
  test("what is kept does not depend on it — the words are theirs either way", async () => {
    revokeHelperConsent("alex", "sessions");
    await recordTurn(TURN);
    const [row] = await rows();
    expect(row.said).toBe("mach mir den 2. mai");
    expect(row.answered).toContain("wartet");
  });

  test("what changes is whether the operator may read them", () => {
    revokeHelperConsent("alex", "sessions");
    expect(operatorMayRead("alex")).toBe(false);
    recordHelperConsent("alex", "this instance", "sessions");
    expect(operatorMayRead("alex")).toBe(true);
  });

  /**
   * The first version of this gated the **write**, which would have made the
   * opt-out silently delete somebody's own history — neither what was asked
   * for nor what anybody expects a privacy control to do. Turning it off
   * changes a reader, not a record, and both the panel and the first message
   * of a conversation say so in those words.
   */
  test("turning it off deletes nothing that was already kept", async () => {
    recordHelperConsent("alex", "this instance", "sessions");
    await recordTurn(TURN);
    revokeHelperConsent("alex", "sessions");
    await recordTurn({ ...TURN, said: "und jetzt?", answered: "Nichts." });

    const [first, second] = await rows();
    expect(first.said).toBe("mach mir den 2. mai");
    expect(second.said).toBe("und jetzt?");
    expect(operatorMayRead("alex")).toBe(false);
  });
});

/**
 * The pair that makes the data worth having — a proposal made and never
 * pressed is the clearest failure signal this product has, and nothing counted
 * it. B935, B936 and B968 were each a proposal no press could accept, and
 * every one was found by a person driving the live site.
 */
describe("a press", () => {
  test("is recorded wherever a write really happened", async () => {
    wrote("alex", "start_day", { trip: "reise", slug: "eins" });
    // `wrote` is not awaited by its callers — it is a note first and a row
    // afterwards — so give the insert its turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const pressed = (await rows()).filter((row) => row.kind === "press");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].proposed).toBe("start_day");
    expect(pressed[0].ok).toBe(1);
  });

  test("carries no words of theirs, only which tool and whether it worked", async () => {
    await recordPress({ owner: "alex", session: "s1", tool: "add_cost", ok: false, error: "invalid_cost" });
    const [row] = await rows();
    expect(row.said).toBeNull();
    expect(row.ok).toBe(0);
    expect(row.error).toBe("invalid_cost");
  });
});

/**
 * A conversation has a name so its turns can be grouped and so somebody can be
 * sent back to it. It lives exactly as long as the conversation does.
 */
describe("the name of a conversation", () => {
  test("is the same for every turn of one sitting", () => {
    const first = sessionId("alex");
    expect(sessionId("alex")).toBe(first);
  });

  test("and a new one after the conversation is ended", () => {
    const first = sessionId("alex");
    forget("alex");
    expect(sessionId("alex")).not.toBe(first);
  });
});

/**
 * The rule `recordUsage` follows and for the same reason: by the time this
 * runs, somebody has been given their answer.
 */
describe("when the database is not there", () => {
  test("nothing throws", async () => {
    await closeDatabase();
    delete process.env.DATABASE_URL;
    await expect(recordTurn(TURN)).resolves.toBeUndefined();
    await expect(recordPress({ owner: "alex", session: "s", tool: "x", ok: true })).resolves.toBeUndefined();
  });
});

/**
 * The column is text, because Postgres needs `create type` for a fixed list
 * and SQLite has no such thing. So the closed list lives in the module, and
 * this is what stops it drifting from what is actually written.
 */
describe("the kinds of row", () => {
  test("are only the ones the module names", async () => {
    await recordTurn(TURN);
    await recordPress({ owner: "alex", session: "s1", tool: "start_day", ok: true });
    const kinds = new Set((await rows()).map((row) => row.kind));
    expect([...kinds].sort()).toEqual([...SESSION_KINDS].sort());
  });
});

/**
 * **Deleting a journal takes its conversations with it** — the one thing that
 * has to be true whatever else changes about this table. A deleted journal
 * that left its conversations behind would not be a retention policy; it would
 * be a bug.
 *
 * It is true for free, and deliberately: `deleteJournal` in
 * `lib/deletions.ts` iterates `TABLE_NAMES` rather than naming tables one by
 * one, precisely so that adding one cannot be forgotten. This asserts the
 * thing that makes that work — the rows key on `owner_id`, and the table is
 * in the list.
 */
describe("when the journal goes", () => {
  test("its conversations are swept with everything else that names it", async () => {
    const { TABLE_NAMES } = await import("@/lib/db");
    expect(TABLE_NAMES).toContain("helper_sessions");

    await recordTurn(TURN);
    const { db } = (await getDatabase())!;
    const { sql } = await import("kysely");
    // Exactly what deleteJournal runs for every table in that list.
    await sql`delete from helper_sessions where owner_id = ${"alex"}`.execute(db);
    expect(await rows()).toHaveLength(0);
  });
});
