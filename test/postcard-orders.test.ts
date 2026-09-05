import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { issueCode } from "@/lib/auth";
import { balanceOf, grant, ledgerFor } from "@/lib/credits";
import { POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { postcardCandidates } from "@/lib/postcard/contacts";
import { createOrder, getOrder, updateOrderText, ORDER_TTL_MS } from "@/lib/postcard/orders";
import { sendOrder } from "@/lib/postcard/send";
import { makeJpeg } from "./support/exif-jpeg";
import { backToPreview } from "@/lib/postcard/redirectBack";

/**
 * B434 — the properties that cost real money if they are wrong.
 *
 * The rendering is `test/postcard.test.ts`'s and the three consent gates are
 * `test/postcard-contacts.test.ts`'s; neither is repeated here. What is here is
 * only what the *order* adds: that a double press charges once, that a short
 * balance charges nothing, that an agent has no way in, and that somebody who
 * withdrew their address between the preview and the button does not get a
 * card printed for them anyway.
 *
 * The double-press test is the one to read carefully, and — like
 * `test/credits.test.ts` says about its own concurrency leg — it is an
 * accounting test on SQLite rather than a race. `better-sqlite3` serialises on
 * one connection, so a `claimForSend` written as a read followed by a write
 * would still pass here. What it does hold on every dialect is the sequential
 * property: an order that has been sent cannot be sent again, ever, and that
 * is the failure a person would actually hit by pressing twice on a slow phone.
 */

const OWNER = "ana";
const TRIP = "ana/alps-2026";
const DAY = "2026-07-01-over-the-pass";
const KEY = "22".repeat(32);

const ADDRESS = {
  name: "A Reader",
  line1: "Bahnhofstrasse 1",
  line2: "",
  postcode: "8001",
  city: "Zurich",
  country: "Switzerland",
  tel: "",
};

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-postcard-orders-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "orders.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {
        credits: { enabled: true },
        postcards: { enabled: true, provider: "dry-run" },
        contacts: { enabled: true },
        // B467's receipt. `file` writes .eml under content/<user>/mail, which
        // is what the address assertions below read.
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana",
      owner: { name: "Ana A", nickname: "Ana", email: "ana@example.test" },
      // Both are opt-in per journal: the server ceiling above permits them,
      // and this is the journal actually asking for them.
      features: {
        postcards: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true },
      },
    }),
  );

  const media = path.join(dir, OWNER, "trips", "alps-2026", "media");
  fs.mkdirSync(media, { recursive: true });
  // Comfortably under 1819 × 1312, so every render here also exercises the
  // low-resolution warning rather than pretending photographs are always big.
  fs.writeFileSync(path.join(media, "pass.jpg"), await makeJpeg(1, 640, 480));

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function reader(email: string, wantsPostcard = true, address: unknown = ADDRESS) {
  const { contactId } = await requestContact(OWNER, {
    name: "A Reader",
    email,
    locale: "en",
    address: address as never,
    wantsEmailDigest: false,
    wantsPostcard,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirm failed");
  const approved = await approveContact(OWNER, contactId!);
  if (!approved || approved.status !== "active") throw new Error("approve failed");
  return contactId!;
}

async function order(recipients: string[]) {
  const made = await createOrder(OWNER, {
    trip: TRIP,
    day: DAY,
    photo: "pass.jpg",
    message: "Over the pass in the rain. Worth it.",
    from: "Ana",
    recipients,
    locale: "en",
    provider: "dry-run",
  });
  if (!made) throw new Error("no order");
  return made;
}

describe("sending an order", () => {
  test("a second send charges nothing and prints nothing", async () => {
    const contact = await reader("one@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);

    const first = await sendOrder(OWNER, made.id);
    expect(first).toMatchObject({ ok: true, sent: 1, failed: 0, charged: POSTCARD_CREDITS });
    expect(await balanceOf(OWNER)).toBe(100 - POSTCARD_CREDITS);

    const second = await sendOrder(OWNER, made.id);
    expect(second).toEqual({ ok: false, reason: "already_sent" });
    // The whole point: the balance did not move a second time.
    expect(await balanceOf(OWNER)).toBe(100 - POSTCARD_CREDITS);
    expect((await ledgerFor(OWNER)).filter((row) => row.reason === "postcard")).toHaveLength(1);
  });

  test("a balance one credit short sends nothing, charges nothing, and stays sendable", async () => {
    const a = await reader("a@example.test");
    const b = await reader("b@example.test");
    await grant(OWNER, POSTCARD_CREDITS * 2 - 1);
    const made = await order([a, b]);

    const outcome = await sendOrder(OWNER, made.id);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "no_credits",
      needed: POSTCARD_CREDITS * 2,
    });
    expect(await balanceOf(OWNER)).toBe(POSTCARD_CREDITS * 2 - 1);
    expect(fs.existsSync(path.join(dir, OWNER, "postcards", made.id))).toBe(false);

    // Released, not stranded: buying credits and pressing again must work.
    expect((await getOrder(OWNER, made.id))?.status).toBe("draft");
    await grant(OWNER, 1);
    expect(await sendOrder(OWNER, made.id)).toMatchObject({ ok: true, sent: 2 });
  });

  test("somebody who withdrew their consent is skipped and not charged for", async () => {
    const staying = await reader("stay@example.test");
    const leaving = await reader("go@example.test");
    await grant(OWNER, 100);
    const made = await order([staying, leaving]);

    // They change their mind between the preview and the button.
    await requestContact(OWNER, {
      name: "A Reader",
      email: "go@example.test",
      locale: "en",
      address: ADDRESS as never,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "owner",
    });

    const outcome = await sendOrder(OWNER, made.id);
    expect(outcome).toMatchObject({ ok: true, sent: 1, skipped: 1, charged: POSTCARD_CREDITS });
    expect(await balanceOf(OWNER)).toBe(100 - POSTCARD_CREDITS);
  });

  test("an order nobody is left to receive is refused before anything is claimed", async () => {
    const contact = await reader("gone@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    await requestContact(OWNER, {
      name: "A Reader",
      email: "gone@example.test",
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "owner",
    });

    expect(await sendOrder(OWNER, made.id)).toEqual({ ok: false, reason: "no_recipients" });
    expect((await getOrder(OWNER, made.id))?.status).toBe("draft");
    expect(await balanceOf(OWNER)).toBe(100);
  });

  test("an expired order refuses, whatever the balance", async () => {
    const contact = await reader("late@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);

    const handle = await getDatabase();
    await handle.db
      .updateTable("print_orders")
      .set({
        payload: JSON.stringify({
          ...made.payload,
          expiresAt: new Date(Date.now() - ORDER_TTL_MS).toISOString(),
        }),
      })
      .where("id", "=", made.id)
      .execute();

    expect(await sendOrder(OWNER, made.id)).toEqual({ ok: false, reason: "expired" });
    expect(await balanceOf(OWNER)).toBe(100);
  });

  test("one journal cannot send another journal's order", async () => {
    const contact = await reader("mine@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    expect(await sendOrder("someone-else", made.id)).toMatchObject({ ok: false });
    expect((await getOrder(OWNER, made.id))?.status).toBe("draft");
  });

  test("the price is the order's own, not whatever the constant says later", async () => {
    const contact = await reader("priced@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    expect(made.payload.creditsEach).toBe(POSTCARD_CREDITS);
    // Frozen into the row, so a price change tomorrow cannot charge somebody
    // something other than the number their preview quoted.
    expect((await getOrder(OWNER, made.id))?.payload.creditsEach).toBe(POSTCARD_CREDITS);
  });
});

describe("correcting the words before it goes", () => {
  test("the message, the signature and the language are editable while it is a draft", async () => {
    const contact = await reader("edit@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);

    expect(
      await updateOrderText(OWNER, made.id, {
        message: "Corrected.",
        from: "Ana & Bo",
        locale: "de",
      }),
    ).toBe(true);

    const again = await getOrder(OWNER, made.id);
    expect(again?.payload).toMatchObject({
      message: "Corrected.",
      from: "Ana & Bo",
      locale: "de",
    });
    // The words changed and nothing else did — not the people, not the price.
    expect(again?.payload.recipients).toEqual(made.payload.recipients);
    expect(again?.payload.creditsEach).toBe(made.payload.creditsEach);
  });

  test("a card that has gone cannot be reworded", async () => {
    const contact = await reader("sent@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    await sendOrder(OWNER, made.id);

    expect(
      await updateOrderText(OWNER, made.id, { message: "Too late.", from: "X", locale: "en" }),
    ).toBe(false);
    expect((await getOrder(OWNER, made.id))?.payload.message).toBe(made.payload.message);
  });

  test("one journal cannot reword another's order", async () => {
    const contact = await reader("mine2@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    expect(
      await updateOrderText("someone-else", made.id, {
        message: "Not yours.",
        from: "X",
        locale: "en",
      }),
    ).toBe(false);
    expect((await getOrder(OWNER, made.id))?.payload.message).toBe(made.payload.message);
  });
});

describe("what an agent may learn", () => {
  test("the recipient list carries a town and never a street", async () => {
    await reader("street@example.test");
    const candidates = await postcardCandidates(OWNER);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      city: "Zurich",
      country: "Switzerland",
      // A language is not an address, and it is what lets an agent ask
      // whether a card should be written in German — B452.
      locale: "en",
    });
    expect(JSON.stringify(candidates)).not.toContain("Bahnhofstrasse");
    expect(JSON.stringify(candidates)).not.toContain("8001");
  });

  test("no route under app/api can send an order", () => {
    // The enforcement is structural — the only caller of `sendOrder` is the
    // owner's own page route — so this is the assertion that keeps it that
    // way. `lib/credits.ts`'s own test does the same for `grant`.
    const hits: string[] = [];
    const walk = (root: string) => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("sendOrder")) {
          hits.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "app", "api"));
    expect(hits).toEqual([]);
  });
});


/**
 * B460 — the redirect that made both forms unusable.
 *
 * `form-action 'self'` is checked against every hop of a form submission, and
 * these routes were answering with `https://localhost:3000/…` because they
 * built the URL from `request.url`, which behind a reverse proxy is the app's
 * own origin. The browser blocked it and the send button had never once
 * worked. Nothing caught it: the suite renders markup and asserts on strings,
 * and there is no browser in it anywhere.
 *
 * This is the cheap assertion that would have.
 */
describe("coming back from a form", () => {
  test("the location is relative, naming no host and no scheme", () => {
    const location = backToPreview("ana", "abc123", "sent").headers.get("location")!;
    expect(location).toBe("/ana/postcards/abc123?result=sent");
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toContain("://");
    expect(location).not.toContain("localhost");
  });

  test("it is a 303, so a reload is not a second send", () => {
    expect(backToPreview("ana", "abc", "sent").status).toBe(303);
  });

  test("a username or id with a slash in it cannot escape the path", () => {
    const location = backToPreview("ana/../bob", "a b", "x").headers.get("location")!;
    expect(location).toBe("/ana%2F..%2Fbob/postcards/a%20b?result=x");
  });

  test("neither form route builds an absolute redirect", () => {
    // The shape of the bug, not its symptom: `Response.redirect` demands an
    // absolute URL, which is what led to building one from `request.url`.
    for (const file of [
      "app/[user]/postcards/[id]/send/route.ts",
      "app/[user]/postcards/[id]/message/route.ts",
    ]) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src).not.toContain("Response.redirect");
      expect(src).not.toContain("request.url");
    }
  });
});


/**
 * B467 — the receipt, and the one thing it must never carry.
 *
 * `lib/contacts/mail.ts` states the rule for its own five letters: no mail
 * this project sends contains a postal address. A receipt naming who got a
 * card is exactly the letter most tempting to put one in, so the assertion is
 * made against a contact whose street this test knows by name.
 */
describe("the receipt for a send", () => {
  function mailFiles(): string[] {
    const dir = path.join(dir_(), OWNER, "mail");
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith(".eml"));
    } catch {
      return [];
    }
  }
  function dir_(): string {
    return process.env.CONTENT_DIR!;
  }

  test("names the person, attaches the card, and carries no address", async () => {
    const contact = await reader("receipt@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    expect(await sendOrder(OWNER, made.id)).toMatchObject({ ok: true, sent: 1 });

    const files = mailFiles();
    expect(files.length).toBeGreaterThan(0);
    const raw = files.map((f) => fs.readFileSync(path.join(dir_(), OWNER, "mail", f), "utf8")).join("\n");

    // **The address is the thing the message must not become** — and the
    // scope of that claim matters. The attached PDF is the card as printed,
    // and the back of a postcard carries the address by necessity; that is the
    // documented exception in `lib/postcard/receipt.ts`. What must be clean is
    // everything a mail client shows without opening the attachment, so the
    // PDF part is excluded and the rest is decoded from base64.
    const readable = raw
      .split(/--fs-[a-z0-9-]+/)
      .filter((part) => !part.includes("application/pdf"))
      .map((part) => {
        const body = part.split(/\r?\n\r?\n/).slice(1).join("\n");
        let decoded = "";
        try {
          decoded = Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
        } catch {
          decoded = "";
        }
        return `${part}\n${decoded}`;
      })
      .join("\n");

    expect(readable).toContain("A Reader");
    for (const secret of ["Bahnhofstrasse", "8001"]) {
      expect(readable).not.toContain(secret);
    }

    // The card itself rides along, as a saved file rather than part of the
    // message — which is why lib/mail/rfc822.ts learned multipart/mixed.
    expect(raw).toContain("application/pdf");
    expect(raw).toContain("Content-Disposition: attachment");
    expect(raw).toContain("multipart/mixed");
  });

  test("the receipt is free — no credit moves for it", async () => {
    const contact = await reader("free@example.test");
    await grant(OWNER, 100);
    const made = await order([contact]);
    await sendOrder(OWNER, made.id);

    // Exactly the card, and nothing for the letter about it.
    expect(await balanceOf(OWNER)).toBe(100 - POSTCARD_CREDITS);
    const spends = (await ledgerFor(OWNER)).filter((r) => r.delta < 0);
    expect(spends).toHaveLength(1);
  });
});


/**
 * B474 — a page that told the owner the opposite of what had happened.
 *
 * The heading and the line under it were written once and rendered whatever
 * state the order was in, so an order already at the printer read "ready to
 * send" above "nothing has been printed or charged yet" — directly above the
 * banner saying it had been. These assert the strings the page picks between,
 * which is where the mistake was; the page itself is a server component
 * needing a request context, and there is no browser in this suite.
 */
describe("what a sent order says about itself", () => {
  test("the two states have different words, in every locale", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const loc of ["en", "de", "hu"]) {
      const d = dictionaryFor(loc);
      expect(d["postcard.page.title"]).toBeTruthy();
      expect(d["postcard.page.titleSent"]).toBeTruthy();
      expect(d["postcard.page.title"]).not.toBe(d["postcard.page.titleSent"]);
      // The claim that cost the trust: it must appear only in the waiting one.
      expect(d["postcard.page.introSent"]).not.toBe(d["postcard.page.intro"]);
    }
  });

  test("the sent line never promises nothing was charged", () => {
    // Written against the English so the assertion is legible; the German was
    // the one a person actually read wrong.
    const en = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "content/locales/en.json"), "utf8"),
    ) as Record<string, string>;
    expect(en["postcard.page.intro"]).toContain("Nothing has been printed");
    expect(en["postcard.page.introSent"]).not.toContain("Nothing has been printed");
    expect(en["postcard.page.introSent"]).toContain("Sent");
  });
});
