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
import { getTrips } from "@/lib/trips";
import type { Say } from "@/lib/helper/intents";

/**
 * B1230 — a proposal on WhatsApp gets a real button, and the tap it answers
 * to actually presses it.
 *
 * The model is scripted exactly as `test/whatsapp-model-turn.test.ts` and
 * `test/helper-ask.test.ts` already do: `answerInThread` is stubbed to call
 * one real tool through `runTool`, so the proposal in these assertions is the
 * product's own rather than a fixture's, and the write that follows a tap is
 * the real route, reached through `lib/helper/caller.ts`'s trusted-caller
 * door rather than a second implementation.
 */

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: async (params: Record<string, unknown>) => create(params) };
  },
}));

const { answerInThread } = vi.hoisted(() => ({ answerInThread: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  answerInThread,
}));

const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");
const { runTool } = await import("@/lib/helper/tools");

let dir: string;

/** A turn that says something and calls one real write tool — the proposal
 *  this file presses is the tool registry's own. */
function turnCalling(name: string, args: Record<string, string>, answer = "Here it is.") {
  return async (user: string, _said: string, _turns: unknown, today: string, say: Say) => {
    const ran = await runTool(user, name, args, say, today);
    return {
      answer,
      looked: [name],
      blocks: ran.blocks,
      proposals: ran.proposal ? [ran.proposal] : [],
      guard: "",
      recovered: false,
    };
  };
}

function textMessage(from: string, id: string, body: string) {
  return { kind: "text" as const, id, from, timestamp: "1710000000", body };
}

function interactiveMessage(from: string, id: string, replyId: string) {
  return { kind: "interactive" as const, id, from, timestamp: "1710000000", replyId, title: "" };
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-press-"));
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
  answerInThread.mockReset();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
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

describe("a proposal that leaves the model with nowhere to press", () => {
  test("gets real accept/decline buttons on WhatsApp", async () => {
    const username = "presstest1";
    const tel = "41760001111";
    forget(username);
    await bindGreetAcknowledge(username, tel);

    answerInThread.mockImplementationOnce(
      turnCalling("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }, "Here's the trip."),
    );
    await handleInboundMessage(textMessage(tel, "wamid.press1.propose", "plan a trip to japan"));

    const last = repliesTo(username).at(-1);
    expect(last?.kind).toBe("buttons");
    const buttons = last?.buttons as { id: string; title: string }[];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].id).toBe("confirm:0:yes");
    expect(buttons[0].title).toBe("Make this trip");
    expect(buttons[1].id).toBe("confirm:1:no");
    forget(username);
  });
});

describe("tapping accept", () => {
  test("creates the trip and says so — the same write the web panel's button makes", async () => {
    const username = "presstest2";
    const tel = "41760002222";
    forget(username);
    await bindGreetAcknowledge(username, tel);

    answerInThread.mockImplementationOnce(
      turnCalling("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }, "Here's the trip."),
    );
    await handleInboundMessage(textMessage(tel, "wamid.press2.propose", "plan a trip to japan"));

    expect(getTrips(username)).toHaveLength(0);

    await handleInboundMessage(interactiveMessage(tel, "wamid.press2.tap", "confirm:0:yes"));

    const trips = getTrips(username);
    expect(trips).toHaveLength(1);
    expect(trips[0].title).toBe("Japan");

    const last = repliesTo(username).at(-1);
    expect(last?.body).toBe("The trip is made.");
    forget(username);
  });

  test("a second tap — Meta redelivering, or a genuine double-press — writes nothing again", async () => {
    const username = "presstest3";
    const tel = "41760003333";
    forget(username);
    await bindGreetAcknowledge(username, tel);

    answerInThread.mockImplementationOnce(
      turnCalling("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }, "Here's the trip."),
    );
    await handleInboundMessage(textMessage(tel, "wamid.press3.propose", "plan a trip to japan"));
    await handleInboundMessage(interactiveMessage(tel, "wamid.press3.tap-a", "confirm:0:yes"));
    expect(getTrips(username)).toHaveLength(1);

    // A different wamid — the webhook route's own dedupe (by wamid) never
    // sees this as a duplicate, so the only thing standing between it and a
    // second trip is `lib/whatsapp/pendingProposal.ts`'s take-once read.
    await handleInboundMessage(interactiveMessage(tel, "wamid.press3.tap-b", "confirm:0:yes"));
    expect(getTrips(username)).toHaveLength(1);

    const last = repliesTo(username).at(-1);
    expect(last?.body).toContain("nothing waiting");
    forget(username);
  });
});

describe("tapping decline", () => {
  test("discards the proposal — nothing is written", async () => {
    const username = "presstest4";
    const tel = "41760004444";
    forget(username);
    await bindGreetAcknowledge(username, tel);

    answerInThread.mockImplementationOnce(
      turnCalling("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }, "Here's the trip."),
    );
    await handleInboundMessage(textMessage(tel, "wamid.press4.propose", "plan a trip to japan"));
    await handleInboundMessage(interactiveMessage(tel, "wamid.press4.tap", "confirm:1:no"));

    expect(getTrips(username)).toHaveLength(0);
    const last = repliesTo(username).at(-1);
    expect(last?.body).toBe("Left it — nothing was written.");
    forget(username);
  });
});

describe("a money proposal that reaches the thread — the scope guard", () => {
  test("still offers a button (it already rendered as `confirm`), but the tap refuses to press it", async () => {
    const username = "presstest5";
    const tel = "41760005555";
    forget(username);
    await bindGreetAcknowledge(username, tel);

    answerInThread.mockImplementationOnce(turnCalling("buy_room", {}, "That would spend credits."));
    await handleInboundMessage(textMessage(tel, "wamid.press5.propose", "buy more room"));

    const proposeReply = repliesTo(username).at(-1);
    expect(proposeReply?.kind).toBe("buttons");

    await handleInboundMessage(interactiveMessage(tel, "wamid.press5.tap", "confirm:0:yes"));

    const last = repliesTo(username).at(-1);
    expect(last?.body).toContain("needs the web");
    forget(username);
  });
});
