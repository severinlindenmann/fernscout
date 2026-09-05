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
import { createOrder, getOrder, ORDER_TTL_MS } from "@/lib/postcard/orders";
import { sendOrder } from "@/lib/postcard/send";
import { makeJpeg } from "./support/exif-jpeg";

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
      features: { postcards: { enabled: true }, contacts: { enabled: true } },
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

describe("what an agent may learn", () => {
  test("the recipient list carries a town and never a street", async () => {
    await reader("street@example.test");
    const candidates = await postcardCandidates(OWNER);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ city: "Zurich", country: "Switzerland" });
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
