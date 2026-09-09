import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal } from "@/lib/journals";
import { handleInboundMessage } from "@/lib/whatsapp/dispatch";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1058 — binding an inbound number to a journal.
 *
 * A message from a bound number reaches that journal (and greets it once); a
 * message from an unknown number costs no model call and gets one fixed
 * sentence; a number bound to one journal cannot be bound to a second
 * (already proved in test/registry.test.ts — this file is about what the
 * webhook *does* with the binding, not the lock itself).
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-binding-"));
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

function textMessage(from: string, id: string, body = "hi"): InboundMessage {
  return { kind: "text", id, from, timestamp: "1710000000", body };
}

function repliesTo(username: string | null): string[] {
  const replyDir = path.join(dir, username ?? ".whatsapp", "whatsapp-replies");
  if (!fs.existsSync(replyDir)) return [];
  return fs.readdirSync(replyDir);
}

describe("binding an inbound number", () => {
  test("a stranger gets one fixed sentence and no journal is touched", async () => {
    await handleInboundMessage(textMessage("41760009999", "wamid.stranger-1"));
    const files = repliesTo(null);
    expect(files.length).toBe(1);
    const body = JSON.parse(fs.readFileSync(path.join(dir, ".whatsapp", "whatsapp-replies", files[0]), "utf8"));
    expect(body.body).toMatch(/private travel journal/);
  });

  test("a bound number's first message is greeted once, in the journal's own locale", () => {
    const created = createJournal({
      username: "severin",
      title: "A journal",
      ownerEmail: "severin@example.test",
      ownerName: "Severin",
      ownerNickname: "Severin",
      defaultLocale: "de",
      ownerTel: "41760001111",
      ownerTelProvenAt: new Date().toISOString(),
      ownerTelProvenMethod: "sms",
    });
    expect(created.ok).toBe(true);

    return handleInboundMessage(textMessage("41760001111", "wamid.first-1")).then(() => {
      const files = repliesTo("severin");
      expect(files.length).toBe(1);
      const body = JSON.parse(fs.readFileSync(path.join(dir, "severin", "whatsapp-replies", files[0]), "utf8"));
      // German, since defaultLocale: "de" — and carries the journal's own URL.
      expect(body.body).toMatch(/KI/);
      expect(body.body).toMatch(/severin/);

      // A second message from the same, now-greeted number gets no fixed
      // reply — B1058 says the greeting is "never on every conversation".
      return handleInboundMessage(textMessage("41760001111", "wamid.second-1")).then(() => {
        expect(repliesTo("severin").length).toBe(1);
      });
    });
  });
});
