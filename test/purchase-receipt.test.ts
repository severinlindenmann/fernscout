import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { dictionaryFor } from "@/lib/locales";
import { sendPurchaseReceipt } from "@/lib/credits/receipt";
import type { Payment } from "@/lib/payments";

/**
 * B866 — a purchase settles and the buyer is told what they paid for.
 *
 * The harness is lifted from test/photobook-receipt.test.ts: the file mail
 * transport, one owner, and a `.eml` read back with both base64 alternatives
 * decoded. No database is configured, so `balanceOf` answers null and the
 * balance line is absent — which is itself the case worth having, since an
 * instance with credits switched off must still be able to send this.
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

function writeUserConfig(defaultLocale = "en") {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      startLocation: "Zurich",
      defaultLocale,
      locales: [defaultLocale],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { mail: { enabled: true } },
    }),
  );
}

function mailFiles(): string[] {
  const box = path.join(dir, "mail", OWNER);
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
  const raw = fs.readFileSync(path.join(dir, "mail", OWNER, files[0]), "utf8");
  // Raw headers (for the attachment-disposition check) plus the decoded
  // body (for everything else) — one string a caller can match against.
  return raw + "\n" + decodeMailParts(raw);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-purchase-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  writeServerConfig();
  writeUserConfig();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const PAID: Payment = {
  id: "pay-abc12345",
  owner: OWNER,
  credits: 100,
  amountRappen: 1800,
  status: "paid",
  method: "twint",
  createdAt: "2026-09-05T10:00:00.000Z",
  paidAt: "2026-09-06T11:00:00.000Z",
  requestedAt: "2026-09-05T10:05:00.000Z",
  providerRef: "cs_test_1",
};

async function sendAndRead(payment: Payment = PAID): Promise<string> {
  await sendPurchaseReceipt(payment);
  return readOnlyEml();
}

describe("the purchase receipt", () => {
  test("thanks the buyer and states the amount, the credits and the reference", async () => {
    const eml = await sendAndRead();
    const en = dictionaryFor("en");

    expect(eml).toContain(en["purchase.receipt.title"]);
    expect(eml).toContain("CHF 18.00");
    expect(eml).toContain("100");
    // The reference is what somebody quotes to their accountant, and the date
    // is the day it was paid rather than the day it was raised.
    expect(eml).toContain("pay-abc12345");
    expect(eml).toContain("2026-09-06");
    expect(eml).toContain(en["purchase.receipt.method.twint"]);
  });

  test("claims nothing about tax", async () => {
    const eml = (await sendAndRead()).toLowerCase();
    for (const word of ["vat", "mwst", "tax"]) expect(eml).not.toContain(word);
  });

  test("is written in the owner's language", async () => {
    writeUserConfig("de");
    clearUserCache();
    expect(await sendAndRead()).toContain(dictionaryFor("de")["purchase.receipt.title"]);
  });

  test("a journal with no owner address is sent nothing, and nothing throws", async () => {
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({
        title: "Two Backpacks",
        owner: { name: "Alex B", nickname: "Alex", email: "" },
        startLocation: "Zurich",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        features: { mail: { enabled: true } },
      }),
    );
    clearUserCache();
    await sendPurchaseReceipt(PAID);
    expect(mailFiles()).toEqual([]);
  });
});
