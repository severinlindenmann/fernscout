import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact, unsubscribeContact, manageTokenFor } from "@/lib/contacts";
import { sendDayWhatsapp } from "@/lib/digest/dayWhatsapp";
import { readPublishFlags } from "@/lib/api/publishFlags";
import { maskNumber } from "@/lib/whatsapp";
import { toE164 } from "@/lib/whatsapp/phone";
import type { Locale } from "@/lib/types";

/**
 * B365 — the WhatsApp a published day announces.
 *
 * What these pin, in the order the risk runs: a number is never guessed into
 * existence, consent is its own switch and not the digest's, the two publish
 * flags survive sharing one request body, and `test: true` reaches nobody.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TEMPLATE = "fernscout_day_published";

let dir: string;

function writeServerConfig(whatsapp: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        whatsapp: {
          enabled: true,
          backend: "dry-run",
          templates: { en: TEMPLATE, de: `${TEMPLATE}_de` },
          ...whatsapp,
        },
      },
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
      locales: ["en", "de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true }, whatsapp: { enabled: true } },
    }),
  );
  clearUserCache();
}

function writeTrip(id: string, opts: { visibility?: string; test?: boolean } = {}) {
  const root = path.join(dir, OWNER, "trips", id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "Utah"`,
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      `visibility: "${opts.visibility ?? "public"}"`,
      ...(opts.test ? ["test: true"] : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

async function writePhoto(tripId: string) {
  const mediaDir = path.join(dir, OWNER, "trips", tripId, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3fa9c4" } })
    .jpeg()
    .toFile(path.join(mediaDir, "photo.jpg"));
}

function writeEntry(tripId: string, opts: { test?: boolean; draft?: boolean; photo?: boolean } = {}) {
  const slug = "red-country";
  const entriesDir = path.join(dir, OWNER, "trips", tripId, "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  fs.writeFileSync(
    path.join(entriesDir, `2026-09-02-${slug}.md`),
    [
      "---",
      'title: "Red Country"',
      'date: "2026-09-02"',
      'location: "Moab"',
      'country: "USA"',
      ...(opts.photo
        ? ["gallery:", `  - src: "/media/${tripId}/photo.jpg"`, '    type: "image"']
        : []),
      ...(opts.test ? ["test: true"] : []),
      ...(opts.draft ? ["status: draft"] : []),
      "---",
      "",
      "Sandstone the colour of a struck match.",
      "",
    ].join("\n"),
  );
  return slug;
}

async function addReader(
  email: string,
  opts: { tel?: string; wantsWhatsapp?: boolean; locale?: Locale } = {},
): Promise<string> {
  await requestContact(OWNER, {
    name: `Reader ${email}`,
    email,
    locale: opts.locale ?? "en",
    address: { tel: opts.tel ?? "" },
    wantsEmailDigest: true,
    wantsPostcard: false,
    wantsWhatsapp: opts.wantsWhatsapp ?? true,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  await approveContact(OWNER, confirmed.contact.id);
  return confirmed.contact.id;
}

/** Every payload the dry-run backend wrote, parsed. */
function payloads(): Record<string, unknown>[] {
  const box = path.join(dir, OWNER, "whatsapp");
  if (!fs.existsSync(box)) return [];
  return fs
    .readdirSync(box)
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(box, f), "utf8")) as Record<string, unknown>);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-whatsapp-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
  process.env.SESSION_SECRET = "whatsapp-test-secret-whatsapp-test";
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig();
  writeUserConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a number is never guessed into existence", () => {
  test("international forms all normalise to the same digits", () => {
    for (const raw of ["+41 76 561 31 50", "+41765613150", "0041 76 561 31 50", "41765613150"]) {
      expect(toE164(raw)).toBe("41765613150");
    }
  });

  test("a national number is refused unless a country code is configured", () => {
    // The whole point of lib/whatsapp/phone.ts: `076…` means Switzerland only
    // to somebody standing in Switzerland, and a wrong guess reaches a
    // stranger who happens to hold that number elsewhere.
    expect(toE164("076 561 31 50")).toBeNull();
    expect(toE164("076 561 31 50", "41")).toBe("41765613150");
    expect(toE164("076 561 31 50", "+41")).toBe("41765613150");
  });

  test("rubbish, and numbers outside E.164's bounds, are refused", () => {
    for (const raw of ["", "   ", "not a number", "+41 76 ABC 31 50", "+1234", "+" + "9".repeat(20)]) {
      expect(toE164(raw)).toBeNull();
    }
  });

  test("a number is masked everywhere it could be logged or reported", () => {
    expect(maskNumber("41765613150")).toBe("•••••••3150");
    expect(maskNumber("123")).toBe("•••");
  });
});

describe("consent is its own switch", () => {
  test("ticking WhatsApp without a number stores no consent", async () => {
    const id = await addReader("nonum@example.test", { tel: "", wantsWhatsapp: true });
    const { db } = await getDatabase();
    const row = await db.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    expect(row?.wants_whatsapp).toBe(0);
  });

  test("a national number with no configured country code is not consent either", async () => {
    const id = await addReader("national@example.test", { tel: "076 561 31 50" });
    const { db } = await getDatabase();
    const row = await db.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    expect(row?.wants_whatsapp).toBe(0);
  });

  test("the digest opt-in is not WhatsApp consent", async () => {
    // A reader who only ever agreed to email must not be messaged: this is
    // the property migration 015 exists for.
    await addReader("mailonly@example.test", { tel: "+41765613150", wantsWhatsapp: false });
    writeTrip("utah");
    const slug = writeEntry("utah");
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    expect(payloads()).toHaveLength(0);
  });

  test("unsubscribing from a mail footer stops WhatsApp too", async () => {
    const id = await addReader("bye@example.test", { tel: "+41765613150" });
    expect(await unsubscribeContact(OWNER, manageTokenFor(OWNER, id))).toBe(true);
    const { db } = await getDatabase();
    const row = await db.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    expect(row?.wants_whatsapp).toBe(0);
  });
});

describe("what goes out", () => {
  test("an opted-in reader with a number gets one templated message", async () => {
    await addReader("yes@example.test", { tel: "+41 76 561 31 50" });
    writeTrip("utah");
    await writePhoto("utah");
    const slug = writeEntry("utah", { photo: true });

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);

    const [payload] = payloads();
    expect(payload.to).toBe("41765613150");
    expect(payload.template).toBe(TEMPLATE);
    expect(payload.language).toBe("en");
    // The button carries a path, never an origin: the approved template owns
    // the base URL and Meta appends only this.
    expect(payload.buttonPath).toBe(`${OWNER}/trips/utah/day/${slug}`);
    expect(String(payload.buttonPath).startsWith("/")).toBe(false);
    // The header is a JPEG, because WhatsApp rejects the WebP the site serves.
    expect((payload.photo as Record<string, unknown>).contentType).toBe("image/jpeg");
  });

  test("body parameters never carry a newline, which Meta rejects", async () => {
    await addReader("yes@example.test", { tel: "+41765613150" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    for (const value of payloads()[0].body as string[]) {
      expect(value).not.toMatch(/[\n\t]/);
      expect(value).not.toBe("");
    }
  });

  test("a reader's own locale picks their template, and falls back rather than failing", async () => {
    await addReader("de@example.test", { tel: "+41765613151", locale: "de" });
    await addReader("hu@example.test", { tel: "+41765613152", locale: "hu" });
    writeTrip("utah");
    const slug = writeEntry("utah");

    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    const byNumber = Object.fromEntries(payloads().map((p) => [p.to, p]));
    expect(byNumber["41765613151"].template).toBe(`${TEMPLATE}_de`);
    // No `hu` template is configured, so the journal's own locale answers —
    // the German reader is not silently dropped and neither is this one.
    expect(byNumber["41765613152"].template).toBe(TEMPLATE);
    expect(byNumber["41765613152"].language).toBe("en");
  });

  test("two contacts sharing a household number are messaged once", async () => {
    await addReader("a@example.test", { tel: "+41765613150" });
    await addReader("b@example.test", { tel: "0041 76 561 31 50" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(payloads()).toHaveLength(1);
  });

  test("opted-in readers but no usable template is told apart from having no readers", async () => {
    writeServerConfig({ templates: {} });
    await addReader("yes@example.test", { tel: "+41765613150" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome).toEqual({ ok: false, reason: "no_template" });
  });
});

describe("what never goes out", () => {
  test("a test: true day reaches nobody", async () => {
    await addReader("yes@example.test", { tel: "+41765613150" });
    writeTrip("utah");
    const slug = writeEntry("utah", { test: true });
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome).toEqual({ ok: false, reason: "test_content" });
    expect(payloads()).toHaveLength(0);
  });

  test("a draft reaches nobody", async () => {
    await addReader("yes@example.test", { tel: "+41765613150" });
    writeTrip("utah");
    const slug = writeEntry("utah", { draft: true });
    expect(await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug)).toEqual({
      ok: false,
      reason: "not_published",
    });
  });

  test("the feature switched off sends nothing and says so", async () => {
    writeServerConfig({ enabled: false });
    await addReader("yes@example.test", { tel: "+41765613150" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    expect(await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug)).toEqual({
      ok: false,
      reason: "whatsapp_off",
    });
  });
});

describe("both publish flags survive sharing one request body", () => {
  const bodied = (body: unknown) =>
    new Request("https://t.test/x", { method: "POST", body: JSON.stringify(body) });

  test("each flag is read independently", async () => {
    expect(await readPublishFlags(bodied({ send_mail: true }))).toEqual({
      sendMail: true,
      sendWhatsapp: false,
    });
    expect(await readPublishFlags(bodied({ send_whatsapp: true }))).toEqual({
      sendMail: false,
      sendWhatsapp: true,
    });
  });

  test("both at once, from a body that may only be read once", async () => {
    // The regression this exists for: two helpers each calling
    // `request.json()` would leave the second with a consumed stream and a
    // permanent `false` — indistinguishable from "nobody asked".
    expect(await readPublishFlags(bodied({ send_mail: true, send_whatsapp: true }))).toEqual({
      sendMail: true,
      sendWhatsapp: true,
    });
  });

  test("absent, malformed and non-boolean all mean no", async () => {
    expect(await readPublishFlags(bodied({}))).toEqual({ sendMail: false, sendWhatsapp: false });
    expect(await readPublishFlags(bodied({ send_whatsapp: "yes" }))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
    });
    const broken = new Request("https://t.test/x", { method: "POST", body: "{not json" });
    expect(await readPublishFlags(broken)).toEqual({ sendMail: false, sendWhatsapp: false });
  });
});
