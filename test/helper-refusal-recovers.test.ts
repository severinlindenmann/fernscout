import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { forget } from "@/lib/helper/thread";

/**
 * B1299 — a recovered tool refusal used to appear alone in the transcript.
 *
 * `trip_people` can be called speculatively ("maybe my partner should go on
 * the byline?") and comes back `refuse: "agent.tool.tripPeopleNeedsEmail"`
 * when it has no address to write. The reported case is real: the same
 * round also called `trip_costs`, which succeeded — the model recovered on
 * its own, in the same turn, and the refusal that had already been answered
 * still landed on the screen with nothing after it. `runTool` marked the
 * refusal (`refused: true`); the round loop in `model.ts` now holds it back
 * and drops it the moment any later call in the same turn succeeds.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => create(params),
    };
  },
}));

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function ask(said: string) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ said, today: "2026-09-07" }),
    }),
    params,
  );
}

function says(text: string) {
  return { content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 10 } };
}

/** Two tool calls in one round, in order — the shape of the reported case:
 *  a refusal, then a later call that succeeds. */
function callsTwo(
  first: { name: string; input?: Record<string, string> },
  second: { name: string; input?: Record<string, string> },
) {
  return {
    content: [
      { type: "tool_use", id: `t-${first.name}`, name: first.name, input: first.input ?? {} },
      { type: "tool_use", id: `t-${second.name}`, name: second.name, input: second.input ?? {} },
    ],
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-refusal-recovers-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-refusal-recovers-secret-b1299";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  create.mockReset();
  forget("alex");

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro."].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
});

afterEach(async () => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.ANTHROPIC_API_KEY;
  clearConfigCache();
  clearUserCache();
  await closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a refusal recovered by a later call in the same turn", () => {
  test("does not land on the screen at all", async () => {
    create
      .mockResolvedValueOnce(
        callsTwo(
          { name: "trip_people", input: { trip: "reise", person: "Sam" } },
          { name: "trip_costs", input: { trip: "reise" } },
        ),
      )
      .mockResolvedValueOnce(says("Here is what I found."));

    const { body } = await read(await ask("add sam to the trip, and how much has it cost"));
    const text = JSON.stringify(body.blocks);
    expect(text).not.toContain("I need their name and their email address");
  });
});

describe("a refusal with nothing after it", () => {
  test("still renders, because the person has to answer it", async () => {
    create.mockResolvedValueOnce(
      callsTwo(
        { name: "trip_people", input: { trip: "reise", person: "Sam" } },
        { name: "trip_people", input: { trip: "reise", person: "Alex" } },
      ),
    );
    create.mockResolvedValueOnce(says(""));

    const { body } = await read(await ask("add sam and alex to the trip"));
    const text = JSON.stringify(body.blocks);
    expect(text).toContain("I need their name and their email address");
  });
});
