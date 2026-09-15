import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createJournal } from "@/lib/journals";
import { runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";

/**
 * B1752 — "start the day first" was a dead end.
 *
 * Somebody describes a day, the model reaches for the words tool, and the
 * journal has no day for that date yet. The answer was
 * `agent.tool.noDay` — *"start the day first, and then this can go on it"* —
 * and the conversation stopped there, telling the person to do the thing the
 * software is for. Over 84 real wordings that was part of why the channel's
 * own core flow proposed nothing three times in four.
 *
 * `runTool` now hands back `start_day`'s own card for that date instead, with
 * the words they already typed riding along as its `notes` (B969). Nothing is
 * written: `start_day` proposes like every other write tool.
 */

const USER = "deadend";
const say: Say = ((key: string) => key) as Say;
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-deadend-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "t.db")}`;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  createJournal({
    username: USER,
    title: "A journal",
    ownerEmail: `${USER}@example.test`,
    ownerName: "Owner",
    ownerNickname: "Owner",
    defaultLocale: "de",
  });
  writeTripFixture(USER, {
    id: "ungarn-2026",
    title: "Ungarn 2026",
    start: "2026-06-01",
    end: "2026-06-14",
    visibility: "private",
  });
});

afterEach(async () => {
  await closeDatabase();
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("words for a date with no day offer to start that day, carrying the words", async () => {
  const ran = await runTool(
    USER,
    "set_day_words",
    { trip: "Ungarn 2026", date: "2026-06-03", content: "Den ganzen Tag auf der Burg in Eger." },
    say,
    "2026-06-03",
  );

  expect(ran.proposal?.tool).toBe("start_day");
  expect(ran.proposal?.arguments.date).toBe("2026-06-03");
  // B969's own argument: the paragraph they already typed rides to the card
  // rather than being dropped and asked for a second time.
  expect(ran.proposal?.arguments.notes).toContain("Burg");
});

test("the same for draft_words, which carries its words as notes", async () => {
  const ran = await runTool(
    USER,
    "draft_words",
    { trip: "Ungarn 2026", date: "2026-06-03", notes: "Eger, die Burg, sehr heiss." },
    say,
    "2026-06-03",
  );
  expect(ran.proposal?.tool).toBe("start_day");
  expect(ran.proposal?.arguments.notes).toContain("Eger");
});

test("a day that does exist is written on, not started again", async () => {
  writeDayFixture(dir, USER, "ungarn-2026", {
    slug: "eger",
    date: "2026-06-03",
    title: "Eger",
    content: "Etwas ist passiert.",
  });

  const ran = await runTool(
    USER,
    "set_day_words",
    { trip: "Ungarn 2026", date: "2026-06-03", slug: "eger", content: "Neue Worte." },
    say,
    "2026-06-03",
  );
  expect(ran.proposal?.tool).toBe("set_day_words");
});

/**
 * The guard on the whole idea: this may never invent a date. A tool call that
 * names none still gets the old sentence, because the alternative would be a
 * card proposing to create a day on a day nobody mentioned.
 */
test("with no date, it still says plainly that there is no day", async () => {
  const ran = await runTool(
    USER,
    "set_day_words",
    { trip: "Ungarn 2026", content: "Irgendwas." },
    say,
    "2026-06-03",
  );
  expect(ran.proposal).toBeFalsy();
  expect(JSON.stringify(ran.blocks)).toContain("agent.tool.noDay");
});

/**
 * The boundary, kept where B925 put it. `attach_files` resolves a day the
 * same way and hits the same refusal, but nothing carries a file selection
 * across to `start_day` — a card that created the day and forgot the
 * photographs would be a worse lie than the sentence it replaced. Asserted
 * here as well as in `test/helper-attach.test.ts`, because the temptation is
 * to widen this to "every tool that resolves a day" and that is exactly the
 * change that broke it once.
 */
test("a tool whose subject cannot ride along is left alone", async () => {
  const ran = await runTool(
    USER,
    "attach_files",
    { trip: "Ungarn 2026", date: "2026-06-03" },
    say,
    "2026-06-03",
  );
  expect(ran.proposal?.tool).not.toBe("start_day");
});
