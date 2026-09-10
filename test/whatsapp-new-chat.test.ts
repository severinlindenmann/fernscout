import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { forget, history, liveSession, remember } from "@/lib/helper/thread";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1245 — a command that starts a fresh conversation, matched exactly and
 * before the model, the same discipline `wa.yes` already has.
 */

const { answerInThread } = vi.hoisted(() => ({ answerInThread: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  answerInThread,
}));

const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");

let dir: string;

function textMessage(from: string, id: string, body: string): InboundMessage {
  return { kind: "text", id, from, timestamp: "1", body };
}

function repliesTo(username: string): Record<string, unknown>[] {
  const replyDir = path.join(dir, username, "whatsapp-replies");
  if (!fs.existsSync(replyDir)) return [];
  return fs
    .readdirSync(replyDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(replyDir, f), "utf8")));
}

async function bindGreetAcknowledge(username: string, tel: string, defaultLocale = "en"): Promise<void> {
  const created = createJournal({
    username,
    title: "A journal",
    ownerEmail: `${username}@example.test`,
    ownerName: "Owner",
    ownerNickname: "Owner",
    defaultLocale,
    ownerTel: tel,
    ownerTelProvenAt: new Date().toISOString(),
    ownerTelProvenMethod: "sms",
  });
  expect(created.ok).toBe(true);
  expect(setJournalFeatures(username, { whatsappInbound: true }).ok).toBe(true);
  await handleInboundMessage(textMessage(tel, `wamid.${username}.greet`, "hi"));
  const yes = defaultLocale === "de" ? "ja" : "yes";
  await handleInboundMessage(textMessage(tel, `wamid.${username}.yes`, yes));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-newchat-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: { whatsappInbound: { enabled: true }, whatsapp: { enabled: true, backend: "dry-run" }, helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  answerInThread.mockReset();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the 'new chat' command", () => {
  test("starts a demonstrably new session, with a one-line confirmation, and never reaches the model", async () => {
    const username = "newchat1";
    const tel = "41760077001";
    forget(username);
    await bindGreetAcknowledge(username, tel);
    remember(username, "day one, at the lake", "Noted.", "whatsapp");
    const before = await liveSession(username);
    expect(before).not.toBeNull();

    await handleInboundMessage(textMessage(tel, "wamid.newchat1.cmd", "new chat"));

    expect(answerInThread).not.toHaveBeenCalled();
    const after = await liveSession(username);
    expect(after).not.toBe(before);
    expect(await history(username)).toEqual([]);

    const last = repliesTo(username).at(-1);
    expect(last?.body).toContain("agent");
    forget(username);
  });

  test("is 'neues gespräch' on a German journal, matched exactly", async () => {
    const username = "newchat2";
    const tel = "41760077002";
    forget(username);
    await bindGreetAcknowledge(username, tel, "de");
    remember(username, "Tag eins am See", "Notiert.", "whatsapp");
    const before = await liveSession(username);

    // A sentence that merely contains the words is not the command.
    await handleInboundMessage(textMessage(tel, "wamid.newchat2.no-match", "wir hatten ein neues gespräch mit dem nachbarn"));
    expect(await liveSession(username)).toBe(before);

    await handleInboundMessage(textMessage(tel, "wamid.newchat2.cmd", "neues gespräch"));
    expect(await liveSession(username)).not.toBe(before);
    forget(username);
  });

  test("old conversations stay reachable — forget clears the live thread, never the kept history", async () => {
    // helper_sessions (what `/agent`'s history panel reads) is a separate,
    // append-only log `forget()` never touches — see `lib/helper/sessions.ts`.
    const username = "newchat3";
    const tel = "41760077003";
    forget(username);
    await bindGreetAcknowledge(username, tel);
    const before = await liveSession(username);
    expect(before).not.toBeNull();

    await handleInboundMessage(textMessage(tel, "wamid.newchat3.cmd", "new chat"));

    // The old session id is gone from the *live* thread, but nothing here
    // deletes `helper_sessions` — `forget()` (lib/helper/thread.ts) only
    // drops `helper_threads`, the live-conversation cache.
    expect(await liveSession(username)).not.toBe(before);
    forget(username);
  });
});
