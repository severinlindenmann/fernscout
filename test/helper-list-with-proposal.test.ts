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
import { storeInboxFile } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * B1565 — live evidence, journal `severin`, 2026-09-12: the owner typed
 * "wegänzen" (a typo for "ergänzen"). The turn ran `attach_files, inbox,
 * attach_files`, **proposed** `attach_files` — and the `list` guard
 * (`saysTheListAgain`) fired anyway because the prose partly repeated the
 * inbox's own file list. The retry failed too, and the shipped answer was
 * the dead-end fallback `agent.theListIsAbove`: "look at the options you
 * already have" — pointing at old rows while a pressable card sat on the
 * screen.
 *
 * B1161's guard is right when nothing but the list came back; it is wrong
 * here, because a proposal — a real card, this turn — is also on the
 * screen. Kept in its own file, the way `test/helper-honesty-postcard-page.
 * test.ts` is, so it does not crowd `test/helper-honesty.test.ts`'s own
 * `ask()` calls against the per-module rate limiter.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-list-proposal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-list-proposal-secret-b1565";
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
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-eins.md"),
    ["---", "title: Eins", 'date: "2026-05-01"', "status: draft", "---", "", "Worte."].join("\n"),
  );

  // Three photographs waiting in the inbox — enough for `inbox` to draw a
  // `files` block of three, which is where `alreadyListed` starts to count
  // as a list at all (B1161).
  for (let n = 0; n < 3; n += 1) {
    storeInboxFile(
      "alex",
      "media",
      `photo-${n}.jpg`,
      await paintJpeg(40, 40, n),
      {},
    );
  }

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

describe("a turn that lists the inbox, proposes attach_files, and echoes the list in prose", () => {
  test("does not fall into the list guard's dead-end fallback", async () => {
    const echoed =
      "Ich habe deine Dateien angeschaut: photo-0.jpg, photo-1.jpg und photo-2.jpg warten noch in " +
      "deiner Inbox, jede rund 40 mal 40 Pixel groß und noch keinem Tag zugeteilt. " +
      "Ich schlage vor, alle drei auf den 1. Mai zu legen — drück den Knopf unten, dann sind sie auf dem Tag und du kannst dir sie dort ansehen.";
    expect(echoed.length).toBeGreaterThan(240);

    const before = honestyCounts();
    create
      .mockResolvedValueOnce(calls("inbox"))
      .mockResolvedValueOnce(calls("attach_files", { trip: "Die Reise", date: "2026-05-01" }))
      .mockResolvedValueOnce(says(echoed));
    const answered = await read(await ask("wegänzen"));

    expect(create).toHaveBeenCalledTimes(3);
    // Not caught: no retry round, so no extra `create` call, and the
    // model's own echoed prose ships unreplaced.
    expect(honestyCounts().claimed).toBe(before.claimed);
    expect(String(answered.body.answer)).toBe(echoed);
    expect(String(answered.body.answer)).not.toContain("options already");
    const proposals = answered.body.proposals as { tool: string }[];
    expect(proposals).toHaveLength(1);
    expect(proposals[0].tool).toBe("attach_files");
  });

  test("with no proposal at all, the same echoed prose is still caught (existing B1161 behaviour)", async () => {
    const echoed =
      "Ich habe deine Dateien angeschaut: photo-0.jpg, photo-1.jpg und photo-2.jpg warten noch in " +
      "deiner Inbox, jede rund 40 mal 40 Pixel groß, und das sind alle drei zusammen mit ihrer " +
      "ungefähren Größe — nichts liegt sonst noch herum, du kannst also aufhören zu suchen.";
    expect(echoed.length).toBeGreaterThan(240);

    const before = honestyCounts();
    create
      .mockResolvedValueOnce(calls("inbox"))
      .mockResolvedValueOnce(says(echoed))
      .mockResolvedValueOnce(says("Schau dir die Dateien an, die schon oben aufgelistet sind."));
    const answered = await read(await ask("was liegt noch rum?"));

    // Caught on the first pass — the guard still fires exactly as before
    // when nothing was proposed. The retry's own (short, honest) answer
    // then recovers it, same as any other guard.
    expect(honestyCounts().claimed).toBe(before.claimed + 1);
    expect(String(answered.body.answer)).toBe("Schau dir die Dateien an, die schon oben aufgelistet sind.");
  });
});
