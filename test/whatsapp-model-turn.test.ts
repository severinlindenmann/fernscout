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
