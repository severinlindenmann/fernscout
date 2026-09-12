import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";

/**
 * "vorschau" drew a `publish_day` card whose only button publishes, and the
 * owner pressed it — B1562. A sentence that only asks to *see* a day must
 * never carry a `publish_day` proposal; one that also asks to publish must
 * keep the card exactly as before.
 */

let dir: string;
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-preview-intent-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "a@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro."].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-one.md"),
    ["---", "title: Der erste Tag", 'date: "2026-05-01"', "status: draft", "---", "", "Worte."].join("\n"),
  );
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function ranWith(said: string) {
  return runTool("alex", "publish_day", { trip: "reise" }, say, "2026-09-07", [], said);
}

describe("a preview word alone never carries a publish_day proposal", () => {
  test.each([
    ["de", "vorschau"],
    ["en", "preview"],
    ["hu", "előnézet"],
  ])("%s", async (_lang, said) => {
    const ran = await ranWith(said);
    expect(ran.proposal).toBeUndefined();
    // The day is still shown — the read path's own shape, no button.
    expect(ran.blocks.map((block) => block.shape)).toEqual(["preview"]);
    expect((ran.blocks[0] as { lines: string[] }).lines).toContain("Der erste Tag");
  });
});

describe("a publish sentence still proposes", () => {
  test.each([
    ["de", "veröffentliche den tag"],
    ["en", "publish the day"],
    ["hu", "publikáld a napot"],
  ])("%s", async (_lang, said) => {
    const ran = await ranWith(said);
    expect(ran.proposal).toBeDefined();
    expect(ran.blocks.map((block) => block.shape)).toEqual(["preview", "confirm"]);
  });
});

describe("a sentence naming both keeps the card", () => {
  test.each([
    ["de", "vorschau und dann veröffentlichen"],
    ["en", "preview and then publish"],
  ])("%s", async (_lang, said) => {
    const ran = await ranWith(said);
    expect(ran.proposal).toBeDefined();
  });
});

test("with no sentence at all, nothing is suppressed", async () => {
  const ran = await runTool("alex", "publish_day", { trip: "reise" }, say, "2026-09-07");
  expect(ran.proposal).toBeDefined();
});
