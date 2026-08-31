import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode } from "@/lib/auth";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import {
  alreadySentToday,
  buildDigestContent,
  isAwake,
  localDate,
  localHour,
  planDigest,
  renderDigest,
  runDigest,
  timezoneFor,
  DEFAULT_WINDOW,
} from "@/lib/digest";
import { getTrips } from "@/lib/trips";
import { translate } from "@/lib/i18n";
import { translateIn } from "@/lib/locales";
import type { Locale } from "@/lib/types";

/**
 * The digest, end to end, with no mail account and no Postgres.
 *
 * Four of these are the ones that would be embarrassing to get wrong, and they
 * are the four this feature exists to guarantee: a reader is never told about a
 * trip they cannot open, a crashed run never mails anybody twice, everyone is
 * written to in their own language, and nobody is written to at 3am.
 */

const KEY = "22".repeat(32);
const OWNER = "ana";

/** 11:00 in Zurich and Budapest — a decent hour in every band we guess at. */
const MORNING = new Date("2026-08-30T09:00:00.000Z");

let dir: string;
/** Every content root this test made, so the last one can be cleaned up too. */
let roots: string[] = [];

/**
 * Move to a fresh copy of the content directory.
 *
 * `lib/trips.ts` and `lib/entries.ts` memoise per content root, deliberately —
 * a long-lived server reads the markdown once. A real second digest run is a
 * second process and sees the disk again; a test that writes a new day into the
 * same directory would not, so it copies the tree instead. The database is
 * untouched: `DATABASE_URL` still points at the original file, which is exactly
 * the continuity the idempotency tests are about.
 */
function republish(): void {
  const next = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-digest-"));
  fs.cpSync(dir, next, { recursive: true });
  roots.push(next);
  dir = next;
  process.env.CONTENT_DIR = next;
  clearConfigCache();
  clearUserCache();
}

function writeServerConfig(mail: Record<string, unknown> = { enabled: true, transport: "file" }) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { mail, auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function writeUserConfig() {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "one slow loop",
      travellers: [{ name: "Ana Meyer", nickname: "Ana" }],
      startLocation: "Zurich",
      defaultLocale: "de",
      locales: ["de", "en", "hu"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      features: { mail: { enabled: true }, auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

type TripSpec = {
  id: string;
  title: string;
  visibility?: "public" | "unlisted" | "password";
  dates: string[];
};

function writeTrip(spec: TripSpec) {
  const root = path.join(dir, OWNER, "trips", spec.id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${spec.id}"`,
      `title: "${spec.title}"`,
      `start: "${spec.dates[0]}"`,
      `end: "${spec.dates.at(-1)}"`,
      'status: "current"',
      ...(spec.visibility ? [`visibility: "${spec.visibility}"`] : []),
      // A password trip needs a hash or the boot assertion complains; the
      // digest never looks at it, which is rather the point.
      ...(spec.visibility === "password"
        ? ['passwordHash: "scrypt$32768$8$1$c2FsdA$a2V5"']
        : []),
      "---",
      "",
      `${spec.title} intro.`,
      "",
    ].join("\n"),
  );

  for (const [i, date] of spec.dates.entries()) {
    fs.writeFileSync(
      path.join(root, "entries", `${date}-stop-${i}.md`),
      [
        "---",
        `title: "Stop ${i} on ${spec.id}"`,
        `date: "${date}"`,
        `location: "Place ${i}"`,
        'country: "Vietnam"',
        "lat: 16.0",
        "lng: 108.2",
        "translations:",
        "  de:",
        `    title: "Halt ${i} auf ${spec.id}"`,
        "  hu:",
        `    title: "${i}. állomás itt: ${spec.id}"`,
        "---",
        "",
        `Something happened on ${date}.`,
        "",
      ].join("\n"),
    );
  }
}

/**
 * A confirmed, approved reader whose approval is backdated.
 *
 * The backdating matters: a reader's first digest starts at the day they were
 * let in, so a contact approved by the wall clock during a test has, correctly,
 * nothing new to hear about.
 */
async function addReader(
  email: string,
  locale: Locale,
  options: { approvedOn?: string; wantsEmailDigest?: boolean; approve?: boolean } = {},
) {
  await requestContact(OWNER, {
    name: `Reader ${locale}`,
    email,
    locale,
    address: null,
    wantsEmailDigest: options.wantsEmailDigest ?? true,
    wantsPostcard: false,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error("confirmation failed");

  if (options.approve !== false) await approveContact(OWNER, confirmed.contact.id);

  const { db } = await getDatabase();
  await db
    .updateTable("contacts")
    .set({ approved_at: `${options.approvedOn ?? "2026-08-01"}T08:00:00.000Z` })
    .where("id", "=", confirmed.contact.id)
    .execute();

  return confirmed.contact.id;
}

/**
 * Grant one reader access to one trip (or `*`).
 *
 * Approving somebody already creates the `*` grant — that is what approval
 * *is*, in `lib/contacts`. These helpers exist for the shapes approval does not
 * produce: a reader whose grant covers one trip only, or one that has run out.
 */
async function grant(contactId: string, tripId: string, expiresAt: string | null = null) {
  const { db } = await getDatabase();
  await db
    .insertInto("access_grants")
    .values({
      id: `g-${contactId}-${tripId}`,
      owner_id: OWNER,
      contact_id: contactId,
      trip_id: tripId,
      scope: "read",
      granted_at: "2026-08-01T08:00:00.000Z",
      granted_by: OWNER,
      expires_at: expiresAt,
    })
    .execute();
}

async function clearGrants(contactId: string) {
  const { db } = await getDatabase();
  await db.deleteFrom("access_grants").where("contact_id", "=", contactId).execute();
}

/** The plain-text alternative, out of a written `.eml`. */
/** The first part of a multipart mail, decoded. The boundary is read from the
 * header rather than assumed: hardcoding it here meant renaming the prefix in
 * lib/mail/rfc822.ts silently emptied this and four tests failed on a string
 * that had nothing to do with them. */
function textOf(emlPath: string): string {
  const raw = fs.readFileSync(emlPath, "utf8");
  const boundary = /boundary="([^"]+)"/.exec(raw)?.[1];
  if (!boundary) throw new Error(`no multipart boundary in ${emlPath}`);
  const part = raw.split(`--${boundary}\r\n`)[1] ?? "";
  const body = part.split("\r\n\r\n")[1] ?? "";
  return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
}

function mailFiles(): string[] {
  const box = path.join(dir, OWNER, "mail");
  return fs.existsSync(box) ? fs.readdirSync(box).sort() : [];
}

async function digestRows() {
  const { db } = await getDatabase();
  return db.selectFrom("digest_sends").selectAll().orderBy("created_at", "asc").execute();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-digest-"));
  roots = [dir];
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "digest.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  delete process.env.AUTH_DEV_CODE;
  delete process.env.DIGEST_TIMEZONE;

  writeServerConfig();
  writeUserConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.DIGEST_TIMEZONE;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("what a reader is told about", () => {
  beforeEach(() => {
    writeTrip({ id: "open-2026", title: "Open trip", dates: ["2026-08-25", "2026-08-26"] });
    writeTrip({
      id: "quiet-2026",
      title: "Unlisted trip",
      visibility: "unlisted",
      dates: ["2026-08-27"],
    });
    writeTrip({
      id: "locked-2026",
      title: "Private trip",
      visibility: "password",
      dates: ["2026-08-28"],
    });
  });

  /** The one that must never regress. */
  test("a reader without access hears nothing about a private trip", async () => {
    const reader = await addReader("plain@example.test", "de");
    // A reader whose grant covers one public trip: no `*`, so the unlisted and
    // password-protected trips are both none of their business.
    await clearGrants(reader);
    await grant(reader, "open-2026");

    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready).toHaveLength(1);
    expect(plan.ready[0].content.trips.map((t) => t.tripId)).toEqual(["open-2026"]);

    const mail = JSON.stringify(plan.ready[0].content);
    expect(mail).not.toContain("locked-2026");
    expect(mail).not.toContain("Private trip");
    expect(mail).not.toContain("quiet-2026");
    expect(mail).not.toContain("Unlisted trip");
  });

  test("an unlisted trip reaches only the readers actually granted it", async () => {
    await addReader("granted@example.test", "de"); // approval is the `*` grant
    const stranger = await addReader("stranger@example.test", "de");
    await clearGrants(stranger);
    await grant(stranger, "open-2026");

    const plan = await planDigest(OWNER, { now: MORNING });
    const byEmail = new Map(plan.ready.map((r) => [r.email, r]));

    expect(
      byEmail.get("granted@example.test")!.content.trips.map((t) => t.tripId).sort(),
    ).toEqual(["open-2026", "quiet-2026"]);
    expect(byEmail.get("stranger@example.test")!.content.trips.map((t) => t.tripId)).toEqual([
      "open-2026",
    ]);
  });

  /**
   * A grant does not open the password gate — `lib/tripGate.ts` has no database
   * behind it — so a line about one of these trips would link to a door the
   * reader has no key for.
   */
  test("a password-protected trip is never in a digest, grant or no grant", async () => {
    const granted = await addReader("granted@example.test", "de");
    await grant(granted, "locked-2026");

    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready[0].content.trips.map((t) => t.tripId)).not.toContain("locked-2026");
  });

  test("an expired grant is not a grant", async () => {
    const reader = await addReader("expired@example.test", "de");
    await clearGrants(reader);
    await grant(reader, "*", "2026-08-10T00:00:00.000Z");

    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready[0].content.trips.map((t) => t.tripId)).toEqual(["open-2026"]);
  });

  test("days dated after today are not announced yet", () => {
    writeTrip({ id: "ahead-2026", title: "Ahead", dates: ["2026-08-29", "2026-09-20"] });
    const trips = getTrips(OWNER).filter((t) => t.id === "ahead-2026");
    const content = buildDigestContent({
      username: OWNER,
      trips,
      since: "2026-08-01",
      today: "2026-08-30",
      locale: "en",
      base: "https://example.test",
    });
    expect(content?.dayCount).toBe(1);
    expect(content?.cursor).toBe("2026-08-29");
  });
});

describe("one language per reader", () => {
  beforeEach(() => {
    writeTrip({ id: "open-2026", title: "Open trip", dates: ["2026-08-25", "2026-08-26"] });
  });

  test("each recipient's mail is in their own language", async () => {
    await addReader("de@example.test", "de");
    await addReader("hu@example.test", "hu");
    await addReader("en@example.test", "en");

    const outcome = await runDigest(OWNER, { now: MORNING });
    expect(outcome.sent).toHaveLength(3);

    const byEmail = new Map(outcome.sent.map((s) => [s.email, s]));
    for (const locale of ["de", "hu", "en"] as Locale[]) {
      const sent = byEmail.get(`${locale}@example.test`)!;
      expect(sent.locale).toBe(locale);
      expect(sent.subject).toBe(
        translateIn(locale, "digest.subject", { count: "2", title: "Two Backpacks" }),
      );
      const text = textOf(sent.reference!);
      expect(text).toContain(translateIn(locale, "digest.button"));
      expect(text).toContain(translateIn(locale, "digest.footer", { site: "Two Backpacks" }));
    }

    // Not the same letter three times with a different address on it.
    const subjects = new Set(outcome.sent.map((s) => s.subject));
    expect(subjects.size).toBe(3);
  });

  test("entry titles come through translated, not just the furniture", async () => {
    await addReader("hu@example.test", "hu");
    const outcome = await runDigest(OWNER, { now: MORNING });
    const text = textOf(outcome.sent[0].reference!);
    expect(text).toContain("0. állomás itt: open-2026");
    expect(text).not.toContain("Stop 0 on open-2026");
  });

  test("a reader with no language of their own gets the journal's", async () => {
    const id = await addReader("none@example.test", "en");
    const { db } = await getDatabase();
    await db.updateTable("contacts").set({ locale: null }).where("id", "=", id).execute();

    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready[0].locale).toBe("de");
  });

  test("the text alternative is never empty and carries every link", async () => {
    await addReader("de@example.test", "de");
    const outcome = await runDigest(OWNER, { now: MORNING });
    const text = textOf(outcome.sent[0].reference!);

    expect(text.length).toBeGreaterThan(120);
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).toContain("https://example.test/ana/trips/open-2026/day/stop-0");
    expect(text).toContain("https://example.test/ana/trips/open-2026/day/stop-1");
    // The preferences page and the unsubscribe link, both reachable with no login.
    expect(text).toContain("https://example.test/ana/c/fs_manage_");
    expect(text).toContain("https://example.test/ana/u/fs_manage_");
  });

  test("every digest carries one-click unsubscribe headers", () => {
    const mail = renderDigest({
      username: OWNER,
      title: "Two Backpacks",
      recipient: { email: "r@example.test", name: "R", locale: "hu" },
      content: {
        dayCount: 1,
        cursor: "2026-08-26",
        trips: [
          {
            ref: "ana/open-2026",
            tripId: "open-2026",
            title: "Open trip",
            url: "https://example.test/ana/trips/open-2026",
            newDays: 1,
            days: [
              {
                date: "2026-08-26",
                slug: "stop-1",
                title: "Halt",
                location: "Place",
                url: "https://example.test/ana/trips/open-2026/day/stop-1",
              },
            ],
          },
        ],
      },
      manageUrl: "https://example.test/ana/c/tok",
      unsubscribeUrl: "https://example.test/ana/u/tok",
    });

    expect(mail.headers?.["List-Unsubscribe"]).toBe("<https://example.test/ana/u/tok>");
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // The footer's own wording is Hungarian too, not an English seam.
    expect(mail.text).toContain(translateIn("hu", "contact.unsubscribe"));
    expect(mail.text).toContain(translateIn("hu", "digest.preferences"));
  });
});

describe("who is written to at all", () => {
  beforeEach(() => {
    writeTrip({ id: "open-2026", title: "Open trip", dates: ["2026-08-25"] });
  });

  test("somebody who never asked for email is not emailed", async () => {
    await addReader("nope@example.test", "de", { wantsEmailDigest: false });
    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("no-consent");
  });

  test("somebody the owner has not approved is not emailed", async () => {
    await addReader("waiting@example.test", "de", { approve: false });
    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("not-approved");
  });

  test("a first digest starts the day they were let in, not the day the trip did", async () => {
    writeTrip({ id: "long-2026", title: "Long", dates: ["2026-06-01", "2026-08-25"] });
    await addReader("late@example.test", "de", { approvedOn: "2026-08-20" });

    const plan = await planDigest(OWNER, { now: MORNING });
    expect(plan.ready[0].since).toBe("2026-08-20");
    expect(plan.ready[0].content.dayCount).toBe(2); // one per trip, both on the 25th
  });
});

describe("running it twice", () => {
  beforeEach(() => {
    writeTrip({ id: "open-2026", title: "Open trip", dates: ["2026-08-25", "2026-08-26"] });
  });

  test("a re-run sends nothing, even with the quiet rules out of the way", async () => {
    await addReader("de@example.test", "de");
    const first = await runDigest(OWNER, { now: MORNING });
    expect(first.sent).toHaveLength(1);
    expect(mailFiles()).toHaveLength(1);

    const again = await runDigest(OWNER, { now: MORNING, force: true });
    expect(again.sent).toHaveLength(0);
    expect(again.plan.skipped.map((s) => s.reason)).toEqual(["nothing-new"]);
    expect(mailFiles()).toHaveLength(1);
    expect(await digestRows()).toHaveLength(1);
  });

  test("a new day after a digest is the only thing the next one carries", async () => {
    await addReader("de@example.test", "de");
    await runDigest(OWNER, { now: MORNING });

    republish();
    writeTrip({
      id: "open-2026",
      title: "Open trip",
      dates: ["2026-08-25", "2026-08-26", "2026-08-27"],
    });
    const next = await runDigest(OWNER, {
      now: new Date("2026-08-31T09:00:00.000Z"),
    });

    expect(next.sent).toHaveLength(1);
    expect(next.plan.ready[0].content.dayCount).toBe(1);
    expect(textOf(next.sent[0].reference!)).toContain("stop-2");
  });

  /**
   * The crash case: a row left at `sending` is an attempt nobody knows the
   * outcome of, and it counts as delivered. A missed digest is a smaller harm
   * than a duplicate.
   */
  test("an attempt whose outcome is unknown is not retried", async () => {
    await addReader("de@example.test", "de");
    const { db } = await getDatabase();
    const contact = await db.selectFrom("contacts").select("id").executeTakeFirstOrThrow();
    await db
      .insertInto("digest_sends")
      .values({
        id: "half-done",
        owner_id: OWNER,
        contact_id: contact.id,
        status: "sending",
        cursor: "2026-08-26",
        day_count: 2,
        trips: "[]",
        locale: "de",
        mail_ref: null,
        error: null,
        created_at: "2026-08-29T09:00:00.000Z",
        sent_at: null,
      })
      .execute();

    const outcome = await runDigest(OWNER, { now: MORNING });
    expect(outcome.sent).toHaveLength(0);
    expect(mailFiles()).toHaveLength(0);
  });

  /** A send that definitely failed is a reader who got nothing: try again. */
  test("an attempt that failed outright is retried", async () => {
    await addReader("de@example.test", "de");
    const { db } = await getDatabase();
    const contact = await db.selectFrom("contacts").select("id").executeTakeFirstOrThrow();
    await db
      .insertInto("digest_sends")
      .values({
        id: "broken",
        owner_id: OWNER,
        contact_id: contact.id,
        status: "failed",
        cursor: "2026-08-26",
        day_count: 2,
        trips: "[]",
        locale: "de",
        mail_ref: null,
        error: "smtp exploded",
        created_at: "2026-08-29T09:00:00.000Z",
        sent_at: null,
      })
      .execute();

    const outcome = await runDigest(OWNER, { now: MORNING });
    expect(outcome.sent).toHaveLength(1);
  });

  test("a dry run writes nothing at all", async () => {
    await addReader("de@example.test", "de");
    const outcome = await runDigest(OWNER, { now: MORNING, dryRun: true });

    expect(outcome.dryRun).toBe(true);
    expect(outcome.plan.ready).toHaveLength(1);
    expect(outcome.sent).toHaveLength(0);
    expect(mailFiles()).toEqual([]);
    expect(await digestRows()).toHaveLength(0);

    // And the real run afterwards is unaffected by it.
    const real = await runDigest(OWNER, { now: MORNING });
    expect(real.sent).toHaveLength(1);
  });
});

describe("the quiet rules (D8)", () => {
  test("the hour is read in the reader's band, not the server's", () => {
    const at = new Date("2026-08-30T01:30:00.000Z");
    expect(localHour(at, "Europe/Zurich")).toBe(3); // CEST, +2
    expect(localHour(at, "Europe/Budapest")).toBe(3);
    expect(localHour(at, "UTC")).toBe(1);
    expect(localHour(at, "Asia/Ho_Chi_Minh")).toBe(8);
  });

  test("winter and summer are not the same offset", () => {
    expect(localHour(new Date("2026-01-15T07:30:00.000Z"), "Europe/Zurich")).toBe(8);
    expect(localHour(new Date("2026-07-15T07:30:00.000Z"), "Europe/Zurich")).toBe(9);
  });

  test("3am is nobody's idea of a good time", () => {
    const at = new Date("2026-08-30T01:30:00.000Z");
    expect(isAwake(at, "Europe/Zurich")).toBe(false);
    expect(isAwake(at, "Europe/Budapest")).toBe(false);
    // The same instant is mid-morning in Vietnam, which is the entire reason
    // this takes a timezone rather than the process's own clock.
    expect(isAwake(at, "Asia/Ho_Chi_Minh")).toBe(true);
  });

  test("the window is the whole civilised day and nothing outside it", () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(`2026-08-30T${String(hour).padStart(2, "0")}:00:00.000Z`);
      const expected = hour >= DEFAULT_WINDOW.from && hour < DEFAULT_WINDOW.to;
      expect(isAwake(at, "UTC")).toBe(expected);
    }
  });

  test("language is the only timezone signal there is, and only where it means something", () => {
    expect(timezoneFor("de")).toBe("Europe/Zurich");
    expect(timezoneFor("hu")).toBe("Europe/Budapest");
    // English readers are everywhere, so they get the journal's own zone.
    expect(timezoneFor("en")).toBe("Europe/Zurich");
    process.env.DIGEST_TIMEZONE = "Asia/Ho_Chi_Minh";
    expect(timezoneFor("en")).toBe("Asia/Ho_Chi_Minh");
    // …and a band that is known stays known.
    expect(timezoneFor("hu")).toBe("Europe/Budapest");
  });

  test("one a day is counted in the reader's calendar, not the server's", () => {
    // 23:30 UTC on the 30th is already the 31st in Zurich.
    const lastNight = "2026-08-30T22:30:00.000Z";
    const nextMorning = new Date("2026-08-31T07:00:00.000Z");
    expect(alreadySentToday(lastNight, nextMorning, "Europe/Zurich")).toBe(true);
    expect(alreadySentToday(lastNight, nextMorning, "UTC")).toBe(false);
    expect(alreadySentToday(null, nextMorning, "UTC")).toBe(false);
  });

  test("the local date is the reader's date", () => {
    expect(localDate(new Date("2026-08-30T22:30:00.000Z"), "Europe/Zurich")).toBe("2026-08-31");
    expect(localDate(new Date("2026-08-30T22:30:00.000Z"), "UTC")).toBe("2026-08-30");
  });

  describe("applied to a real run", () => {
    beforeEach(() => {
      writeTrip({ id: "open-2026", title: "Open trip", dates: ["2026-08-25", "2026-08-26"] });
    });

    test("nobody is written to in the middle of their night", async () => {
      await addReader("de@example.test", "de");
      const outcome = await runDigest(OWNER, { now: new Date("2026-08-30T01:30:00.000Z") });

      expect(outcome.sent).toHaveLength(0);
      expect(outcome.plan.skipped[0].reason).toBe("quiet-hours");
      expect(mailFiles()).toEqual([]);
    });

    test("--force is the way past it, and it is a deliberate act", async () => {
      await addReader("de@example.test", "de");
      const outcome = await runDigest(OWNER, {
        now: new Date("2026-08-30T01:30:00.000Z"),
        force: true,
      });
      expect(outcome.sent).toHaveLength(1);
    });

    test("two runs in one day mean one mail", async () => {
      await addReader("de@example.test", "de");
      await runDigest(OWNER, { now: MORNING });

      // A new day is written, and the sender runs again the same afternoon.
      republish();
      writeTrip({
        id: "open-2026",
        title: "Open trip",
        dates: ["2026-08-25", "2026-08-26", "2026-08-27"],
      });
      const again = await runDigest(OWNER, { now: new Date("2026-08-30T15:00:00.000Z") });

      expect(again.sent).toHaveLength(0);
      expect(again.plan.skipped[0].reason).toBe("already-today");
      expect(mailFiles()).toHaveLength(1);
    });

    test("and tomorrow it goes out", async () => {
      await addReader("de@example.test", "de");
      await runDigest(OWNER, { now: MORNING });
      republish();
      writeTrip({
        id: "open-2026",
        title: "Open trip",
        dates: ["2026-08-25", "2026-08-26", "2026-08-27"],
      });

      const tomorrow = await runDigest(OWNER, { now: new Date("2026-08-31T09:00:00.000Z") });
      expect(tomorrow.sent).toHaveLength(1);
    });
  });
});

describe("the switches", () => {
  beforeEach(() => {
    writeTrip({ id: "open-2026", title: "Open trip", dates: ["2026-08-25"] });
  });

  test("refuses to send when mail is off, and says why", async () => {
    writeServerConfig({ enabled: false, transport: "file" });
    await addReader("de@example.test", "de");
    await expect(runDigest(OWNER, { now: MORNING })).rejects.toThrow(/Mail is not enabled/);
  });

  test("a dry run still works with mail off — there is nothing to send", async () => {
    await addReader("de@example.test", "de");
    writeServerConfig({ enabled: false, transport: "file" });
    const outcome = await runDigest(OWNER, { now: MORNING, dryRun: true });
    expect(outcome.plan.ready).toHaveLength(1);
  });

  test("an unknown user is an error, not an empty run", async () => {
    await expect(planDigest("nobody", { now: MORNING })).rejects.toThrow(/No such user/);
  });

  test("--since has to be a date", async () => {
    await expect(planDigest(OWNER, { now: MORNING, since: "last tuesday" })).rejects.toThrow(
      /--since/,
    );
  });

  test("--since overrides every watermark", async () => {
    writeTrip({ id: "long-2026", title: "Long", dates: ["2026-06-01", "2026-08-25"] });
    await addReader("de@example.test", "de");
    const plan = await planDigest(OWNER, { now: MORNING, since: "2026-05-01" });
    expect(plan.ready[0].content.dayCount).toBe(3);
  });
});
