import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase, getDatabaseOrNull } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearUserCache } from "@/lib/users";
import { sendMail, sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { listMessages, logMessage, recipientHash } from "@/lib/messages/log";

/**
 * B2438 — the send log, exercised directly against `sendMail`/`sendTransactional`
 * rather than through a whole route: those are the choke points every mail
 * goes through, so what they log is what every letter logs.
 */

let dir: string;
let data: string;

function serverConfig(extra: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file", ...extra } },
    }),
  );
  clearConfigCache();
}

function writeJournal(username: string, mail: boolean) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      owner: { name: "Robin", nickname: "Robin", email: "owner@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { mail: { enabled: mail } },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-msglog-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-msglog-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-the-message-log";
  serverConfig();
  await migrateToLatest(await getDatabase());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const CONTENT = {
  template: "code.mail" as const,
  preheader: "your code",
  title: "your code",
  blocks: [{ kind: "paragraph" as const, text: "123456" }],
  why: "why",
};

describe("message_log", () => {
  test("a sent mail writes one row: the template, sent, a masked recipient, no address or body", async () => {
    const result = await sendMail(renderMail("mara@example.test", "Your code", CONTENT));
    expect(result).not.toBeNull();

    const rows = await listMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0].template).toBe("code.mail");
    expect(rows[0].channel).toBe("mail");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].recipientMask).toBe("m•••@example.test");
    expect(rows[0].recipientHash).toBe(recipientHash("mara@example.test"));
    // No raw address, no body, anywhere in the row.
    expect(JSON.stringify(rows[0])).not.toContain("mara@example.test");
    expect(JSON.stringify(rows[0])).not.toContain("123456");
  });

  test("features.mail off for a journal writes a skipped row, reason switched_off:journal", async () => {
    writeJournal("quiet", false);
    const result = await sendMail(renderMail("reader@example.test", "Hi", CONTENT, "quiet"));
    expect(result).toBeNull();

    const rows = await listMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].reason).toBe("switched_off:journal");
  });

  test("features.mail off on the server writes a skipped row, reason switched_off:server", async () => {
    serverConfig({ enabled: false });
    const result = await sendMail(renderMail("reader@example.test", "Hi", CONTENT));
    expect(result).toBeNull();

    const rows = await listMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].reason).toBe("switched_off:server");
  });

  test("sendTransactional still logs sent even with the journal switched off", async () => {
    writeJournal("quiet", false);
    const result = await sendTransactional(
      renderMail("reader@example.test", "Your code", CONTENT, "quiet"),
      "a one-time sign-in code",
    );
    expect(result).not.toBeNull();

    const rows = await listMessages();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
  });

  test("with no database configured, sending still works and nothing throws", async () => {
    await closeDatabase();
    delete process.env.DATABASE_URL;
    clearConfigCache();

    await expect(getDatabaseOrNull()).resolves.toBeNull();
    await expect(sendMail(renderMail("reader@example.test", "Hi", CONTENT))).resolves.not.toBeNull();

    // Restore for afterEach's own teardown.
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  });
});

describe("what a row may hold (wave 1 security review)", () => {
  test("a provider error that quotes the recipient is scrubbed before it is stored", async () => {
    await logMessage({
      template: "code.mail",
      channel: "mail",
      to: "mara@example.test",
      status: "failed",
      reason: "RCPT TO failed: 550 5.1.1 <mara@example.test>: Recipient address rejected, other <x@y.test>, call +41 76 000 00 00",
    });
    const [row] = await listMessages({ limit: 1 });
    expect(row.reason).not.toContain("mara@example.test");
    expect(row.reason).not.toContain("x@y.test");
    expect(row.reason).not.toContain("76 000");
    expect(row.reason).toContain("550");
  });

  test("a push endpoint and a group link are opaque recipients, not phone numbers", async () => {
    await logMessage({ template: "news.push", channel: "push", to: "https://push.example.test/abc123/456", status: "sent" });
    await logMessage({ template: "invite.share", channel: "share", to: "link:alps", status: "sent" });
    await logMessage({ template: "invite.share", channel: "share", to: "link:dolomites", status: "sent" });
    const rows = await listMessages({ limit: 3 });
    expect(rows.map((r) => r.recipientMask).sort()).toEqual(["device", "group link", "group link"]);
    const links = rows.filter((r) => r.recipientMask === "group link").map((r) => r.recipientHash);
    expect(new Set(links).size).toBe(2);
    expect(JSON.stringify(rows)).not.toContain("push.example.test");
  });
});
