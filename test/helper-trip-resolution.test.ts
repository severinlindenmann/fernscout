import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";

/**
 * The trip she does not have — B940.
 *
 * A person with one trip, a week in Tokyo, asked for a day in their
 * *Antarctica Expedition*. Nothing said the journal has no such trip: the
 * conversation asked which date, and then filled in a proposal for **Tokyo**.
 * Nothing was written, because nobody pressed it. It was ready to be.
 *
 * The cause was one `?? trips[0]` at the end of `resolveTrip`. That fallback
 * is right for an omitted name — somebody mid-write-up means the trip they
 * are writing up — and wrong for a name that means nothing here, and both
 * went down the same line.
 *
 * So this asserts the two halves against each other, because a fix to either
 * one alone is a regression of the other: **a name that matches nothing
 * resolves to nothing, and no name at all still resolves to the newest trip.**
 */

let dir: string;
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

function trip(id: string, title: string, start: string, end: string) {
  fs.mkdirSync(path.join(dir, "alex", "trips", id, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "trips", id, "trip.md"),
    ["---", `id: ${id}`, `title: ${title}`, `start: "${start}"`, `end: "${end}"`, "visibility: private", "---", "", "Intro."].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-resolution-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
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
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { helper: { enabled: true } } }),
  );
  trip("tokyo-sprint-2026", "Tokyo Sprint", "2026-03-01", "2026-03-08");
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a trip this journal does not have", () => {
  test("proposes nothing at all, rather than a day in the one it does have", async () => {
    const ran = await runTool("alex", "start_day", { trip: "Antarctica Expedition", date: "2026-03-04" }, say, "2026-09-08");
    expect(ran.proposal).toBeUndefined();
    // And the model is told to ask, rather than left to narrate a button.
    expect(JSON.stringify(ran.result)).toMatch(/which trip or which day/i);
  });

  test("a read says which of the two it is, and never that there are no trips", async () => {
    const ran = await runTool("alex", "days", { trip: "Antarctica Expedition" }, say, "2026-09-08");
    const why = (ran.result as { why?: string }).why ?? "";
    expect(why).toContain("Antarctica Expedition");
    expect(why).not.toMatch(/there are no trips/i);
  });

  test("in a journal with no trips at all, it still says so", async () => {
    fs.rmSync(path.join(dir, "alex", "trips"), { recursive: true, force: true });
    clearUserCache();
    const ran = await runTool("alex", "days", { trip: "Antarctica Expedition" }, say, "2026-09-08");
    expect((ran.result as { why?: string }).why).toMatch(/there are no trips/i);
  });
});

/**
 * The half B927 is about, kept working. Every one of these used to reach the
 * newest trip down the same line the bug above took, and every one of them is
 * a person being understood rather than guessed at.
 */
describe("the trip somebody does mean", () => {
  beforeEach(() => {
    trip("georgia-2026", "Georgia", "2026-06-01", "2026-06-20");
    clearUserCache();
  });

  test.each([
    ["nothing at all, which is the newest", undefined, "georgia-2026"],
    ["its exact id", "georgia-2026", "georgia-2026"],
    ["its title", "Georgia", "georgia-2026"],
    ["a prefix of the id, which is what the model shortens to", "georgia", "georgia-2026"],
    ["the older trip by title", "Tokyo Sprint", "tokyo-sprint-2026"],
    ["part of the older trip's title", "tokyo", "tokyo-sprint-2026"],
  ])("%s", async (_what, said, expected) => {
    const ran = await runTool("alex", "start_day", said === undefined ? {} : { trip: said }, say, "2026-09-08");
    expect(ran.proposal?.arguments.trip).toBe(expected);
  });
});
