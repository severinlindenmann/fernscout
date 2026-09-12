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
import { honestyCounts } from "@/lib/helper/model";

/**
 * B1563 — live evidence, journal `severin`, 2026-09-12: asked to "beschreibe
 * fotos ergänze text und hole standort raus", a turn that ran only
 * `read_day` answered *"du findest die Beschreibungen und Standorte auf der
 * Seite selbst"* — the day carried no captions, no coordinates and a body of
 * `…`. No guard fired.
 *
 * Kept in its own file for the same reason `test/helper-honesty-postcard-
 * page.test.ts` is: `test/helper-honesty.test.ts`'s own `ask()` calls
 * already sit exactly at `LIMIT.max` for `"helper-ask"` (40, an in-memory,
 * per-module rate limiter), so a call added there starves whatever runs
 * after it.
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
      // B1053 — the area-pick round ahead of `rounds()` is answered here,
      // structurally, so it never consumes a scripted `mockResolvedValueOnce`
      // meant for a real round. Which area does not matter to anything here.
      create: async (params: Record<string, unknown>) => {
        const format = (params.output_config as { format?: { schema?: { properties?: Record<string, unknown> } } })
          ?.format;
        if (format?.schema?.properties?.area) {
          return { content: [{ type: "text", text: '{"area":"days"}' }], usage: { input_tokens: 40, output_tokens: 5 } };
        }
        return create(params);
      },
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

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-honesty-onpage-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-honesty-onpage-secret-b1563";
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
  // The bare day, exactly the reported shape: no gallery, no coordinates, a
  // body of "…".
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-eins.md"),
    ["---", "title: Eins", 'date: "2026-05-01"', "status: draft", "---", "", "…"].join("\n"),
  );
  // A day that really does carry both — the honest case this guard must
  // leave alone.
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-03-drei.md"),
    [
      "---",
      "title: Drei",
      'date: "2026-05-03"',
      "status: draft",
      "lat: 46.9",
      "lng: 7.4",
      "gallery:",
      "  - src: media/one.jpg",
      "    type: image",
      "    caption: Am See",
      "---",
      "",
      "Worte.",
    ].join("\n"),
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

describe("descriptions or a location, claimed to be on the page after read_day found neither", () => {
  test("caught and asked again, and the honest correction ships", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(calls("read_day", { trip: "Die Reise", date: "2026-05-01" }))
      .mockResolvedValueOnce(says("Du findest die Beschreibungen und Standorte auf der Seite selbst."))
      .mockResolvedValueOnce(
        says("Dieser Tag hat noch keine Beschreibungen und keinen Standort. Erzähl mir von einem Foto."),
      );
    const answered = await read(await ask("beschreibe fotos ergänze text und hole standort raus"));

    expect(create).toHaveBeenCalledTimes(3);
    expect(honestyCounts().claimed).toBe(before.claimed + 1);
    expect(honestyCounts().unrecovered).toBe(before.unrecovered);
    expect(String(answered.body.answer)).toContain("noch keine Beschreibungen");
  });

  test("unrecovered, the plain fallback ships rather than the false claim", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(calls("read_day", { trip: "Die Reise", date: "2026-05-01" }))
      .mockResolvedValueOnce(says("Du findest die Beschreibungen und Standorte auf der Seite selbst."))
      .mockResolvedValueOnce(says("Du findest die Beschreibungen und Standorte auf der Seite selbst."));
    const answered = await read(await ask("beschreibe fotos ergänze text und hole standort raus"));

    expect(honestyCounts().unrecovered).toBe(before.unrecovered + 1);
    expect(String(answered.body.answer)).not.toContain("auf der Seite");
    // The journal's own locale ("en"), from the plain fallback — never the
    // false claim repeated.
    expect(String(answered.body.answer)).toContain("no descriptions and no location yet");
  });

  test("a day that does carry captions and coordinates may honestly be pointed at", async () => {
    const before = honestyCounts();
    create
      .mockResolvedValueOnce(calls("read_day", { trip: "Die Reise", date: "2026-05-03" }))
      .mockResolvedValueOnce(says("Du findest die Beschreibungen und Standorte auf der Seite selbst."));
    const answered = await read(await ask("steht da schon ein standort?"));

    // One round for the tool, one for the answer, and no retry: it looked,
    // and what it read really does carry both.
    expect(create).toHaveBeenCalledTimes(2);
    expect(honestyCounts().claimed).toBe(before.claimed);
    expect(String(answered.body.answer)).toContain("auf der Seite");
  });
});
