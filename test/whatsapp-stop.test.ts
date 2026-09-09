import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { forget } from "@/lib/helper/thread";
import { isStopWord } from "@/lib/whatsapp/stop";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1062 — a reader who writes STOP gets their own manage link and no more
 * announcements; an owner (already bound, never reaches this path) writing
 * "stop" mid-conversation is unaffected — it is a word in a sentence.
 */

const OWNER = "stoptest";
const OWNER_EMAIL = "stoptest@example.test";
const READER_TEL = "41760099001";

let dir: string;

async function addReader(tel: string): Promise<string> {
  await requestContact(OWNER, {
    name: "A Reader",
    email: "reader@example.test",
    locale: "en",
    address: { tel },
    wantsEmailDigest: true,
    wantsPostcard: false,
    wantsWhatsapp: true,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, "reader@example.test", "guest");
  const confirmed = await confirmContact(OWNER, "reader@example.test", code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  await approveContact(OWNER, confirmed.contact.id);
  return confirmed.contact.id;
}

function textMessage(from: string, id: string, body: string): InboundMessage {
  return { kind: "text", id, from, timestamp: "1", body };
}

function repliesTo(dirName: string): Record<string, unknown>[] {
  const replyDir = path.join(dir, dirName, "whatsapp-replies");
  if (!fs.existsSync(replyDir)) return [];
  return fs
    .readdirSync(replyDir)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(replyDir, f), "utf8")));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-stop-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  process.env.CONTACTS_ENCRYPTION_KEY = "84b34a72cde3cc42050ae148c68e840a132f57305fef70269af18c88ec8ded7f";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: {
        whatsappInbound: { enabled: true },
        whatsapp: { enabled: true, backend: "dry-run" },
        auth: { enabled: true },
        contacts: { enabled: true },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
  forget(OWNER);
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "A journal",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Owner",
    ownerNickname: "Owner",
    defaultLocale: "en",
  });
  expect(created.ok).toBe(true);
  expect(setJournalFeatures(OWNER, { whatsappInbound: true }).ok).toBe(true);
});

afterEach(async () => {
  await closeDatabase();
  forget(OWNER);
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isStopWord", () => {
  test("exact, trimmed, case-insensitive, in three languages", () => {
    for (const word of ["stop", "STOP", "  Stop  ", "stopp", "abbestellen", "leiratkozás", "LEIRATKOZÁS"]) {
      expect(isStopWord(word)).toBe(true);
    }
  });

  test("a sentence containing the word is not the word", () => {
    expect(isStopWord("please stop sending me these")).toBe(false);
    expect(isStopWord("")).toBe(false);
  });
});

describe("a reader who writes STOP", () => {
  test("gets their own manage link and the journal is not touched directly", async () => {
    await addReader(READER_TEL);
    const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");

    await handleInboundMessage(textMessage(READER_TEL, "wamid.stop-1", "STOP"));

    const files = repliesTo(".whatsapp");
    expect(files.length).toBeGreaterThan(0);
    const last = String(files[files.length - 1].body);
    expect(last).toMatch(new RegExp(`/${OWNER}/u/`));
  });

  test("an unrecognised number gets the ordinary stranger sentence, not the manage link", async () => {
    const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");
    await handleInboundMessage(textMessage("41760099999", "wamid.stop-2", "STOP"));

    const files = repliesTo(".whatsapp");
    expect(files.length).toBeGreaterThan(0);
    const last = String(files[files.length - 1].body);
    expect(last).not.toMatch(/\/u\//);
  });
});
