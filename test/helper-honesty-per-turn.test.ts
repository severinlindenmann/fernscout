import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { forget, remember, wrote } from "@/lib/helper/thread";

/**
 * B1302 — scenario-margrit.md's headline finding, reproduced.
 *
 * `lib/helper/model.ts`'s honesty net used to ask "has *anything*, ever, been
 * written this whole session" before letting a plain "it's saved" claim
 * through with no proposal on screen. That is the wrong question: a real
 * write seven turns ago does not make a claim about a *different*, unwritten
 * change true. Margrit typed a proposal's own accept label back instead of
 * tapping it; the model answered as though `set_day_words` had been pressed;
 * it had not; and the guard let it through because `start_day` had really
 * been written two turns earlier in the same conversation.
 *
 * Kept in its own file rather than folded into `test/helper-honesty.test.ts`:
 * that file's `ask()` calls already sit exactly at `LIMIT.max` for
 * `"helper-ask"` (40, `app/api/helper/[user]/ask/route.ts` — an in-memory,
 * per-module rate limiter), so one more real call there starves whatever
 * else runs in that same file afterwards.
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

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-honesty-turn-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-honesty-per-turn-secret-b1302";
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

describe("a write several turns ago does not make a later, unrelated claim true", () => {
  test("caught, retried once, and answered with the plain truth", async () => {
    wrote("alex", "start_day", { trip: "reise", slug: "zweiter", date: "2026-05-02" });
    // Turns 1 and 2 are recorded directly with `remember` — the exact call
    // the real `ask` route makes once a turn finishes — rather than by
    // spending two more scripted model turns on scaffolding: turn 1 is a
    // true claim right after the press (the write note rides on it, folded
    // in exactly as `answerInThread`'s own note-folding loop does it); turn
    // 2 is an ordinary exchange with nothing proposed or written, after
    // which the note has already been consumed.
    remember("alex", "und?", "Der Tag ist angelegt.");
    remember("alex", "gut", "Klar, frag einfach.");

    // Turn 3 — a false "saved" claim about something this turn never wrote,
    // with the session's only real write now two turns behind it. Must be
    // caught, retried once, and answered with the plain truth rather than
    // sailing through on the strength of the earlier, unrelated press.
    create.mockResolvedValueOnce(says("Der Titel und die Worte sind jetzt gespeichert."));
    create.mockResolvedValueOnce(says("Nein, entschuldige — das ist noch nicht gespeichert."));
    const answered = await read(await ask("Diesen Text speichern"));

    expect(create).toHaveBeenCalledTimes(2);
    expect(String(answered.body.answer)).toBe("Nein, entschuldige — das ist noch nicht gespeichert.");
  });

  test("but a claim right after the press it describes is still left alone", async () => {
    wrote("alex", "start_day", { trip: "reise", slug: "zweiter", date: "2026-05-02" });
    create.mockResolvedValueOnce(says("Der Tag ist angelegt."));
    const answered = await read(await ask("und?"));

    expect(create).toHaveBeenCalledTimes(1);
    expect(String(answered.body.answer)).toBe("Der Tag ist angelegt.");
  });
});
