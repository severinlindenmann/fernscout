import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { lastDayForWizard } from "@/lib/helper/server";
import { DAYS_TOOLS } from "@/lib/helper/tools/areas/days";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B1266 — "the last day" as a person means it, not only an unfinished draft.
 *
 * The only cross-trip read that needed no trip name used to be `unfinished`
 * (drafts-only, by design — it is the resume list). A person whose last day
 * was already published got told there was nothing waiting, rather than
 * shown the day they meant. `lastDayForWizard` and the `last_day` tool are
 * the fix: the single most recent day, whichever state it is in.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-lastday-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" } }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  writeTripFixture("alex", {
    id: "alpine-crossing-2026",
    title: "Alpine crossing",
    start: "2026-09-01",
    end: "2026-09-14",
    visibility: "private",
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("nothing written at all is null, not a crash", () => {
  expect(lastDayForWizard("alex")).toBeNull();
});

/**
 * The exact bug: the last day is already **published**, and there is no
 * draft at all. `draftsForWizard` (the drafts-only resume list) would answer
 * "nothing waiting" here — this must still find the real last day.
 */
test("a published last day is found even though nothing is unfinished", () => {
  // No `status` — writeDayFixture's default is published (only "draft" is
  // ever passed explicitly; see its own type).
  writeDayFixture(dir, "alex", "alpine-crossing-2026", {
    slug: "pass",
    date: "2026-09-05",
    title: "Over the pass",
    content: "Walked all day.",
  });

  const last = lastDayForWizard("alex");
  expect(last).toMatchObject({ date: "2026-09-05", title: "Over the pass", published: true });
});

test("the most recent date wins over an earlier draft", () => {
  writeDayFixture(dir, "alex", "alpine-crossing-2026", {
    slug: "start",
    date: "2026-09-01",
    title: "Setting off",
    content: "…",
    status: "draft",
  });
  writeDayFixture(dir, "alex", "alpine-crossing-2026", {
    slug: "pass",
    date: "2026-09-05",
    title: "Over the pass",
    content: "Walked all day.",
  });

  expect(lastDayForWizard("alex")?.date).toBe("2026-09-05");
});

test("the last_day tool surfaces the same answer to the model", async () => {
  writeDayFixture(dir, "alex", "alpine-crossing-2026", {
    slug: "pass",
    date: "2026-09-05",
    title: "Over the pass",
    content: "Walked all day.",
  });

  const tool = DAYS_TOOLS.find((t) => t.name === "last_day");
  expect(tool).toBeTruthy();
  expect(tool!.kind).toBe("read");
  const result = tool!.kind === "read" ? await tool!.run("alex", {}) : null;
  expect(result).toMatchObject({ date: "2026-09-05", published: true });
});
