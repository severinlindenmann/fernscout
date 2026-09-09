import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { forget } from "@/lib/helper/thread";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1060 — a voice note sent over WhatsApp reaches the transcriber that
 * already exists, and nothing new is copied to make it happen.
 *
 * Consent is asked once, in chat, before any bytes move; the money path
 * (`spendAndTranscribe`) is the exact one the web route uses; the transcript
 * is echoed back before it is fed to the model; and — the run's own
 * instruction — the audio is provably not on disk afterwards, over this
 * channel too.
 */

const AUDIO_BYTES = Buffer.from("not really opus, but bytes are bytes for this test");

const { downloadMedia } = vi.hoisted(() => ({ downloadMedia: vi.fn() }));
vi.mock("@/lib/whatsapp/cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp/cloud")>()),
  downloadMedia,
}));

const { transcribeAudio } = vi.hoisted(() => ({ transcribeAudio: vi.fn() }));
vi.mock("@/lib/helper/transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/transcribe")>()),
  transcribeAudio,
}));

// The model turn this feeds into is not this ticket's business (B1056 covers
// it) — scripted the same way test/helper-thread.test.ts scripts it, so a
// voice note's transcript reaching the model does not also reach the network.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [{ type: "text", text: "Got it." }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
  },
}));

process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";

const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");

let dir: string;

function everyFile(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...everyFile(full));
    else out.push(full);
  }
  return out;
}

function textMessage(from: string, id: string, body: string): InboundMessage {
  return { kind: "text", id, from, timestamp: "1", body };
}

function audioMessage(from: string, id: string): InboundMessage {
  return { kind: "audio", id, from, timestamp: "1", mediaId: "media-1", mimeType: "audio/ogg", voice: true };
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-voice-"));
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
        transcription: { enabled: true, backend: "dry-run" },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
  downloadMedia.mockReset();
  downloadMedia.mockResolvedValue({ data: AUDIO_BYTES, mimeType: "audio/ogg" });
  transcribeAudio.mockReset();
  forget("voicetest");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  forget("voicetest");
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

describe("a voice note before speech consent", () => {
  test("asks in chat, and does not transcribe yet", async () => {
    await bindGreetAcknowledge("voicetest", "41760011111");
    const before = repliesTo("voicetest").length;

    await handleInboundMessage(audioMessage("41760011111", "wamid.voice-1"));

    expect(transcribeAudio).not.toHaveBeenCalled();
    const files = repliesTo("voicetest");
    expect(files.length).toBe(before + 1);
    expect(String(files[files.length - 1].body)).toMatch(/Deepgram/);
  });

  test("a 'yes' afterward grants speech consent without a second voice note", async () => {
    await bindGreetAcknowledge("voicetest", "41760022222");
    await handleInboundMessage(audioMessage("41760022222", "wamid.voice-2"));
    await handleInboundMessage(textMessage("41760022222", "wamid.voice-2-yes", "yes"));

    const { hasHelperConsent } = await import("@/lib/helper/consent");
    expect(hasHelperConsent("voicetest", "speech")).toBe(true);
    expect(transcribeAudio).not.toHaveBeenCalled(); // still needs the note resent
  });
});

describe("a voice note once consented", () => {
  test("is transcribed, echoed back, and fed to the model — and never touches disk", async () => {
    await bindGreetAcknowledge("voicetest", "41760033333");
    await grant("voicetest", 10, "test");
    const { recordHelperConsent, currentHelperProvider } = await import("@/lib/helper/consent");
    recordHelperConsent("voicetest", currentHelperProvider("speech"), "speech");

    transcribeAudio.mockResolvedValueOnce({ text: "We reached the summit at noon.", seconds: 42 });

    await handleInboundMessage(audioMessage("41760033333", "wamid.voice-3"));
    const after = everyFile(dir);

    expect(downloadMedia).toHaveBeenCalledTimes(1);
    expect(transcribeAudio).toHaveBeenCalledTimes(1);

    const files = repliesTo("voicetest");
    expect(files.some((f) => String(f.body).includes("We reached the summit at noon."))).toBe(true);

    // Never on disk, at any point — the same discipline
    // test/helper-transcribe.test.ts holds the web route to: no new file's
    // *content* contains the audio bytes, anywhere under the content root.
    for (const file of after) {
      expect(fs.readFileSync(file).includes(AUDIO_BYTES)).toBe(false);
    }

    expect(await balanceOf("voicetest")).toBeLessThan(10);
  });

  test("a balance that cannot cover it is refused plainly, with the account link", async () => {
    await bindGreetAcknowledge("voicetest", "41760044444");
    const { recordHelperConsent, currentHelperProvider } = await import("@/lib/helper/consent");
    recordHelperConsent("voicetest", currentHelperProvider("speech"), "speech");
    // No grant() — balance is 0.

    await handleInboundMessage(audioMessage("41760044444", "wamid.voice-4"));

    const files = repliesTo("voicetest");
    const last = String(files[files.length - 1].body);
    expect(last).toContain("/voicetest/account");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});
