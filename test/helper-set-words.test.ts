import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { TOOLS, runTool } from "@/lib/helper/tools";
import type { Say } from "@/lib/helper/intents";

/**
 * The empty box no press could accept — B942, and the correction it made
 * impossible — B941.
 *
 * `set_day_words` opened its `content` field on nothing whenever the model
 * proposed it without prose, under a sentence saying it would set the day's
 * words — and no press of it could succeed, because empty content is refused
 * (`lib/api/entries.ts`). Nothing was lost. Nothing could be done either: it
 * is B929's shape, a proposal on somebody's screen that nothing accepts.
 *
 * The same line is why a correction went wrong. Somebody with a day saying
 * *"ramen for dinner, 1200 yen"* said **"it should say udon, not ramen"** and
 * got a proposal to add a *second* cost of 1200 — which, pressed, would have
 * doubled the recorded spend and left the wrong word on the page. Changing one
 * word meant reproducing the whole paragraph from memory, and the cheap tool
 * won.
 */

const OWNER_EMAIL = "alex@example.test";
const PROSE = "Ramen zum Abendessen, 1200 Yen. Danach am Fluss entlang.";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { PATCH: setWords } = await import("@/app/api/helper/[user]/day/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const say: Say = ((key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key) as Say;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-set-words-"));
  process.env.CONTENT_DIR = dir;
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  const entries = path.join(dir, "alex", "trips", "tokyo", "entries");
  fs.mkdirSync(entries, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "de",
      locales: ["de"],
      baseCurrency: "CHF",
      features: { helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "tokyo", "trip.md"),
    ["---", "id: tokyo", "title: Tokyo", 'start: "2026-03-01"', 'end: "2026-03-08"', "visibility: private", "---", "", "Intro."].join("\n"),
  );
  fs.writeFileSync(
    path.join(entries, "2026-03-02-abend.md"),
    ["---", 'date: "2026-03-02"', "slug: abend", "title: Der Abend", "status: draft", "---", "", PROSE].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Straight off disk — this is asserting that a file was not rewritten. */
function words() {
  return fs.readFileSync(path.join(dir, "alex", "trips", "tokyo", "entries", "2026-03-02-abend.md"), "utf-8");
}

describe("proposing a day's words", () => {
  test("the box opens on what the day already says, not on nothing", async () => {
    const ran = await runTool("alex", "set_day_words", { trip: "tokyo", slug: "abend" }, say, "2026-09-08");
    const content = ran.proposal?.fields.find((one) => one.name === "content");
    expect(content?.value).toContain("Ramen");
  });

  test("prose the model does propose still wins — it is a correction, not a merge", async () => {
    const ran = await runTool(
      "alex",
      "set_day_words",
      { trip: "tokyo", slug: "abend", content: "Udon zum Abendessen, 1200 Yen." },
      say,
      "2026-09-08",
    );
    const content = ran.proposal?.fields.find((one) => one.name === "content");
    expect(content?.value).toBe("Udon zum Abendessen, 1200 Yen.");
  });

  test("a day with no words at all is still refused, which is what the empty box hit", async () => {
    const cleared = await setWords(
      new Request("https://t.test/api/helper/alex/day", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: "tokyo", slug: "abend", content: "" }),
      }),
      params,
    );
    expect(cleared.status).toBe(400);
    // The guard that made the empty proposal unpressable rather than
    // destructive. Nothing was lost; nothing could be done either.
    expect((await cleared.json()).error).toMatch(/must not be empty/);
    expect(words()).toContain(PROSE);
  });
});

/**
 * The wrong tool, made harder to reach — B941.
 *
 * Which tool the model picks is not assertable. What is assertable is what it
 * was told: the correction case is named in both descriptions, in the words
 * somebody actually used, and `add_cost` says what pressing it would have
 * cost her.
 */
describe("a correction is not a cost", () => {
  const words = TOOLS.find((tool) => tool.name === "set_day_words");
  const cost = TOOLS.find((tool) => tool.name === "add_cost");

  /**
   * Both of these are one short clause, and they are short on purpose: the
   * prompt budget had 280 characters left in it (B930), and the first draft of
   * this pair spent 890. The choice was between saying it properly in one
   * place and gesturing at it in two, and the tool being *wrongly* reached for
   * is the one that has to say no.
   */
  test("the tool that changes words says corrections are its job", () => {
    expect(words?.describe).toMatch(/corrected/i);
  });

  test("the tool that records money says they are not, and names the right one", () => {
    expect(cost?.describe).toMatch(/never to correct/i);
    expect(cost?.describe).toContain("set_day_words");
  });
});
