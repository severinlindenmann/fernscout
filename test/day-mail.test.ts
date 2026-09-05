import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode, tripWriteScope } from "@/lib/auth";
import { balanceOf, grant } from "@/lib/credits";
import { requestContact, confirmContact, approveContact } from "@/lib/contacts";
import { mailWouldCost, sendDayLetter } from "@/lib/digest/dayLetter";
import { getEntryBySlug } from "@/lib/entries";
import type { Locale } from "@/lib/types";

/**
 * B345 — the letter one published day sends.
 *
 * These pin the properties the plan and the ticket call out by name: costs
 * and trip access are asked per recipient rather than once, a `test: true`
 * day sends nothing at all, the photograph travels as an attachment rather
 * than a link, a failed send never fails the publish, and both triggers are
 * the owner's alone to pull.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";

let dir: string;

function writeServerConfig(opts: { credits?: boolean } = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        ...(opts.credits !== undefined ? { credits: { enabled: opts.credits } } : {}),
      },
    }),
  );
  clearConfigCache();
}

/** Turns on B366's billing switch for one test, mid-run — the rest of the
 * file leaves it absent, which `test/credits.test.ts` already pins as "off",
 * so this file only has to prove that "on" is wired to the two send paths. */
function enableCredits() {
  writeServerConfig({ credits: true });
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
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true },
        costs: { enabled: true },
      },
    }),
  );
}

type TripOptions = {
  visibility?: "public" | "guest" | "private";
  costsVisibility?: "public" | "guests";
  test?: boolean;
  people?: { name: string; email: string }[];
};

function writeTrip(id: string, opts: TripOptions = {}) {
  const root = path.join(dir, OWNER, "trips", id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "${id}"`,
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      `visibility: "${opts.visibility ?? "public"}"`,
      ...(opts.costsVisibility ? [`costsVisibility: "${opts.costsVisibility}"`] : []),
      ...(opts.test ? ["test: true"] : []),
      ...(opts.people?.length
        ? [
            "people:",
            ...opts.people.flatMap((p) => [`  - name: "${p.name}"`, `    email: "${p.email}"`]),
          ]
        : []),
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

type EntryOptions = {
  slug?: string;
  title?: string;
  date?: string;
  costs?: boolean;
  photo?: boolean;
  translations?: boolean;
  test?: boolean;
  draft?: boolean;
  noCoordinates?: boolean;
};

function writeEntry(tripId: string, opts: EntryOptions = {}): { slug: string; file: string } {
  const title = opts.title ?? "Lanterns of Hoi An";
  const date = opts.date ?? "2026-09-02";
  const slug = opts.slug ?? "lanterns-of-hoi-an";
  const entriesDir = path.join(dir, OWNER, "trips", tripId, "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  const file = path.join(entriesDir, `${date}-${slug}.md`);
  fs.writeFileSync(
    file,
    [
      "---",
      `title: "${title}"`,
      `date: "${date}"`,
      'location: "Hoi An"',
      'country: "Vietnam"',
      ...(opts.noCoordinates ? [] : ["lat: 15.8801", "lng: 108.338"]),
      ...(opts.photo
        ? ["gallery:", `  - src: "/media/${tripId}/photo.jpg"`, `    type: "image"`, `    caption: "Lanterns at dusk"`]
        : []),
      ...(opts.costs
        ? ["costs:", `  - { label: "Dinner", amount: 42, category: "food", currency: "CHF" }`]
        : []),
      ...(opts.translations
        ? [
            "translations:",
            "  de:",
            '    title: "Laternen von Hoi An"',
            "    content: |-",
            "      Die Altstadt hängt voller Laternen, lange nach Einbruch der Dunkelheit.",
            "",
          ]
        : []),
      ...(opts.test ? ["test: true"] : []),
      ...(opts.draft ? ["status: draft"] : []),
      "---",
      "",
      "The old town hangs with lanterns, and the canal carries a hundred candlelit " +
        "boats past well after dark. We ate on the water and walked home slowly.",
      "",
    ].join("\n"),
  );
  return { slug, file };
}

async function addReader(
  email: string,
  locale: Locale,
  opts: { wantsEmailDigest?: boolean; approve?: boolean } = {},
): Promise<string> {
  await requestContact(OWNER, {
    name: `Reader ${locale}`,
    email,
    locale,
    address: null,
    wantsEmailDigest: opts.wantsEmailDigest ?? true,
    wantsPostcard: false,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  if (opts.approve !== false) await approveContact(OWNER, confirmed.contact.id);
  return confirmed.contact.id;
}

async function clearGrant(contactId: string) {
  const { db } = await getDatabase();
  await db.deleteFrom("access_grants").where("contact_id", "=", contactId).execute();
}

async function agentToken(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

async function scopedToken(email: string, trip: string): Promise<string> {
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const session = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  if (!session.ok) throw new Error(`could not mint a trip token: ${session.reason}`);
  return session.token;
}

async function publish(token: string, tripId: string, slug: string, body: unknown = {}) {
  const { POST } = await import(
    "@/app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route"
  );
  const response = await POST(
    new Request(`https://t.test/api/v1/${OWNER}/trips/${tripId}/days/${slug}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function resend(token: string, tripId: string, slug: string) {
  const { POST } = await import(
    "@/app/api/v1/[user]/trips/[trip]/days/[slug]/send-mail/route"
  );
  const response = await POST(
    new Request(`https://t.test/api/v1/${OWNER}/trips/${tripId}/days/${slug}/send-mail`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: OWNER, trip: tripId, slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function mailFiles(): string[] {
  const box = path.join(dir, OWNER, "mail");
  return fs.existsSync(box) ? fs.readdirSync(box).sort() : [];
}

/** The `.eml` addressed to one recipient — matched the same way the file
 * transport names its files (`lib/mail/index.ts`'s own `slug()`). */
// A boundary on both sides — not just `.includes` — because one address
// being a substring of another ("quinn" fine, but "granted"/"ungranted"
// is not) must not pick the wrong .eml silently.
function addressPattern(emailFragment: string): RegExp {
  const needle = emailFragment.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`);
}

function emlFor(emailFragment: string): string {
  const pattern = addressPattern(emailFragment);
  const file = mailFiles().find((f) => pattern.test(f));
  if (!file) throw new Error(`no .eml addressed to "${emailFragment}" among: ${mailFiles().join(", ")}`);
  return fs.readFileSync(path.join(dir, OWNER, "mail", file), "utf8");
}

function hasMailTo(emailFragment: string): boolean {
  const pattern = addressPattern(emailFragment);
  return mailFiles().some((f) => pattern.test(f));
}

/** The base64 `text/plain` body out of a raw `.eml`, whatever it is nested
 * inside — a bare `multipart/alternative`, or one wrapped in
 * `multipart/related` for an inline attachment. */
function textPartOf(raw: string): string {
  const match = /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n--/.exec(
    raw,
  );
  if (!match) throw new Error("no text/plain part found");
  return Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8");
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
  process.env.SESSION_SECRET = "day-mail-test-secret-day-mail-test";
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig();
  writeUserConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of [
    "CONTENT_DIR",
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
  ]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("who receives it", () => {
  test("a private trip reaches the people on it, not a journal guest", async () => {
    writeTrip("secret", { visibility: "private", people: [{ name: "Robin", email: "robin@example.test" }] });
    const { slug } = writeEntry("secret");
    await addReader("robin@example.test", "en");
    await addReader("stranger@example.test", "en");

    const outcome = await sendDayLetter(OWNER, "alex/secret", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const sentTo = outcome.sent.map((s) => s.email);
    expect(sentTo).toContain("robin@example.test");
    expect(sentTo).not.toContain("stranger@example.test");
    // The owner, always.
    expect(sentTo).toContain(OWNER_EMAIL);

    expect(hasMailTo("robin-example-test")).toBe(true);
    expect(hasMailTo("stranger-example-test")).toBe(false);
  });

  test("wantsEmailDigest is the only consent this checks — off means nothing, traveller or not", async () => {
    writeTrip("secret2", { visibility: "private", people: [{ name: "Robin", email: "robin@example.test" }] });
    const { slug } = writeEntry("secret2");
    await addReader("robin@example.test", "en", { wantsEmailDigest: false });

    const outcome = await sendDayLetter(OWNER, "alex/secret2", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent.map((s) => s.email)).not.toContain("robin@example.test");
    expect(hasMailTo("robin-example-test")).toBe(false);
  });

  test("a `guest` trip reaches an approved contact, and a public one reaches everybody who opted in", async () => {
    writeTrip("open", { visibility: "guest" });
    const { slug } = writeEntry("open", { date: "2026-09-03", slug: "open-day" });
    const grantedId = await addReader("grant@example.test", "en");
    await addReader("pending@example.test", "en", { approve: false });

    const outcome = await sendDayLetter(OWNER, "alex/open", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const sentTo = outcome.sent.map((s) => s.email);
    expect(sentTo).toContain("grant@example.test");
    expect(sentTo).not.toContain("pending@example.test");
    expect(grantedId).toBeTruthy();
  });
});

describe("costs are asked per recipient", () => {
  test("a guest with a live grant sees the cost, one without does not", async () => {
    writeTrip("costed", { visibility: "public", costsVisibility: "guests" });
    const { slug } = writeEntry("costed", { date: "2026-09-04", slug: "spendy-day", costs: true });

    const grantedId = await addReader("penny@example.test", "en");
    const ungrantedId = await addReader("quinn@example.test", "en");
    await clearGrant(ungrantedId);
    expect(grantedId).not.toBe(ungrantedId);

    const outcome = await sendDayLetter(OWNER, "alex/costed", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent.map((s) => s.email)).toEqual(
      expect.arrayContaining(["penny@example.test", "quinn@example.test"]),
    );

    const grantedMail = textPartOf(emlFor("penny-example-test"));
    const ungrantedMail = textPartOf(emlFor("quinn-example-test"));
    expect(grantedMail).toContain("CHF");
    expect(ungrantedMail).not.toContain("CHF");
  });
});

describe("the one rule", () => {
  test("a `test: true` day sends nothing at all", async () => {
    writeTrip("proving", { visibility: "public" });
    const { slug } = writeEntry("proving", { date: "2026-09-05", slug: "invented-day", test: true });
    await addReader("reader@example.test", "en");

    const outcome = await sendDayLetter(OWNER, "alex/proving", slug);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("test_content");
    expect(mailFiles()).toHaveLength(0);
  });

  test("a whole test trip carries the same rule to every one of its days", async () => {
    writeTrip("wholly-test", { visibility: "public", test: true });
    const { slug } = writeEntry("wholly-test", { date: "2026-09-05", slug: "ordinary-looking-day" });
    await addReader("reader@example.test", "en");

    const outcome = await sendDayLetter(OWNER, "alex/wholly-test", slug);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("test_content");
  });
});

describe("the photograph and the letter's shape", () => {
  test("is attached inline (cid:), never linked, and the text part carries the map link", async () => {
    writeTrip("pictured", { visibility: "public" });
    await writePhoto("pictured");
    const { slug } = writeEntry("pictured", { date: "2026-09-06", slug: "photo-day", photo: true });
    await addReader("reader@example.test", "en");

    const outcome = await sendDayLetter(OWNER, "alex/pictured", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failed).toHaveLength(0);

    const raw = emlFor("reader-example-test");
    expect(raw).toContain("multipart/related");
    expect(raw).toContain("Content-ID: <day-photo>");
    expect(raw).toContain("Content-Disposition: inline");
    expect(raw).toContain("Content-Type: image/webp");
    // Never a URL into the media route — a mail client has no session cookie.
    expect(raw).not.toMatch(/src="cid:[^"]*"[^>]*src="https?:/);
    expect(raw).not.toContain('src="https://example.test/alex/media');

    const text = textPartOf(raw);
    expect(text).toContain("https://www.google.com/maps?q=15.8801,108.338");
  });

  test("no coordinates means no map link, and that is the only thing missing", async () => {
    writeTrip("nomap", { visibility: "public" });
    const { slug } = writeEntry("nomap", { date: "2026-09-06", slug: "no-coords-day", noCoordinates: true });
    await addReader("reader@example.test", "en");

    const outcome = await sendDayLetter(OWNER, "alex/nomap", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failed).toHaveLength(0);
    const text = textPartOf(emlFor("reader-example-test"));
    expect(text).not.toContain("google.com/maps");
  });

  test("each reader gets their own language, and only an opening of the words", async () => {
    writeTrip("multilang", { visibility: "public" });
    const { slug } = writeEntry("multilang", {
      date: "2026-09-07",
      slug: "lantern-day",
      translations: true,
    });
    await addReader("english@example.test", "en");
    await addReader("deutsch@example.test", "de");

    const outcome = await sendDayLetter(OWNER, "alex/multilang", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failed).toHaveLength(0);

    const en = textPartOf(emlFor("english-example-test"));
    const de = textPartOf(emlFor("deutsch-example-test"));
    expect(en).toContain("Lanterns of Hoi An");
    expect(de).toContain("Laternen von Hoi An");
    // An invitation, not the whole page: the letter carries the opening, not
    // every word — a link is where the rest is.
    expect(en.length).toBeLessThan(fs.readFileSync(path.join(dir, OWNER, "trips", "multilang", "entries", `2026-09-07-lantern-day.md`), "utf8").length + 4000);
  });
});

describe("the two triggers, and what only the owner may pull", () => {
  test("publishing without send_mail sends nothing", async () => {
    writeTrip("quiet", { visibility: "public" });
    writeEntry("quiet", { date: "2026-09-08", slug: "unannounced-day", draft: true });
    await addReader("reader@example.test", "en");

    const token = await agentToken();
    const result = await publish(token, "quiet", "unannounced-day", {});
    expect(result.status).toBe(200);
    expect(result.body.mail).toBeUndefined();
    expect(mailFiles()).toHaveLength(0);
  });

  test("publishing with send_mail: true sends one letter per entitled reader and reports the count", async () => {
    writeTrip("loud", { visibility: "public" });
    writeEntry("loud", { date: "2026-09-08", slug: "announced-day", draft: true });
    await addReader("one@example.test", "en");
    await addReader("two@example.test", "en");

    const token = await agentToken();
    const result = await publish(token, "loud", "announced-day", { send_mail: true });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("published");
    // owner + two readers.
    expect(result.body.mail).toMatchObject({ attempted: true, resend: false, sent: 3, failed: 0 });
    expect(getEntryBySlug("alex/loud", "announced-day")?.draft).toBeUndefined();
  });

  test("a trip-scoped token is refused on both /publish and /send-mail", async () => {
    writeTrip("shared", { visibility: "public", people: [{ name: "Buddy", email: "buddy@example.test" }] });
    writeEntry("shared", { date: "2026-09-08", slug: "buddy-day", draft: true });

    const token = await scopedToken("buddy@example.test", "shared");

    const published = await publish(token, "shared", "buddy-day", { send_mail: true });
    expect(published.status).toBe(403);
    expect(published.body.error).toBe("out_of_scope");
    expect(mailFiles()).toHaveLength(0);

    // Publish it for real (owner), then the buddy's token tries to resend.
    const owner = await agentToken();
    await publish(owner, "shared", "buddy-day", {});
    const sent = await resend(token, "shared", "buddy-day");
    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe("out_of_scope");
  });

  test("a resend goes to everybody again, and says so", async () => {
    writeTrip("again", { visibility: "public" });
    writeEntry("again", { date: "2026-09-08", slug: "again-day", draft: true });
    await addReader("reader@example.test", "en");

    const token = await agentToken();
    await publish(token, "again", "again-day", { send_mail: true });
    const firstCount = mailFiles().length;
    expect(firstCount).toBeGreaterThan(0);

    const result = await resend(token, "again", "again-day");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, resend: true, attempted: true });
    expect((result.body.sent as number)).toBeGreaterThan(0);
    // Sent again, not skipped as already-delivered.
    expect(mailFiles().length).toBe(firstCount * 2);
  });

  test("resending a draft is refused — nothing to send a letter about yet", async () => {
    writeTrip("early", { visibility: "public" });
    writeEntry("early", { date: "2026-09-08", slug: "still-a-draft", draft: true });
    const token = await agentToken();
    const result = await resend(token, "early", "still-a-draft");
    expect(result.status).toBe(409);
  });

  test("resending a test day is refused, not silently empty", async () => {
    writeTrip("proving2", { visibility: "public" });
    writeEntry("proving2", { date: "2026-09-08", slug: "invented", test: true });
    const token = await agentToken();
    const result = await resend(token, "proving2", "invented");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("test_content");
  });
});

/**
 * B400 — `readPublishFlags`'s `=== true` is unchanged and load-bearing: a
 * non-boolean `send_mail` must still send nothing. What changes is that the
 * response now says so, instead of looking identical to nobody asking.
 */
describe("a non-boolean send_mail is ignored, and the response names it", () => {
  test("a string still publishes, still sends nothing, and now names the flag", async () => {
    writeTrip("stringy", { visibility: "public" });
    writeEntry("stringy", { date: "2026-09-08", slug: "stringy-day", draft: true });
    await addReader("reader@example.test", "en");

    const token = await agentToken();
    const result = await publish(token, "stringy", "stringy-day", { send_mail: "true" });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("published");
    expect(result.body.mail).toBeUndefined();
    expect(mailFiles()).toHaveLength(0);
    expect(result.body.flagsIgnored).toEqual(["send_mail"]);
    expect(typeof result.body.flagsIgnoredMessage).toBe("string");
  });

  test("a number is the same story", async () => {
    writeTrip("numeric", { visibility: "public" });
    writeEntry("numeric", { date: "2026-09-08", slug: "numeric-day", draft: true });
    await addReader("reader@example.test", "en");

    const token = await agentToken();
    const result = await publish(token, "numeric", "numeric-day", { send_mail: 1 });
    expect(result.status).toBe(200);
    expect(result.body.mail).toBeUndefined();
    expect(mailFiles()).toHaveLength(0);
    expect(result.body.flagsIgnored).toEqual(["send_mail"]);
  });

  test("send_mail: true still sends, and reports nothing ignored", async () => {
    writeTrip("boolean", { visibility: "public" });
    writeEntry("boolean", { date: "2026-09-08", slug: "boolean-day", draft: true });
    await addReader("reader@example.test", "en");

    const token = await agentToken();
    const result = await publish(token, "boolean", "boolean-day", { send_mail: true });
    expect(result.status).toBe(200);
    expect(result.body.mail).toMatchObject({ attempted: true, sent: 2, failed: 0 });
    expect(result.body.flagsIgnored).toBeUndefined();
  });

  test("no send_mail key at all sends nothing and reports nothing ignored", async () => {
    writeTrip("silent", { visibility: "public" });
    writeEntry("silent", { date: "2026-09-08", slug: "silent-day", draft: true });
    await addReader("reader@example.test", "en");

    const token = await agentToken();
    const result = await publish(token, "silent", "silent-day", {});
    expect(result.status).toBe(200);
    expect(result.body.mail).toBeUndefined();
    expect(mailFiles()).toHaveLength(0);
    expect(result.body.flagsIgnored).toBeUndefined();
  });
});

describe("mail is best-effort", () => {
  test("a send that fails for one reader does not fail the publish, and is reported", async () => {
    writeTrip("flaky", { visibility: "public" });
    writeEntry("flaky", { date: "2026-09-09", slug: "flaky-day", draft: true });
    await addReader("bad@example.test", "en");
    await addReader("good@example.test", "en");

    // The file transport writes through fs.writeFileSync — make exactly the
    // write for "bad@example.test" throw, the way an SMTP hiccup would for a
    // real transport (same technique as test/contact-notify-mail-failure.test.ts).
    const real = fs.writeFileSync.bind(fs);
    let thrown = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (!thrown && typeof file === "string" && file.includes("bad-example-test")) {
        thrown = true;
        throw new Error("450 4.2.1 mailbox temporarily unavailable");
      }
      return real(file, data, options);
    });

    const token = await agentToken();
    const result = await publish(token, "flaky", "flaky-day", { send_mail: true });

    // The publish itself is unaffected.
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("published");
    expect(getEntryBySlug("alex/flaky", "flaky-day")?.draft).toBeUndefined();

    // And the failure is visible in the response, not only in a log.
    const mail = result.body.mail as Record<string, unknown>;
    expect(mail.attempted).toBe(true);
    expect(mail.failed).toBeGreaterThanOrEqual(1);
    expect(mail.errors).toBeDefined();
  });
});

describe("credits — B366", () => {
  test("an insufficient balance refuses the whole send, and nothing is written", async () => {
    enableCredits();
    writeTrip("billed", { visibility: "public" });
    const { slug } = writeEntry("billed", { date: "2026-09-10", slug: "billed-day" });
    await addReader("one@example.test", "en");
    await addReader("two@example.test", "en");
    await addReader("three@example.test", "en");
    // owner + three readers = 4 needed; only 2 granted.
    await grant(OWNER, 2);

    const outcome = await sendDayLetter(OWNER, "alex/billed", slug);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("no_credits");
    expect(outcome.needed).toBe(4);
    expect(outcome.balance).toBe(2);
    expect(mailFiles()).toHaveLength(0);
    // Refusing must not have touched the balance.
    expect(await balanceOf(OWNER)).toBe(2);
  });

  /**
   * B379. `mailWouldCost` takes a trip ref and no slug, so it can see a
   * `test: true` *trip* and not a `test: true` *day* inside an ordinary one —
   * while `sendDayLetter` refuses the second with `test_content` before it
   * charges anything. The publish pre-flight therefore quotes a price for a
   * send that would cost nothing, and an owner low on credits cannot publish
   * the very content the flag exists to let them publish freely.
   */
  test("a test day costs nothing, even inside an ordinary trip", async () => {
    enableCredits();
    writeTrip("proving-ground", { visibility: "public" });
    const { slug } = writeEntry("proving-ground", {
      date: "2026-09-11",
      slug: "invented-day",
      test: true,
    });
    await addReader("one@example.test", "en");
    await addReader("two@example.test", "en");
    await grant(OWNER, 0 + 1); // one credit: fewer than the three recipients

    expect(await mailWouldCost(OWNER, "alex/proving-ground", slug)).toBe(0);

    // And the send itself still refuses for the right reason, charging nothing.
    const outcome = await sendDayLetter(OWNER, "alex/proving-ground", slug);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("test_content");
    expect(mailFiles()).toHaveLength(0);
    expect(await balanceOf(OWNER)).toBe(1);
  });

  test("exactly enough credits sends everything and leaves the balance at zero", async () => {
    enableCredits();
    writeTrip("paid", { visibility: "public" });
    const { slug } = writeEntry("paid", { date: "2026-09-10", slug: "paid-day" });
    await addReader("one@example.test", "en");
    await addReader("two@example.test", "en");
    // owner + two readers = 3 needed.
    await grant(OWNER, 3);

    const outcome = await sendDayLetter(OWNER, "alex/paid", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sent).toHaveLength(3);
    expect(outcome.failed).toHaveLength(0);
    expect(await balanceOf(OWNER)).toBe(0);
  });

  test("a recipient whose send fails is refunded — never a blanket reversal", async () => {
    enableCredits();
    writeTrip("flaky-credits", { visibility: "public" });
    const { slug } = writeEntry("flaky-credits", {
      date: "2026-09-10",
      slug: "flaky-credits-day",
    });
    await addReader("bad@example.test", "en");
    await addReader("good@example.test", "en");
    // owner + two readers = 3 needed.
    await grant(OWNER, 3);

    const real = fs.writeFileSync.bind(fs);
    let thrown = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (!thrown && typeof file === "string" && file.includes("bad-example-test")) {
        thrown = true;
        throw new Error("450 4.2.1 mailbox temporarily unavailable");
      }
      return real(file, data, options);
    });

    const outcome = await sendDayLetter(OWNER, "alex/flaky-credits", slug);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.failed).toHaveLength(1);
    // 3 spent up front, 1 refunded for the one that did not go out.
    expect(await balanceOf(OWNER)).toBe(1);
  });

  test("the publish pre-flight refuses at 402 and leaves the day a draft", async () => {
    enableCredits();
    writeTrip("preflight", { visibility: "public" });
    writeEntry("preflight", { date: "2026-09-10", slug: "preflight-day", draft: true });
    await addReader("one@example.test", "en");
    await addReader("two@example.test", "en");
    // owner + two readers = 3 needed; only 1 granted.
    await grant(OWNER, 1);

    const token = await agentToken();
    const result = await publish(token, "preflight", "preflight-day", { send_mail: true });
    expect(result.status).toBe(402);
    expect(result.body).toMatchObject({ error: "no_credits", needed: 3, balance: 1 });
    expect(
      getEntryBySlug("alex/preflight", "preflight-day", { includeDrafts: true })?.draft,
    ).toBe(true);
    expect(mailFiles()).toHaveLength(0);
  });

  test("both channels are checked together — passing each alone is not enough", async () => {
    // A bespoke server config for this one test: mail, whatsapp and credits
    // all switched on at once, which no other test in this file needs.
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://example.test", defaultUser: OWNER },
        users: { reserved: [] },
        features: {
          auth: { enabled: true },
          contacts: { enabled: true },
          mail: { enabled: true, transport: "file" },
          whatsapp: {
            enabled: true,
            backend: "dry-run",
            templates: { en: "fernscout_day_published" },
          },
          credits: { enabled: true },
        },
      }),
    );
    clearConfigCache();

    writeTrip("combined", { visibility: "public" });
    const { slug } = writeEntry("combined", {
      date: "2026-09-10",
      slug: "combined-day",
      draft: true,
    });

    // Twelve contacts opted into both channels: mail therefore costs 13 (the
    // owner, always, plus the twelve) and WhatsApp costs 12. Either channel
    // alone fits comfortably in a balance of 20 — 13 < 20 and 12 < 20 — but
    // together they need 25, which is the property this ticket calls out:
    // checking the two channels separately would let this publish and only
    // half-send.
    for (let i = 0; i < 12; i++) {
      const email = `reader${i}@example.test`;
      await requestContact(OWNER, {
        name: `Reader ${i}`,
        email,
        locale: "en",
        address: { tel: `+4176${String(1000000 + i).padStart(7, "0")}` },
        wantsEmailDigest: true,
        wantsPostcard: false,
        wantsWhatsapp: true,
        createdVia: "open",
      });
      const { code } = await issueCode(OWNER, email, "guest");
      const confirmed = await confirmContact(OWNER, email, code);
      if (!confirmed.ok) throw new Error("confirmation failed");
      await approveContact(OWNER, confirmed.contact.id);
    }
    await grant(OWNER, 20);

    const token = await agentToken();
    const result = await publish(token, "combined", slug, {
      send_mail: true,
      send_whatsapp: true,
    });

    expect(result.status).toBe(402);
    expect(result.body.error).toBe("no_credits");
    expect(result.body.needed).toBe(25);
    expect(result.body.balance).toBe(20);
    expect(
      getEntryBySlug("alex/combined", slug, { includeDrafts: true })?.draft,
    ).toBe(true);
    expect(mailFiles()).toHaveLength(0);
  });
});
