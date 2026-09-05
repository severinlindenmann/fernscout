import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { sendPhotobookReceipt } from "@/lib/photobook/receipt";

/**
 * The mail harness here is copied from test/day-mail.test.ts (writeServerConfig,
 * writeUserConfig, mailFiles/emlFor): it is the smallest fixture that points
 * MAIL_TRANSPORT at the file backend and reads a `.eml` back for one owner
 * without pulling in trip or entry fixtures the receipt never touches.
 * The brief's own pointer, test/postcard-receipt.test.ts, does not exist.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";

let dir: string;

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { mail: { enabled: true, transport: "file" } },
    }),
  );
  clearConfigCache();
}

function writeUserConfig() {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { mail: { enabled: true } },
    }),
  );
}

function mailFiles(): string[] {
  const box = path.join(dir, OWNER, "mail");
  return fs.existsSync(box) ? fs.readdirSync(box).sort() : [];
}

/** Every base64 MIME part in a raw `.eml`, decoded and concatenated — the
 * text and HTML alternatives are both base64 (lib/mail/rfc822.ts), so a plain
 * `.toContain` against the raw file never finds a filename or a link. */
function decodeMailParts(raw: string): string {
  const part = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n--/g;
  let decoded = "";
  for (const match of raw.matchAll(part)) {
    decoded += Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8") + "\n";
  }
  return decoded;
}

function readOnlyEml(): string {
  const files = mailFiles();
  if (files.length !== 1) throw new Error(`expected exactly one .eml, found: ${files.join(", ")}`);
  const raw = fs.readFileSync(path.join(dir, OWNER, "mail", files[0]), "utf8");
  // Raw headers (for the attachment-disposition check) plus the decoded
  // body (for everything else) — one string a caller can match against.
  return raw + "\n" + decodeMailParts(raw);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-mail-"));
  process.env.CONTENT_DIR = dir;
  writeServerConfig();
  writeUserConfig();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function sendAndRead(input: {
  owner: string;
  orderId: string;
  tripTitle: string;
  pages: number;
  volumes: number;
  creditsSpent: number;
  balance: number | null;
  files: string[];
}): Promise<string> {
  await sendPhotobookReceipt(input);
  return readOnlyEml();
}

describe("the photobook receipt", () => {
  test("links to both files and never claims anything was printed", async () => {
    const eml = await sendAndRead({
      owner: "alex",
      orderId: "order-abc12345",
      tripTitle: "Asia 2026",
      pages: 52,
      volumes: 1,
      creditsSpent: 194,
      balance: 306,
      files: ["book-interior.pdf", "book-cover.pdf"],
    });

    expect(eml).toContain("book-interior.pdf");
    expect(eml).toContain("book-cover.pdf");
    expect(eml).toContain("/alex/photobooks/order-abc12345/");
    expect(eml).toContain("194");
    // Links, never the file: a 300-DPI book does not fit in a mailbox.
    expect(eml).not.toContain("Content-Disposition: attachment");
    // The words a reader must not find, because no provider was called.
    expect(eml.toLowerCase()).not.toMatch(/\bposted\b|\bshipped\b/);
  });
});
