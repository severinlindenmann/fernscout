import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { dictionaryFor } from "@/lib/locales";
import { sendPhotobookReceipt, sendPhotobookRefused } from "@/lib/photobook/receipt";

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-mail-"));
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

async function sendAndRead(input: {
  owner: string;
  orderId: string;
  tripTitle: string;
  pages: number;
  volumes: number;
  creditsSpent: number;
  balance: number | null;
  files: string[];
  size?: string;
  cover?: string;
}): Promise<string> {
  // B1227. The mail names what was bought; these fixtures are about what it
  // says regarding files and printing, so the two facts get a default rather
  // than being spelled out in every case.
  await sendPhotobookReceipt({
    size: "Square 200 x 200 mm",
    cover: "Softcover",
    ...input,
  });
  return readOnlyEml();
}

describe("the photobook receipt", () => {
  test("offers only the whole-book file, links to the order page, and never claims anything was printed", async () => {
    const eml = await sendAndRead({
      owner: "alex",
      orderId: "order-abc12345",
      tripTitle: "Asia 2026",
      pages: 52,
      volumes: 1,
      creditsSpent: 194,
      balance: 306,
      files: ["book-interior.pdf", "book-cover.pdf", "book.pdf"],
    });

    // B1438: the interior and cover halves are Gelato's inputs, not
    // anybody's book — filtered out here exactly as `visibleBookFiles`
    // filters them off the order page, so the two never disagree.
    expect(eml).not.toContain("book-interior.pdf");
    expect(eml).not.toContain("book-cover.pdf");
    expect(eml).toContain("book.pdf");
    expect(eml).toContain("/alex/photobooks/order-abc12345/");
    // The order page itself, not only a file under it — labelled for what it
    // does, not "click here".
    expect(eml).toContain("See this order");
    expect(eml).toContain("194");
    // "Ready" is a claim about a finished, delivered object; this only ever
    // follows a successful submission to Gelato, which can still be refused.
    expect(eml).not.toContain("your photobook is ready");
    expect(eml).toContain("on the way");
    // Links, never the file: a 300-DPI book does not fit in a mailbox.
    expect(eml).not.toContain("Content-Disposition: attachment");
  });

  test("offers one file per volume for a multi-volume book", async () => {
    const eml = await sendAndRead({
      owner: "alex",
      orderId: "order-abc12345",
      tripTitle: "Asia 2026",
      pages: 104,
      volumes: 2,
      creditsSpent: 300,
      balance: 100,
      files: ["v1-interior.pdf", "v1-cover.pdf", "v1.pdf", "v2-interior.pdf", "v2-cover.pdf", "v2.pdf"],
    });

    expect(eml).not.toContain("v1-interior.pdf");
    expect(eml).not.toContain("v1-cover.pdf");
    expect(eml).not.toContain("v2-interior.pdf");
    expect(eml).not.toContain("v2-cover.pdf");
    expect(eml).toContain("v1.pdf");
    expect(eml).toContain("v2.pdf");
  });

  // B479 — the claim worth protecting is "no provider was called", and the
  // thing that carries it in every language is the `notPrinted` key, not the
  // absence of the English word "posted". Banning the word failed the honest
  // English sentence ("nothing has been posted", a negation) and would have
  // waved through a German or Hungarian receipt that claimed the opposite,
  // since the fixture below only ever exercised `en`. Asserting on the
  // rendered `notPrinted` text, in each locale the mail can go out in, checks
  // the actual claim and reads correctly through a negation.
  test.each(["en", "de", "hu"] as const)(
    "carries the 'nothing was printed or sent' statement in %s",
    async (locale) => {
      writeUserConfig(locale);
      clearUserCache();
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

      expect(eml).toContain(dictionaryFor(locale)["photobook.receipt.notPrinted"]);
    },
  );
});

describe("the photobook refusal mail", () => {
  test("keeps the quotable reference and links to the order page", async () => {
    await sendPhotobookRefused({
      owner: "alex",
      orderId: "order-abc12345",
      tripTitle: "Asia 2026",
      creditsRefunded: 194,
    });
    const eml = readOnlyEml();

    // A reference is what somebody reads out on the phone in a reply — the
    // link does not replace it.
    expect(eml).toContain("order-abc12345");
    expect(eml).toContain("/alex/photobooks/order-abc12345");
    expect(eml).toContain("See how the printing is going");
  });
});
