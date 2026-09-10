import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { forget } from "@/lib/helper/thread";
import { turnsIn } from "@/lib/helper/sessions";

/**
 * B1056 — the model turn, wired to WhatsApp.
 *
 * The model is scripted, never called for real — the same discipline
 * test/helper-thread.test.ts uses. What is asserted is everything on either
 * side of it: the same `answerInThread` the web room calls answers a
 * WhatsApp message, the reply is shaped for the channel (not raw HTML-room
 * prose), the turn is remembered with a `whatsapp` origin, and the durable
 * record (`helper_sessions`) carries it too — so `/agent` opened afterwards
 * would show the same conversation, origin marks and all (B1054).
 */

const { create, sent } = vi.hoisted(() => ({
  create: vi.fn(),
  sent: [] as Record<string, unknown>[],
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        return create(params);
      },
    };
  },
}));

const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");
const { getUser } = await import("@/lib/users");

let dir: string;

function says(text: string) {
  return { content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 20 } };
}

function textMessage(from: string, id: string, body: string) {
  return { kind: "text" as const, id, from, timestamp: "1710000000", body };
}

function interactiveMessage(from: string, id: string, replyId: string, title: string) {
  return { kind: "interactive" as const, id, from, timestamp: "1710000000", replyId, title };
}

function repliesTo(username: string): Record<string, unknown>[] {
  const replyDir = path.join(dir, username, "whatsapp-replies");
  if (!fs.existsSync(replyDir)) return [];
  return fs
    .readdirSync(replyDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(replyDir, f), "utf8")));
}

async function bindGreetAcknowledge(username: string, tel: string): Promise<void> {
  const created = createJournal({
    username,
    title: "A journal",
    ownerEmail: `${username}@example.test`,
    ownerName: "Owner",
    ownerNickname: "Owner",
    defaultLocale: "en",
    ownerTel: tel,
    ownerTelProvenAt: new Date().toISOString(),
    ownerTelProvenMethod: "sms",
  });
  expect(created.ok).toBe(true);
  expect(setJournalFeatures(username, { whatsappInbound: true }).ok).toBe(true);
  await handleInboundMessage(textMessage(tel, `wamid.${username}.greet`, "hi"));
  await handleInboundMessage(textMessage(tel, `wamid.${username}.yes`, "yes"));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-model-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        whatsappInbound: { enabled: true },
        whatsapp: { enabled: true, backend: "dry-run" },
        helper: { enabled: true },
        credits: { enabled: true },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
  create.mockReset();
  sent.length = 0;
  forget("modeltest");
  forget("choicetest");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  forget("modeltest");
  forget("choicetest");
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.ANTHROPIC_API_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("an ordinary message, once acknowledged", () => {
  test("reaches the model and the answer comes back shaped for WhatsApp", async () => {
    await bindGreetAcknowledge("modeltest", "41760005555");
    const before = repliesTo("modeltest").length;

    create.mockResolvedValueOnce(says("You have one trip: Die Reise."));
    await handleInboundMessage(textMessage("41760005555", "wamid.turn-1", "what trips do I have"));

    const files = repliesTo("modeltest");
    expect(files.length).toBe(before + 1);
    expect(files[files.length - 1].body).toContain("You have one trip");
    expect(getUser("modeltest")).not.toBeNull();
  });

  test("the turn is remembered with a whatsapp origin, durably", async () => {
    await bindGreetAcknowledge("modeltest", "41760005556");
    create.mockResolvedValueOnce(says("Sure — go ahead."));
    await handleInboundMessage(textMessage("41760005556", "wamid.turn-2", "let me tell you about today"));

    // helper_sessions is the durable, append-only record — B1054 gave it an
    // origin column precisely so this is checkable after the fact.
    const { db } = (await getDatabase())!;
    const rows = await db
      .selectFrom("helper_sessions")
      .selectAll()
      .where("owner_id", "=", "modeltest")
      .where("kind", "=", "turn")
      .execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.origin === "whatsapp")).toBe(true);
    expect(rows.some((r) => r.said === "let me tell you about today")).toBe(true);
  });

  test("an interactive reply's title is said back exactly as though typed", async () => {
    await bindGreetAcknowledge("choicetest", "41760006666");
    create.mockResolvedValueOnce(says("Got it — Friday it is."));
    await handleInboundMessage(interactiveMessage("41760006666", "wamid.turn-3", "opt:0:friday", "Friday"));

    expect(sent[sent.length - 1].messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "user", content: "Friday" })]),
    );
  });
});

function calls(name: string, input: Record<string, string> = {}) {
  return {
    content: [{ type: "tool_use", id: `t-${name}`, name, input }],
    usage: { input_tokens: 100, output_tokens: 10 },
  };
}

/**
 * B1237 — a claim about a screen or a page is checked on WhatsApp even when
 * a real proposal (and its real buttons) is waiting, which is exactly the
 * turn the web-side guard leaves alone on purpose (see `ON_SCREEN`'s own doc
 * comment in `lib/helper/model.ts`).
 */
describe("a claim about a screen or a page, on WhatsApp", () => {
  test("is retried even though a real proposal is waiting, and the corrected answer goes out", async () => {
    await bindGreetAcknowledge("screentest", "41760007777");
    create
      .mockResolvedValueOnce(calls("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }))
      .mockResolvedValueOnce(says("Ein Vorschlag liegt auf deinem Bildschirm. Drück ihn, um die Reise zu erstellen."))
      .mockResolvedValueOnce(says("Hier ist der Vorschlag — drück, um zu bestätigen."));
    await handleInboundMessage(textMessage("41760007777", "wamid.screen-1", "plan a trip to japan"));

    const last = repliesTo("screentest").at(-1);
    expect(last?.kind).toBe("buttons");
    expect(JSON.stringify(last)).not.toContain("Bildschirm");
    expect(JSON.stringify(last)).toContain("drück, um zu bestätigen");
  });

  test("an honest 'press the button' is left alone when this message really carries buttons", async () => {
    await bindGreetAcknowledge("buttontest", "41760008888");
    create
      .mockResolvedValueOnce(calls("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }))
      .mockResolvedValueOnce(says("Drücke den Button, um die Reise anzulegen."));
    await handleInboundMessage(textMessage("41760008888", "wamid.button-1", "plan a trip to japan"));

    const last = repliesTo("buttontest").at(-1);
    expect(last?.kind).toBe("buttons");
    expect(JSON.stringify(last)).toContain("Drücke den Button");
  });
});

/**
 * B1262 — the recorded `guard` names the check that authored what actually
 * shipped, not the check that only fired on a discarded first draft.
 *
 * Scripted so the two passes are caught for genuinely different reasons: the
 * first draft claims a screen (caught, retried); the retry's own draft drops
 * the screen claim but goes on to claim a write with nothing pressed and
 * nothing written (a different check, "claim"). The fallback sentence sent
 * to the person is `PLAINLY.claim`, so the durable row has to say "claim",
 * not "screen".
 */
describe("a turn whose retry trades one false claim for another", () => {
  test("the recorded guard names the check behind the delivered sentence", async () => {
    await bindGreetAcknowledge("guardtest", "41760009999");
    create
      .mockResolvedValueOnce(says("Schau auf deinem Bildschirm, dort steht alles."))
      .mockResolvedValueOnce(says("Der Tag ist gespeichert."));
    await handleInboundMessage(textMessage("41760009999", "wamid.guard-1", "was ist mit meinem tag"));

    const { db } = (await getDatabase())!;
    const rows = await db
      .selectFrom("helper_sessions")
      .selectAll()
      .where("owner_id", "=", "guardtest")
      .where("kind", "=", "turn")
      .execute();
    const row = rows.find((r) => r.said === "was ist mit meinem tag");
    expect(row?.guard).toBe("claim");
    expect(row?.recovered).toBeFalsy();
  });
});

/**
 * B1303, scenario-edges.md finding 6 — a turn has no sense of time
 * otherwise. `Turn` carries no timestamp, so nothing behind the system
 * prompt's "long gap, new subject: ask" line could ever fire from real
 * elapsed time; `lib/whatsapp/dispatch.ts` now folds an honest one-line note
 * in when the thread's last touch was 4+ hours ago.
 */
describe("a gap since the last message", () => {
  test("a long gap folds a note the model can read", async () => {
    await bindGreetAcknowledge("gaptest1", "41760001234");
    create.mockResolvedValueOnce(says("Noted."));
    await handleInboundMessage(textMessage("41760001234", "wamid.gap1.first", "day one at the lake"));

    // Push the thread's own last-touch back 7 hours — the same technique
    // scenario-edges.md's own rig used against `helper_threads.touched_at`,
    // done here against the live in-memory cache `lib/helper/thread.ts`
    // reads first (the same `globalThis` singleton the module itself uses).
    const cache = (globalThis as { __fsHelperThreads?: Map<string, { touched: number }> }).__fsHelperThreads;
    const state = cache?.get("gaptest1");
    expect(state).toBeDefined();
    if (state) state.touched -= 7 * 60 * 60 * 1000;

    create.mockResolvedValueOnce(says("Postcards work like this."));
    await handleInboundMessage(textMessage("41760001234", "wamid.gap1.second", "what about postcards"));

    const lastCall = sent.at(-1) as { messages: { role: string; content: string }[] };
    const lastMessage = lastCall.messages.at(-1);
    expect(lastMessage?.content).toMatch(/\[gap: about 7 hours since the last message\]/);
  });

  test("a short gap adds no note", async () => {
    await bindGreetAcknowledge("gaptest2", "41760001235");
    create.mockResolvedValueOnce(says("Noted."));
    await handleInboundMessage(textMessage("41760001235", "wamid.gap2.first", "day one at the lake"));

    create.mockResolvedValueOnce(says("Postcards work like this."));
    await handleInboundMessage(textMessage("41760001235", "wamid.gap2.second", "what about postcards"));

    const lastCall = sent.at(-1) as { messages: { role: string; content: string }[] };
    const lastMessage = lastCall.messages.at(-1);
    expect(lastMessage?.content).not.toMatch(/\[gap:/);
  });
});
