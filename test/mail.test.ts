import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { sendMail, sendMailWith } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { buildMessage } from "@/lib/mail/rfc822";

let dir: string;

function writeConfig(mail: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { mail },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mail-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "ana"), { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.MAIL_FROM;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const SAMPLE = {
  preheader: "Three new days",
  title: "Three new days since you last looked",
  blocks: [
    { kind: "paragraph" as const, text: "Here is what happened." },
    { kind: "item" as const, title: "Hoi An", meta: "26 August", href: "https://x.test/a" },
    { kind: "button" as const, text: "Read the trip", href: "https://x.test" },
  ],
  footer: "You are getting this because you asked to follow the trip.",
  unsubscribeUrl: "https://x.test/stop?t=abc",
};

describe("the message format", () => {
  test("is a multipart message with both alternatives", () => {
    const mail = renderMail("reader@example.test", "Subject", SAMPLE);
    const raw = buildMessage(mail, "Fernscout <no-reply@example.test>");
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("text/plain; charset=UTF-8");
    expect(raw).toContain("text/html; charset=UTF-8");
  });

  test("encodes a subject that is not plain ASCII", () => {
    const mail = renderMail("r@example.test", "Grüsse aus Hội An", SAMPLE);
    const raw = buildMessage(mail, "a@b.test");
    expect(raw).toContain("=?UTF-8?B?");
    // The raw header must not carry the unencoded bytes.
    expect(raw.split("\r\n\r\n")[0]).not.toContain("Grüsse");
  });

  test("carries one-click unsubscribe headers when there is a link", () => {
    const mail = renderMail("r@example.test", "S", SAMPLE);
    expect(mail.headers?.["List-Unsubscribe"]).toBe("<https://x.test/stop?t=abc>");
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  test("omits those headers when there is nothing to unsubscribe from", () => {
    const mail = renderMail("r@example.test", "S", { ...SAMPLE, unsubscribeUrl: undefined });
    expect(mail.headers?.["List-Unsubscribe"]).toBeUndefined();
  });
});

describe("the text alternative", () => {
  test("is never empty, and carries every link", () => {
    const mail = renderMail("r@example.test", "S", SAMPLE);
    expect(mail.text.length).toBeGreaterThan(40);
    expect(mail.text).toContain("https://x.test/a");
    expect(mail.text).toContain("https://x.test");
    expect(mail.text).toContain("Hoi An");
  });

  test("holds no HTML tags", () => {
    const mail = renderMail("r@example.test", "S", SAMPLE);
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });
});

describe("escaping", () => {
  test("content cannot break out of the HTML", () => {
    const mail = renderMail("r@example.test", "S", {
      ...SAMPLE,
      title: '</h1><script>alert(1)</script>',
      blocks: [{ kind: "paragraph", text: '<img onerror="x">' }],
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain('<img onerror');
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("transports", () => {
  test("mail off means nothing is sent and nothing throws", async () => {
    writeConfig({ enabled: false, transport: "file" });
    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE));
    expect(result).toBeNull();
  });

  test("the file transport needs no credentials and writes a real .eml", async () => {
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("reader@example.test", "Hello", SAMPLE, "ana"));
    expect(result?.transport).toBe("file");

    const written = fs.readFileSync(result!.reference, "utf8");
    expect(written).toContain("To: reader@example.test");
    expect(written).toContain("Subject: Hello");
    expect(written.startsWith("From:")).toBe(true);
  });

  test("a user's mail is written under that user, not a shared folder", async () => {
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    expect(result!.reference).toContain(path.join("ana", "mail"));
  });

  test("MAIL_FROM sets the sender when it is configured", async () => {
    process.env.MAIL_FROM = "Trip <hello@example.test>";
    writeConfig({ enabled: true, transport: "file" });
    const result = await sendMail(renderMail("r@example.test", "S", SAMPLE, "ana"));
    expect(fs.readFileSync(result!.reference, "utf8")).toContain(
      "From: Trip <hello@example.test>",
    );
  });

  test("the console transport sends nothing anywhere", async () => {
    const result = await sendMailWith("console", renderMail("r@example.test", "S", SAMPLE));
    expect(result.reference).toBe("console");
  });

  /**
   * The wire protocol has its own tests, against a real socket, in
   * `test/smtp.test.ts`. What matters here is the seam: the transport reads
   * its configuration from the environment, and says so when it cannot reach
   * the server rather than failing somewhere unrecognisable.
   */
  test("smtp reports an unreachable server as an unreachable server", async () => {
    writeConfig({ enabled: true, transport: "smtp" });
    process.env.SMTP_HOST = "127.0.0.1";
    // Port 1 is reserved and nothing listens on it.
    process.env.SMTP_PORT = "1";
    process.env.SMTP_USER = "agent@example.test";
    process.env.SMTP_PASSWORD = "unused";
    try {
      await expect(
        sendMailWith("smtp", renderMail("r@example.test", "S", SAMPLE)),
      ).rejects.toThrow(/ECONNREFUSED|connect|timed out/i);
    } finally {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
    }
  });
});
