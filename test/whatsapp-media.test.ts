import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createJournal, setJournalFeatures } from "@/lib/journals";
import { forget } from "@/lib/helper/thread";
import { findInboxFile, listInbox } from "@/lib/inbox";
import type { InboundMessage } from "@/lib/whatsapp/inbound";

/**
 * B1059 — a photograph or document sent over WhatsApp lands in the inbox,
 * with where it came from, and the storage ceiling and the documents-versus-
 * photos tip both apply exactly as the ticket says.
 */

const PHOTO_BYTES = Buffer.from("not really a jpeg, but bytes are bytes for this test");

const { downloadMedia } = vi.hoisted(() => ({ downloadMedia: vi.fn() }));
vi.mock("@/lib/whatsapp/cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp/cloud")>()),
  downloadMedia,
}));

process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-id";

const { handleInboundMessage } = await import("@/lib/whatsapp/dispatch");

let dir: string;

function textMessage(from: string, id: string, body: string): InboundMessage {
  return { kind: "text", id, from, timestamp: "1", body };
}

function imageMessage(from: string, id: string, caption?: string): InboundMessage {
  return {
    kind: "image",
    id,
    from,
    timestamp: "1700000000",
    mediaId: `media-${id}`,
    mimeType: "image/jpeg",
    sha256: "abc",
    ...(caption ? { caption } : {}),
  };
}

function documentMessage(from: string, id: string, filename: string): InboundMessage {
  return {
    kind: "document",
    id,
    from,
    timestamp: "1700000000",
    mediaId: `media-${id}`,
    mimeType: "image/jpeg",
    sha256: "def",
    filename,
  };
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

beforeEach(() => {
  // B1240's batch window: fake `setTimeout` only, so `receivedAt` and every
  // other `Date.now()` in this flow stay real.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-media-"));
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
  downloadMedia.mockReset();
  downloadMedia.mockResolvedValue({ data: PHOTO_BYTES, mimeType: "image/jpeg" });
  forget("mediatest");
});

afterEach(() => {
  vi.useRealTimers();
  forget("mediatest");
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a photograph sent as a photo", () => {
  test("lands in the inbox as media, with whatsapp provenance and no takenAt guessed", async () => {
    await bindGreetAcknowledge("mediatest", "41760055555");
    await handleInboundMessage(imageMessage("41760055555", "wamid.img-1", "at the summit"));

    const listed = listInbox("mediatest");
    expect(listed.media).toHaveLength(1);
    const entry = listed.media[0];
    expect(entry.source).toBe("whatsapp");
    expect(entry.receivedAt).toBeTruthy();
    expect(entry.takenAt).toBeUndefined();
    expect(entry.caption).toBe("at the summit");

    // The batch's own window — B1240 — before the one summary reply lands.
    await vi.advanceTimersByTimeAsync(6000);

    const files = repliesTo("mediatest");
    const last = String(files[files.length - 1].body);
    expect(last).toContain("1 waiting");
    // The documents-versus-photos tip, said the first time it matters.
    expect(last).toMatch(/document/i);
  });

  test("the tip is said once, never on a second, later batch", async () => {
    await bindGreetAcknowledge("mediatest", "41760066666");
    await handleInboundMessage(imageMessage("41760066666", "wamid.img-2a"));
    await vi.advanceTimersByTimeAsync(6000);
    const first = repliesTo("mediatest").at(-1);
    expect(String(first?.body)).toContain("1 waiting");
    expect(String(first?.body)).toMatch(/document/i);

    downloadMedia.mockResolvedValueOnce({ data: Buffer.from("a different photograph entirely"), mimeType: "image/jpeg" });
    await handleInboundMessage(imageMessage("41760066666", "wamid.img-2b"));
    await vi.advanceTimersByTimeAsync(6000);

    const second = repliesTo("mediatest").at(-1);
    expect(String(second?.body)).toContain("2 waiting");
    expect(String(second?.body)).not.toMatch(/document/i);
  });

  test("three photos within the window produce one reply naming three — B1240", async () => {
    await bindGreetAcknowledge("mediatest", "41760055566");
    await handleInboundMessage(imageMessage("41760055566", "wamid.batch-1"));
    downloadMedia.mockResolvedValueOnce({ data: Buffer.from("photo two"), mimeType: "image/jpeg" });
    await handleInboundMessage(imageMessage("41760055566", "wamid.batch-2"));
    downloadMedia.mockResolvedValueOnce({ data: Buffer.from("photo three"), mimeType: "image/jpeg" });
    await handleInboundMessage(imageMessage("41760055566", "wamid.batch-3"));

    // No reply yet — still inside the window.
    const midway = repliesTo("mediatest");
    expect(midway.filter((f) => String(f.body).includes("waiting"))).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(6000);

    const files = repliesTo("mediatest").filter((f) => String(f.body).includes("waiting"));
    expect(files).toHaveLength(1);
    expect(String(files[0].body)).toContain("3 waiting");
  });

  test("a non-media message flushes a waiting batch instead of leaving it silent", async () => {
    await bindGreetAcknowledge("mediatest", "41760055577");
    await handleInboundMessage(imageMessage("41760055577", "wamid.flush-1"));

    // No reply yet.
    expect(repliesTo("mediatest").filter((f) => String(f.body).includes("waiting"))).toHaveLength(0);

    await handleInboundMessage(textMessage("41760055577", "wamid.flush-2", "here's the photo, at the lake"));

    const landed = repliesTo("mediatest").filter((f) => String(f.body).includes("waiting"));
    expect(landed).toHaveLength(1);
  });
});

describe("the same file sent as a document", () => {
  test("arrives intact, filed as media because its extension says so", async () => {
    await bindGreetAcknowledge("mediatest", "41760077777");
    await handleInboundMessage(documentMessage("41760077777", "wamid.doc-1", "summit.jpg"));

    const listed = listInbox("mediatest");
    expect(listed.media).toHaveLength(1);
    expect(listed.media[0].filename).toBe("summit.jpg");
    expect(listed.media[0].source).toBe("whatsapp");
  });

  test("an unrecognised extension is filed as a file, not lost", async () => {
    await bindGreetAcknowledge("mediatest", "41760088888");
    await handleInboundMessage(documentMessage("41760088888", "wamid.doc-2", "notes.xyz"));

    const listed = listInbox("mediatest");
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0].filename).toBe("notes.xyz");
  });
});

describe("the same photograph sent twice", () => {
  test("is one file, not two", async () => {
    await bindGreetAcknowledge("mediatest", "41760099999");
    await handleInboundMessage(imageMessage("41760099999", "wamid.dup-1"));
    await handleInboundMessage(imageMessage("41760099999", "wamid.dup-2"));

    const listed = listInbox("mediatest");
    expect(listed.media).toHaveLength(1);
  });
});

describe("past the storage ceiling", () => {
  test("is refused in a sentence a person understands, and nothing is written", async () => {
    await bindGreetAcknowledge("mediatest", "41760010101");
    // A ceiling far below what the fixture bytes need.
    const configPath = path.join(dir, "mediatest", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.media = { perUserBytes: 5 };
    fs.writeFileSync(configPath, JSON.stringify(config));
    clearUserCache();

    await handleInboundMessage(imageMessage("41760010101", "wamid.full-1"));

    const listed = listInbox("mediatest");
    expect(listed.media).toHaveLength(0);
    const files = repliesTo("mediatest");
    const last = String(files[files.length - 1].body);
    expect(last).toMatch(/holds|room/i);
  });
});

describe("video", () => {
  test("gets one not-supported sentence, told once", async () => {
    await bindGreetAcknowledge("mediatest", "41760011011");
    await handleInboundMessage({
      kind: "video",
      id: "wamid.video-1",
      from: "41760011011",
      timestamp: "1",
      mediaId: "media-video-1",
      mimeType: "video/mp4",
      sha256: "vid",
    });
    await handleInboundMessage({
      kind: "video",
      id: "wamid.video-2",
      from: "41760011011",
      timestamp: "1",
      mediaId: "media-video-2",
      mimeType: "video/mp4",
      sha256: "vid2",
    });

    const files = repliesTo("mediatest");
    // Greeting + ack + exactly one video-not-supported reply.
    const notSupported = files.filter((f) => String(f.body).match(/video/i));
    expect(notSupported).toHaveLength(1);
    expect(findInboxFile("mediatest", "media-video-1")).toBeNull();
  });
});

/**
 * B1263 — a failed download used to say nothing at all. A sender who just
 * sent a photo has no way to tell a real failure from "still typing…".
 */
describe("a media download that fails", () => {
  test("gets one honest sentence back, in the journal's locale", async () => {
    await bindGreetAcknowledge("mediatest", "41760012012");
    downloadMedia.mockRejectedValueOnce(new Error("graph.facebook.com is unreachable"));

    await handleInboundMessage(imageMessage("41760012012", "wamid.img-fail"));

    const listed = listInbox("mediatest");
    expect(listed.media).toHaveLength(0);
    const files = repliesTo("mediatest");
    const last = String(files[files.length - 1].body);
    expect(last.length).toBeGreaterThan(0);
    expect(last).not.toMatch(/graph\.facebook\.com/);
  });
});
