import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { handleInboundMessage } from "@/lib/whatsapp/dispatch";
import { isAcknowledgement } from "@/lib/whatsapp/acknowledge";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1138 — the disclosure sent with the first reply is gated on an
 * acknowledgement, not merely disclosed once and forgotten.
 *
 * Acceptance line, verified directly: a newly greeted number that has not
 * replied "yes" (or equivalent) gets no model turn — there is no model turn
 * to run yet (B1056), so this checks the thing that stands in for it: no
 * further reply at all, on an ordinary message, until a "yes" lands.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-ack-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout Test", url: "https://t.test" },
      users: { reserved: [] },
      features: { whatsappInbound: { enabled: true }, whatsapp: { enabled: true, backend: "dry-run" } },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function textMessage(from: string, id: string, body: string): InboundMessage {
  return { kind: "text", id, from, timestamp: "1710000000", body };
}

function repliesTo(username: string): string[] {
  const replyDir = path.join(dir, username, "whatsapp-replies");
  if (!fs.existsSync(replyDir)) return [];
  return fs.readdirSync(replyDir);
}

function bindJournal(username: string, tel: string, defaultLocale = "en") {
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
}

describe("isAcknowledgement", () => {
  test("exact, trimmed, case-insensitive match only", () => {
    expect(isAcknowledgement("yes", "en")).toBe(true);
    expect(isAcknowledgement("  YES  ", "en")).toBe(true);
    expect(isAcknowledgement("y", "en")).toBe(true);
    expect(isAcknowledgement("ja", "de")).toBe(true);
    expect(isAcknowledgement("Ja", "de")).toBe(true);
    expect(isAcknowledgement("igen", "hu")).toBe(true);
  });

  test("a sentence that merely contains the word is not an acknowledgement", () => {
    expect(isAcknowledgement("yes I will tell you about my day", "en")).toBe(false);
    expect(isAcknowledgement("", "en")).toBe(false);
    expect(isAcknowledgement("ja", "en")).toBe(false);
  });
});

describe("the gate", () => {
  test("an ordinary message before 'yes' gets no further reply", async () => {
    bindJournal("gatetest", "41760003333");
    await handleInboundMessage(textMessage("41760003333", "wamid.g1", "hi"));
    expect(repliesTo("gatetest").length).toBe(1); // the greeting only

    await handleInboundMessage(textMessage("41760003333", "wamid.g2", "here is my day"));
    expect(repliesTo("gatetest").length).toBe(1); // still nothing more
  });

  test("'yes' is acknowledged, in the journal's own locale, and confirmed once", async () => {
    bindJournal("gateyes", "41760004444", "de");
    await handleInboundMessage(textMessage("41760004444", "wamid.y1", "hallo"));
    expect(repliesTo("gateyes").length).toBe(1);

    await handleInboundMessage(textMessage("41760004444", "wamid.y2", "ja"));
    const files = repliesTo("gateyes");
    expect(files.length).toBe(2);
    const ackBody = JSON.parse(fs.readFileSync(path.join(dir, "gateyes", "whatsapp-replies", files[1]), "utf8"));
    expect(ackBody.body).toMatch(/Danke/);

    // A second "ja" does nothing further — already acknowledged.
    await handleInboundMessage(textMessage("41760004444", "wamid.y3", "ja"));
    expect(repliesTo("gateyes").length).toBe(2);
  });
});
