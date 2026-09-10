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
 * B1261, ctxloss finding 1 — `lib/helper/tools/areas/trips.ts`'s `trips`
 * read tool draws a `choose` card (a trip picker) whenever it finds at least
 * one trip, with no way to tell "the model is asking which one" from "the
 * model already knows and is only resolving an id for a write it is making
 * in the same breath". A round that calls `trips` and a write tool
 * (`start_day`) together drew a stranded trip-picker beside the write's own
 * proposal, and the live scenario's trace shows exactly that pair of tool
 * names in one turn on a one-trip journal.
 *
 * Its own file, rather than folded into `test/helper-honesty.test.ts`: that
 * file's shared in-memory rate limiter (`lib/rateLimit.ts`'s module-level
 * `hits` map, one bucket per test *file* rather than per test) is already
 * close to `LIMIT.max` from its own two hundred-odd assertions, and two more
 * calls through `POST /api/helper/[user]/ask` tipped it into `429`s that had
 * nothing to do with what was being tested.
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

function calls(name: string, input: Record<string, string> = {}) {
  return {
    content: [{ type: "tool_use", id: `t-${name}`, name, input }],
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

function callsBoth(a: [string, Record<string, string>?], b: [string, Record<string, string>?]) {
  return {
    content: [
      { type: "tool_use", id: `t-${a[0]}`, name: a[0], input: a[1] ?? {} },
      { type: "tool_use", id: `t-${b[0]}`, name: b[0], input: b[1] ?? {} },
    ],
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trips-picker-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-trips-picker-secret-b1261";
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
  await closeDatabase();
  forget("alex");
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("trips called alongside a write proposal in the same round", () => {
  test("draws no trip picker — the write already resolved which trip", async () => {
    create
      .mockResolvedValueOnce(callsBoth(["trips"], ["start_day", { trip: "reise", date: "2026-05-02" }]))
      .mockResolvedValueOnce(says("A day for the 2nd is ready — press to start it."));
    const answered = await read(await ask("mach für den 2. mai einen neuen tag"));

    const blocks = answered.body.blocks as { shape: string }[];
    expect(blocks.some((one) => one.shape === "choose")).toBe(false);
    expect(blocks.some((one) => one.shape === "form")).toBe(true);
  });

  test("still draws the picker when the same round proposes nothing", async () => {
    create.mockResolvedValueOnce(calls("trips")).mockResolvedValueOnce(says("You have one trip: Die Reise."));
    const answered = await read(await ask("welche reisen habe ich"));

    const blocks = answered.body.blocks as { shape: string }[];
    expect(blocks.some((one) => one.shape === "choose")).toBe(true);
  });
});
