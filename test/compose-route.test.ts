import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { resetRateLimitsForTests } from "@/lib/rateLimit";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import { BANNED_PHRASES } from "@/lib/helper/composeGuard";
import { COMPOSE_SCHEMA, COMPOSE_SYSTEM_PROMPT } from "@/lib/helper/compose";
import { createTrip } from "@/lib/tripWrite";
import { writeDayFixture } from "./fixtures/content";
import { hasPaid } from "./support/openCore";

/**
 * B2688 — `mode: "compose"` on write-day. The SDK is stubbed (the same
 * pattern test/travellers-photo-model.test.ts uses), so these run the real
 * `composeDay` and its guards end to end against a scripted answer.
 */

const OWNER_EMAIL = "alex@example.test";
const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const { POST } = await import("@/app/api/helper/[user]/day/write-day/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

const RICH =
  "Bus to the pass, three hours. Ate noodles at the shack by the barrier, 18 CHF. The wind never stopped all afternoon and the shack had one table, so we shared it with the driver.";

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function call(body: Record<string, unknown>) {
  return POST(
    new Request("https://t.test/api/helper/alex/day/write-day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: "a-trip", mode: "compose", slug: "the-pass", ...body }),
    }),
    params,
  );
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const S = (text: string, sources: string[]) => ({ text, sources });
const variant = (sentences: { text: string; sources: string[] }[], titles: unknown[] = []) => ({
  titles,
  paragraphs: [{ sentences }],
});

const CLOSE = variant(
  [S("Bus to the pass, three hours.", ["n1"]), S("Ate noodles at the shack by the barrier, 18 CHF.", ["n2"])],
  [{ text: "Noodles at the barrier", kind: "label", sources: ["n2"] }],
);
const STORY = variant([
  S("Three hours on the bus to Kunlun Pass.", ["n1", "place"]),
  S("Noodles at the shack by the barrier, 18 CHF, and the wind never stopped.", ["n2", "n3"]),
]);

function scripted(answer: Record<string, unknown>) {
  create.mockResolvedValueOnce({
    content: [{ type: "text", text: JSON.stringify({ language: "en", used: ["n1"], tags: ["Bus Travel"], missing: [], ...answer }) }],
    usage: { input_tokens: 10, output_tokens: 10 },
    stop_reason: "end_turn",
  });
}

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }));
  clearConfigCache();
  clearUserCache();
}

/** A day of its own date — days on one date share one pack. */
function writeDay(content: string, slug = "the-pass", date = "2026-05-04") {
  writeDayFixture(dir, "alex", "a-trip", { slug, date, location: "Kunlun Pass", country: "China", content });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-compose-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-compose-secret-b2688";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  create.mockReset();
  clearIdempotencyStore();
  resetRateLimitsForTests();
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  writeConfig({ auth: { enabled: true }, helper: { enabled: true } });
  await migrateToLatest(await getDatabase());
  const created = createTrip("alex", { id: "a-trip", title: "Over the pass", start: "2026-05-01", end: "2026-05-31" });
  if (!created.ok) throw new Error(created.message);
  writeDay(RICH);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function consent() {
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
}

describe("the prompt and schema", () => {
  test("the system prompt names every banned phrase of every locale", () => {
    for (const phrases of Object.values(BANNED_PHRASES)) {
      for (const phrase of phrases) expect(COMPOSE_SYSTEM_PROMPT).toContain(phrase);
    }
  });

  test("the language enum is the maintained locales", () => {
    expect(COMPOSE_SCHEMA.properties.language.enum).toEqual([...MAINTAINED_LOCALES]);
  });

  test("the system block is the frozen prompt, cached, thinking off; the day is only in the user message", async () => {
    await consent();
    scripted({ close: CLOSE, story: STORY });
    await call({ answers: ["The driver was called Tenzin."] });
    const [request] = create.mock.calls[0];
    expect(request.model).toBe("claude-sonnet-5");
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.system).toEqual([{ type: "text", text: COMPOSE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    for (const owned of ["noodles", "Kunlun", "Tenzin", "Over the pass", OWNER_EMAIL]) {
      expect(COMPOSE_SYSTEM_PROMPT).not.toContain(owned);
    }
    const message = request.messages[0].content as string;
    expect(message).toContain("noodles");
    expect(message).toContain('id="a1"');
    expect(message).toContain("Tenzin");
    expect(message.indexOf("<day_pack>")).toBeLessThan(message.indexOf("<task>"));
  });
});

describe("refusals before any spend", () => {
  test("no slug is 400", async () => {
    await consent();
    expect((await read(await call({ slug: "" }))).body.error).toBe("no_slug");
    expect(create).not.toHaveBeenCalled();
  });

  test("an unknown day is 404", async () => {
    await consent();
    const r = await read(await call({ slug: "nope" }));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("unknown_day");
  });

  test.each([[["a", "b", "c", "d"]], [["x".repeat(501)]], ["not a list"], [[3]]])("answers %j are refused with 400", async (answers) => {
    await consent();
    const r = await read(await call({ answers }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "invalid_answers", maxCount: 3, maxChars: 500 });
  });

  test("a day with no words and no photos is 400", async () => {
    await consent();
    writeDay("", "empty", "2026-05-05");
    const r = await read(await call({ slug: "empty" }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("no_notes");
  });

  test("a day with one undescribed photo and no words is 400 before any model call", async () => {
    await consent();
    writeDayFixture(dir, "alex", "a-trip", {
      slug: "one-photo",
      date: "2026-05-06",
      content: "",
      media: [{ src: "/media/a-trip/one.jpg" }],
    });
    const r = await read(await call({ slug: "one-photo" }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("no_notes");
    expect(create).not.toHaveBeenCalled();
  });

  test("consent first", async () => {
    const r = await read(await call({}));
    expect(r.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("what comes back", () => {
  beforeEach(consent);

  test("both variants, with per-sentence sources and their kind, tags slugged", async () => {
    scripted({ close: CLOSE, story: STORY });
    const r = await read(await call({}));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, language: "en", tags: ["bus-travel"], dropped: [] });
    const close = r.body.close as { text: string; titles: unknown[]; sentences: { sources: unknown[] }[] };
    expect(close.text).toBe("Bus to the pass, three hours. Ate noodles at the shack by the barrier, 18 CHF.");
    expect(close.titles).toEqual([{ text: "Noodles at the barrier", kind: "label" }]);
    const story = r.body.story as { sentences: { sources: unknown[] }[] };
    expect(story.sentences[0].sources).toEqual([
      { id: "n1", kind: "owner" },
      { id: "place", kind: "owner" },
    ]);
  });

  test("a story under 25 owner words is forced to null", async () => {
    writeDay("Bus to the pass, three hours.", "thin", "2026-05-06");
    scripted({ close: variant([S("Bus to the pass, three hours.", ["n1"])]), story: variant([S("Bus to the pass.", ["n1"])]) });
    const r = await read(await call({ slug: "thin" }));
    expect(r.status).toBe(200);
    expect(r.body.story).toBeNull();
    expect(r.body.close).not.toBeNull();
  });

  test("a story with an invented place is dropped, the close survives", async () => {
    scripted({ close: CLOSE, story: variant([S("Three hours on the bus to Golmud.", ["n1"])]) });
    const r = await read(await call({}));
    expect(r.status).toBe(200);
    expect(r.body.story).toBeNull();
    expect((r.body.dropped as string[]).join()).toMatch(/Golmud/);
  });

  test("a banned phrase is retried once with the phrase named, and the clean retry is kept", async () => {
    const banned = variant([S("Bus to the pass, three hours, truly.", ["n1"])]);
    scripted({ close: banned, story: STORY });
    scripted({ close: CLOSE, story: STORY });
    const r = await read(await call({}));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages[0].content).toMatch(/Remove: truly$/);
    expect((r.body.close as { text: string }).text).toBe(
      "Bus to the pass, three hours. Ate noodles at the shack by the barrier, 18 CHF.",
    );
  });

  test("a banned phrase twice drops that variant", async () => {
    const banned = variant([S("Bus to the pass, a truly long three hours.", ["n1"])]);
    scripted({ close: CLOSE, story: banned });
    scripted({ close: CLOSE, story: banned });
    const r = await read(await call({}));
    expect(r.status).toBe(200);
    expect(r.body.story).toBeNull();
    expect(r.body.dropped).toContain('story: banned "truly"');
  });

  test("both variants failing is 422 with the reasons", async () => {
    scripted({ close: variant([S("Golmud.", ["n9"])]), story: null });
    const r = await read(await call({}));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("compose_rejected");
    expect((r.body.dropped as string[]).join()).toMatch(/unknown n9/);
  });

  test("a provider failure is 502", async () => {
    create.mockRejectedValueOnce(new Error("provider is unhappy"));
    expect((await call({})).status).toBe(502);
  });

  test("a retry under the same key is answered, not run again; changed words are a conflict", async () => {
    scripted({ close: CLOSE, story: STORY });
    const first = await read(await call({ idempotency_key: "k" }));
    const again = await read(await call({ idempotency_key: "k" }));
    expect(again.body).toEqual(first.body);
    expect(create).toHaveBeenCalledTimes(1);
    writeDay(`${RICH} One more line.`);
    expect((await call({ idempotency_key: "k" })).status).toBe(409);
  });
});

describe.skipIf(!hasPaid())("AI days, with billing on", () => {
  beforeEach(async () => {
    writeConfig({ auth: { enabled: true }, helper: { enabled: true }, billing: { enabled: true } });
    await consent();
  });

  async function aiDays() {
    return (await getDatabase()).db.selectFrom("ai_days").selectAll().execute();
  }

  test("a composed day takes the day's AI day", async () => {
    scripted({ close: CLOSE, story: STORY });
    expect((await call({})).status).toBe(200);
    expect(await aiDays()).toHaveLength(1);
  });

  test("a rejected compose takes none", async () => {
    scripted({ close: variant([S("Golmud.", ["n9"])]), story: null });
    expect((await call({})).status).toBe(422);
    expect(await aiDays()).toHaveLength(0);
  });
});
