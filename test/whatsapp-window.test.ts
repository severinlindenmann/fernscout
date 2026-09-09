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
import { isWindowOpen, markInbound } from "@/lib/whatsapp/window";
import { holdAnswer, takeHeldAnswer } from "@/lib/whatsapp/held";
import { sendOutboundReply } from "@/lib/whatsapp/reply";

/**
 * B1061 — this channel never initiates, and the machinery that makes that
 * true rather than merely asked-for.
 *
 * `isWindowOpen` answers the window question directly; `sendOutboundReply`
 * is where every send in the codebase passes through, so it is what is
 * checked rather than trusting every caller to ask first; and an answer that
 * cannot go out is held, then delivered on the next inbound message —
 * verified end to end through `handleInboundMessage`.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-window-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
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

afterEach(async () => {
  await closeDatabase();
  forget("windowtest");
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isWindowOpen", () => {
  test("closed with no inbound message ever recorded", () => {
    expect(isWindowOpen("windowtest", "41760007777")).toBe(false);
  });

  test("open right after an inbound message, closed 24 hours later", () => {
    const now = Date.now();
    markInbound("windowtest", "41760007777", now);
    expect(isWindowOpen("windowtest", "41760007777", now + 1000)).toBe(true);
    expect(isWindowOpen("windowtest", "41760007777", now + 25 * 60 * 60 * 1000)).toBe(false);
  });
});

describe("held answers", () => {
  test("at most one — a later hold overwrites an earlier, unsent one", () => {
    holdAnswer("windowtest", "41760007777", { kind: "text", body: "first" });
    holdAnswer("windowtest", "41760007777", { kind: "text", body: "second" });
    const taken = takeHeldAnswer("windowtest", "41760007777");
    expect(taken?.outbound).toEqual({ kind: "text", body: "second" });
    // Taken once — a second take finds nothing.
    expect(takeHeldAnswer("windowtest", "41760007777")).toBeNull();
  });
});

describe("sendOutboundReply refuses outside the window and holds instead", () => {
  test("a journal's own reply outside the window is held, not sent, not dropped", async () => {
    fs.mkdirSync(path.join(dir, "windowtest"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "windowtest", "config.json"),
      JSON.stringify({
        title: "T",
        tagline: "t",
        owner: { name: "A", nickname: "A", email: "a@example.test" },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
      }),
    );
    clearUserCache();
    // Never marked inbound — the window is closed by construction.
    const outcome = await sendOutboundReply("41760008888", { kind: "text", body: "your day is ready" }, "windowtest");
    expect(outcome).toEqual({ sent: false, held: true });
    expect(takeHeldAnswer("windowtest", "41760008888")?.outbound).toEqual({
      kind: "text",
      body: "your day is ready",
    });
  });

  test("a stranger reply (no journal) is never held — always trivially in-window", async () => {
    const outcome = await sendOutboundReply("41760009999", { kind: "text", body: "hi" }, null);
    expect(outcome).toEqual({ sent: true });
  });
});

describe("a held answer is delivered on the next inbound message", () => {
  test("end to end through handleInboundMessage", async () => {
    vi.resetModules();
    const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");
    await migrateToLatest(await getDatabase());

    const created = createJournal({
      username: "windowdelivery",
      title: "A journal",
      ownerEmail: "windowdelivery@example.test",
      ownerName: "Owner",
      ownerNickname: "Owner",
      defaultLocale: "en",
      ownerTel: "41760001212",
      ownerTelProvenAt: new Date().toISOString(),
      ownerTelProvenMethod: "sms",
    });
    expect(created.ok).toBe(true);
    expect(setJournalFeatures("windowdelivery", { whatsappInbound: true }).ok).toBe(true);

    // Greet, so the number is bound and past the first-message branch.
    await handleInboundMessage({
      kind: "text",
      id: "wamid.wd1",
      from: "41760001212",
      timestamp: "1",
      body: "hi",
    });

    // A late job finished while the window was shut — held directly, the
    // way a future job-completion caller would.
    holdAnswer("windowdelivery", "41760001212", { kind: "text", body: "Your photobook is ready." });

    const replyDir = path.join(dir, "windowdelivery", "whatsapp-replies");
    const before = fs.existsSync(replyDir) ? fs.readdirSync(replyDir).length : 0;

    // The next message reopens the window, and the held answer goes out
    // before anything this message itself provokes.
    await handleInboundMessage({
      kind: "text",
      id: "wamid.wd2",
      from: "41760001212",
      timestamp: "2",
      body: "ja",
    });

    const files = fs.readdirSync(replyDir).sort();
    expect(files.length).toBeGreaterThan(before);
    const delivered = files.map((f) => JSON.parse(fs.readFileSync(path.join(replyDir, f), "utf8")));
    expect(delivered.some((d) => d.body === "Your photobook is ready.")).toBe(true);
    expect(takeHeldAnswer("windowdelivery", "41760001212")).toBeNull();
    forget("windowdelivery");
  });
});
