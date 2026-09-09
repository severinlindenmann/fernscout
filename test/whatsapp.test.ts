import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode } from "@/lib/auth";
import { balanceOf, grant } from "@/lib/credits";
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

function writeServerConfig(
  whatsapp: Record<string, unknown> = {},
  opts: { credits?: boolean } = {},
) {
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
        ...(opts.credits !== undefined ? { credits: { enabled: opts.credits } } : {}),
      },
    }),
  );
  clearConfigCache();
}

/** Turns on B366's billing switch for one test — `test/credits.test.ts`
 * already pins the "off" behaviour, so this file only has to prove that "on"
 * is wired to `sendDayWhatsapp`. */
function enableCredits() {
  writeServerConfig({}, { credits: true });
}

/** `tel` is `owner.tel` — absent unless a test is about it, which is every
 * journal written before B614. */
function writeUserConfig(owner: { tel?: string } = {}) {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL, ...owner },
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
    for (const raw of ["+41 76 000 00 00", "+41760000000", "0041 76 000 00 00", "41760000000"]) {
      expect(toE164(raw)).toBe("41760000000");
    }
  });

  test("a national number is refused unless a country code is configured", () => {
    // The whole point of lib/whatsapp/phone.ts: `076…` means Switzerland only
    // to somebody standing in Switzerland, and a wrong guess reaches a
    // stranger who happens to hold that number elsewhere.
    expect(toE164("076 000 00 00")).toBeNull();
    expect(toE164("076 000 00 00", "41")).toBe("41760000000");
    expect(toE164("076 000 00 00", "+41")).toBe("41760000000");
  });

  test("rubbish, and numbers outside E.164's bounds, are refused", () => {
    for (const raw of ["", "   ", "not a number", "+41 76 ABC 00 00", "+1234", "+" + "9".repeat(20)]) {
      expect(toE164(raw)).toBeNull();
    }
  });

  test("a number is masked everywhere it could be logged or reported", () => {
    expect(maskNumber("41760000000")).toBe("•••••••0000");
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
    const id = await addReader("national@example.test", { tel: "076 000 00 00" });
    const { db } = await getDatabase();
    const row = await db.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    expect(row?.wants_whatsapp).toBe(0);
  });

  test("the digest opt-in is not WhatsApp consent", async () => {
    // A reader who only ever agreed to email must not be messaged: this is
    // the property migration 015 exists for.
    await addReader("mailonly@example.test", { tel: "+41760000000", wantsWhatsapp: false });
    writeTrip("utah");
    const slug = writeEntry("utah");
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    expect(payloads()).toHaveLength(0);
  });

  test("unsubscribing from a mail footer stops WhatsApp too", async () => {
    const id = await addReader("bye@example.test", { tel: "+41760000000" });
    expect(await unsubscribeContact(OWNER, manageTokenFor(OWNER, id))).toBe(true);
    const { db } = await getDatabase();
    const row = await db.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    expect(row?.wants_whatsapp).toBe(0);
  });
});

describe("what goes out", () => {
  test("an opted-in reader with a number gets one templated message", async () => {
    await addReader("yes@example.test", { tel: "+41 76 000 00 00" });
    writeTrip("utah");
    await writePhoto("utah");
    const slug = writeEntry("utah", { photo: true });

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);

    const [payload] = payloads();
    expect(payload.to).toBe("41760000000");
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
    await addReader("yes@example.test", { tel: "+41760000000" });
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
    await addReader("a@example.test", { tel: "+41760000000" });
    await addReader("b@example.test", { tel: "0041 76 000 00 00" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(payloads()).toHaveLength(1);
  });

  test("opted-in readers but no usable template is told apart from having no readers", async () => {
    writeServerConfig({ templates: {} });
    await addReader("yes@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome).toEqual({ ok: false, reason: "no_template" });
  });
});

/**
 * B386 — a way out of the messages from inside WhatsApp itself.
 *
 * `manageLink` is an opt-in on the *configured* template, never the default,
 * because sending a fourth body variable to a template Meta approved with
 * three would fail every send in that language. So the property to pin is
 * two-sided: off by default (today's config, unmodified, still sends three),
 * and — once a person has approved a new template version and flipped it —
 * a working, per-recipient unsubscribe reaches the message.
 */
describe("a way to stop the messages — B386", () => {
  test("an ordinary template — manageLink absent — still sends exactly three body parameters", async () => {
    const contactId = await addReader("yes@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);

    expect(payloads()[0].body).toHaveLength(3);
    const manageToken = manageTokenFor(OWNER, contactId);
    expect(JSON.stringify(payloads()[0])).not.toContain(manageToken);
  });

  test("a template configured with manageLink: true gets a fourth parameter — the contact's own manage URL", async () => {
    writeServerConfig({ templates: { en: { name: TEMPLATE, manageLink: true } } });
    const contactId = await addReader("yes@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);

    const body = payloads()[0].body as string[];
    expect(body).toHaveLength(4);
    const manageToken = manageTokenFor(OWNER, contactId);
    expect(body[3]).toContain(manageToken);
    expect(body[3]).toContain(`/${OWNER}/c/`);
  });

  test("the owner's own free copy — no contact row — is pointed at their own account page instead", async () => {
    writeServerConfig({ templates: { en: { name: TEMPLATE, manageLink: true } } });
    writeUserConfig({ tel: "+41765613199" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);

    const body = payloads()[0].body as string[];
    expect(body[3]).toBe(`https://example.test/${OWNER}/me`);
  });
});

describe("what never goes out", () => {
  test("a test: true day reaches nobody", async () => {
    await addReader("yes@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah", { test: true });
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome).toEqual({ ok: false, reason: "test_content" });
    expect(payloads()).toHaveLength(0);
  });

  test("a draft reaches nobody", async () => {
    await addReader("yes@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah", { draft: true });
    expect(await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug)).toEqual({
      ok: false,
      reason: "not_published",
    });
  });

  test("the feature switched off sends nothing and says so", async () => {
    writeServerConfig({ enabled: false });
    await addReader("yes@example.test", { tel: "+41760000000" });
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
      ignored: [],
      declined: [],
    });
    expect(await readPublishFlags(bodied({ send_whatsapp: true }))).toEqual({
      sendMail: false,
      sendWhatsapp: true,
      ignored: [],
      declined: [],
    });
  });

  test("both at once, from a body that may only be read once", async () => {
    // The regression this exists for: two helpers each calling
    // `request.json()` would leave the second with a consumed stream and a
    // permanent `false` — indistinguishable from "nobody asked".
    expect(await readPublishFlags(bodied({ send_mail: true, send_whatsapp: true }))).toEqual({
      sendMail: true,
      sendWhatsapp: true,
      ignored: [],
      declined: [],
    });
  });

  test("absent and false both mean no, silently", async () => {
    expect(await readPublishFlags(bodied({}))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: [],
      declined: [],
    });
    expect(await readPublishFlags(bodied({ send_mail: false, send_whatsapp: false }))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: [],
      declined: [],
    });
    const broken = new Request("https://t.test/x", { method: "POST", body: "{not json" });
    expect(await readPublishFlags(broken)).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: [],
      declined: [],
    });
  });

  // B400: a non-boolean value still reads as `false` (the strict `=== true`
  // is unchanged) but is no longer indistinguishable from absence — it is
  // named in `ignored` so the route can report it.
  test("present but non-boolean reads as false, and is named as ignored", async () => {
    expect(await readPublishFlags(bodied({ send_whatsapp: "yes" }))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: ["send_whatsapp"],
      declined: [],
    });
    expect(await readPublishFlags(bodied({ send_mail: "true" }))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: ["send_mail"],
      declined: [],
    });
    expect(await readPublishFlags(bodied({ send_mail: 1 }))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: ["send_mail"],
      declined: [],
    });
    expect(await readPublishFlags(bodied({ send_mail: "true", send_whatsapp: 0 }))).toEqual({
      sendMail: false,
      sendWhatsapp: false,
      ignored: ["send_mail", "send_whatsapp"],
      declined: [],
    });
  });
});

/**
 * B614 — the owner is reachable on this channel at all, and free.
 *
 * `recipientsFor` here used to add nobody: there was no `owner.tel`, and
 * inventing one would have been this codebase deciding somebody's phone
 * number belongs to it. So the one person who could not get the WhatsApp
 * notification was the person publishing the day — who is also the one person
 * who would use it to check the channel works before a guest ever sees it.
 * The number now exists as a field the owner writes themselves, and its
 * presence is the consent.
 */
describe("the owner's own message — B614", () => {
  const OWNER_TEL = "+41 76 555 00 99";

  test("no owner.tel means no owner message, which is every journal before this", async () => {
    writeTrip("utah");
    const slug = writeEntry("utah");
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    expect(payloads()).toHaveLength(0);
  });

  test("owner.tel is messaged, and it costs nothing", async () => {
    enableCredits();
    writeUserConfig({ tel: OWNER_TEL });
    writeTrip("utah");
    const slug = writeEntry("utah");
    // No `grant`: there is not even a credits row, which is the state a new
    // journal is in. A free send has to work from there.

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toHaveLength(1);
    expect(payloads()[0].to).toBe("41765550099");
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("a guest is charged and the owner is not", async () => {
    enableCredits();
    writeUserConfig({ tel: OWNER_TEL });
    await addReader("guest@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await grant(OWNER, 1);

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toHaveLength(2);
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("a contact on the owner's own number is one free message, not two", async () => {
    enableCredits();
    writeUserConfig({ tel: OWNER_TEL });
    // The owner in their own guestbook, or a household phone.
    await addReader("also-me@example.test", { tel: "0041 76 555 00 99" });
    writeTrip("utah");
    const slug = writeEntry("utah");

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toHaveLength(1);
    expect(payloads()).toHaveLength(1);
    // Charged nothing, on an empty balance: the contact folded into the
    // owner's free copy rather than becoming a second, paid recipient.
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("the owner's own message failing refunds nothing", async () => {
    enableCredits();
    writeUserConfig({ tel: OWNER_TEL });
    await addReader("guest@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await grant(OWNER, 1);

    const real = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (typeof file === "string" && file.includes("0099")) {
        throw new Error("simulated delivery failure");
      }
      return real(file, data, options);
    });

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.sent).toHaveLength(1);
    // The credit paid for the guest, whose message went out. Refunding the
    // owner's failure would mint one rather than return it.
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("the owner's own contact row is free too, with no owner.tel at all", async () => {
    // B619: the number most naturally lives on the owner's own contact row,
    // beside the postal address a postcard to themselves needs. Freeness is
    // therefore decided by who this is, not by which field the number came
    // out of — otherwise an owner who filled the form in would start paying
    // for their own message.
    enableCredits();
    await addReader(OWNER_EMAIL, { tel: "+41765550099" });
    await addReader("guest@example.test", { tel: "+41760000000" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    await grant(OWNER, 1);

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toHaveLength(2);
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("a national number in owner.tel is a config problem, not a guess", async () => {
    writeUserConfig({ tel: "076 555 00 99" });
    writeTrip("utah");
    const slug = writeEntry("utah");
    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/utah`, slug);
    // Loud, like every other bad value in this file: `parseOwner` refuses the
    // number and the journal does not load, so there is nothing to send a day
    // about — rather than a message quietly going to a number in whichever
    // country the server happens to be standing in. The refusal's own wording
    // is pinned in test/owner-tel.test.ts, and `PATCH .../config` never lets
    // a number like this reach the file in the first place.
    expect(outcome).toEqual({ ok: false, reason: "unknown_trip" });
    expect(payloads()).toHaveLength(0);
  });
});

describe("credits — B366", () => {
  test("an insufficient balance refuses the whole send, and nothing goes out", async () => {
    enableCredits();
    await addReader("one@example.test", { tel: "+41765550001" });
    await addReader("two@example.test", { tel: "+41765550002" });
    await addReader("three@example.test", { tel: "+41765550003" });
    writeTrip("billed");
    const slug = writeEntry("billed");
    // 3 needed, only 2 granted.
    await grant(OWNER, 2);

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/billed`, slug);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no_credits");
    expect(outcome.needed).toBe(3);
    expect(outcome.balance).toBe(2);
    expect(payloads()).toHaveLength(0);
    expect(await balanceOf(OWNER)).toBe(2);
  });

  test("exactly enough credits sends everything and leaves the balance at zero", async () => {
    enableCredits();
    await addReader("one@example.test", { tel: "+41765550001" });
    await addReader("two@example.test", { tel: "+41765550002" });
    writeTrip("paid");
    const slug = writeEntry("paid");
    await grant(OWNER, 2);

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/paid`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toHaveLength(2);
    expect(outcome.failed).toHaveLength(0);
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("a recipient whose send fails is refunded — never a blanket reversal", async () => {
    enableCredits();
    await addReader("bad@example.test", { tel: "+41765550001" });
    await addReader("good@example.test", { tel: "+41765550002" });
    writeTrip("flaky-credits");
    const slug = writeEntry("flaky-credits");
    await grant(OWNER, 2);

    const real = fs.writeFileSync.bind(fs);
    let thrown = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (!thrown && typeof file === "string" && file.includes("0001")) {
        thrown = true;
        throw new Error("simulated delivery failure");
      }
      return real(file, data, options);
    });

    const outcome = await sendDayWhatsapp(OWNER, `${OWNER}/flaky-credits`, slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failed).toHaveLength(1);
    // 2 spent up front, 1 refunded for the one that did not go out.
    expect(await balanceOf(OWNER)).toBe(1);
  });
});
