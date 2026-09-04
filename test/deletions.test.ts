import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "kysely";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { clearConfigCache } from "@/lib/config";
import { grant } from "@/lib/credits";
import { clearUserCache, getUser, userExists } from "@/lib/users";
import { closeDatabase, getDatabase, TABLE_NAMES } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode, type Session } from "@/lib/auth";
import { tripWriteScope } from "@/lib/tripPeople";
import { createJournal } from "@/lib/journals";
import { createTrip } from "@/lib/tripWrite";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { journalTombstone, tripTombstone } from "@/lib/tombstones";
import {
  confirmDeletion,
  DELETION_TTL_MS,
  requestDeletion,
  resolveDeletionToken,
  summarise,
} from "@/lib/deletions";
import { DELETE as deleteJournalRoute, PATCH as patchJournalRoute } from "@/app/api/v1/[user]/route";
import { DELETE as deleteTripRoute, PATCH as patchTripRoute } from "@/app/api/v1/[user]/trips/[trip]/route";
import * as confirmRoute from "@/app/api/v1/[user]/deletions/[token]/route";
import DeletePage from "@/app/[user]/delete/[token]/page";
import { GET as deletionExport } from "@/app/[user]/delete/[token]/export.zip/route";

/**
 * Deleting a journal, and deleting one trip out of it (B38).
 *
 * The most dangerous code in this repository: everything else here can be
 * corrected by editing a file. So the tests are mostly about what does *not*
 * happen — a `DELETE` that deletes nothing, a link that is inert on GET, a
 * token that works once — and about the sweep leaving nothing behind when it
 * finally does run.
 */

let dir: string;
const OWNER = "owner@example.test";
const GUEST = "someone@example.test";
const DATES = { start: "2027-04-01", end: "2027-04-20" };

function serverConfig(): void {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: {
        signup: { enabled: true },
        auth: { enabled: true },
        // The file transport, which is what makes this whole flow testable
        // with no mail account anywhere — AGENTS.md's rule.
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
}

/** B374: `serverConfig` plus the one switch its tests need to turn. */
function serverConfigWithCredits(enabled: boolean): void {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: {
        signup: { enabled: true },
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
        credits: { enabled },
      },
    }),
  );
  clearConfigCache();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-deletions-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-deletions";
  serverConfig();
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeJournal(username = "anna") {
  const created = createJournal({
    username,
    title: "Anna's journal",
    ownerEmail: OWNER,
    ownerName: "Anna Traveller",
    ownerNickname: "Anna",
  });
  if (!created.ok) throw new Error(created.message);
  return created.username;
}

function makeTrip(username: string, id = "japan-2027", visibility?: "public" | "guest" | "private") {
  const created = createTrip(username, { id, title: "Japan", ...DATES, ...(visibility ? { visibility } : {}) });
  if (!created.ok) throw new Error(created.message);
  return id;
}

/** A day with a photograph beside it, so "the media goes too" is testable. */
function writeDay(username: string, tripId: string, slug: string) {
  const trip = path.join(dir, username, "trips", tripId);
  fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
  fs.mkdirSync(path.join(trip, "media"), { recursive: true });
  fs.writeFileSync(
    path.join(trip, "entries", `2027-04-02-${slug}.md`),
    ['---', `title: "${slug}"`, 'date: "2027-04-02"', 'location: "Kyoto"', 'country: "Japan"', '---', '', 'Words.', ''].join("\n"),
  );
  fs.writeFileSync(path.join(trip, "media", `${slug}.jpg`), Buffer.alloc(2048, 7));
}

/** A real session, minted the way the auth route mints one. */
async function session(owner: string, email: string, scope?: string): Promise<Session> {
  const { code } = await issueCode(owner, email, "agent");
  const verified = await verifyCode(owner, email, code, "agent", scope);
  if (!verified.ok) throw new Error(`could not open a session: ${verified.reason}`);
  const { resolveSession } = await import("@/lib/auth");
  const resolved = await resolveSession(verified.token, "agent");
  if (!resolved) throw new Error("session did not resolve");
  return resolved;
}

async function tokenFor(owner: string, email: string, scope?: string): Promise<string> {
  const { code } = await issueCode(owner, email, "agent");
  const verified = await verifyCode(owner, email, code, "agent", scope);
  if (!verified.ok) throw new Error(`could not open a session: ${verified.reason}`);
  return verified.token;
}

function request(url: string, token?: string): Request {
  return new Request(url, {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

/** The `.eml` files written under a journal, newest last. */
function mails(username: string): string[] {
  const mailDir = path.join(dir, username, "mail");
  if (!fs.existsSync(mailDir)) return [];
  return fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml")).sort();
}

/** The plain-text alternative of one message — same MIME walk as
 * test/journals.test.ts, for the same reason: a base64 body has blank lines. */
function mailBody(username: string, index = 0): string {
  const files = mails(username);
  const raw = fs.readFileSync(path.join(dir, username, "mail", files[index]), "utf8");
  const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
  if (!boundary) throw new Error("no MIME boundary in the message");
  for (const part of raw.split(`--${boundary}`)) {
    if (!/Content-Type: text\/plain/i.test(part)) continue;
    const encoded = part.split(/\r?\n\r?\n/).slice(1).join("\n");
    return Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8");
  }
  throw new Error("no text/plain part in the message");
}

/**
 * The confirmation link out of the mail — the only place it exists — and the
 * mail is consumed on the way out.
 *
 * Consumed rather than indexed because the file transport names a message by
 * timestamp, recipient and subject, so two identical mails inside the same
 * millisecond land on one filename and a test that read `files[1]` failed
 * about one run in ten. Captured as B50; here, taking the mail as you read it
 * removes the ordering question altogether.
 */
function takeToken(username: string): string {
  const files = mails(username);
  if (files.length !== 1) {
    throw new Error(`expected exactly one unread mail for ${username}, found ${files.length}`);
  }
  const body = mailBody(username, 0);
  const match = body.match(new RegExp(`/${username}/delete/([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no deletion link in the mail:\n${body}`);
  fs.unlinkSync(path.join(dir, username, "mail", files[0]));
  return match[1];
}

describe("asking to delete", () => {
  test("a journal: 202, nothing deleted, and a mail naming what would go", async () => {
    const user = makeJournal();
    const trip = makeTrip(user);
    writeDay(user, trip, "kyoto-in-the-rain");
    const token = await tokenFor(user, OWNER);

    const response = await deleteJournalRoute(request(`https://t.test/api/v1/${user}`, token), {
      params: Promise.resolve({ user }),
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body.deleted).toBe(false);
    expect(body.mailedTo).toBe(OWNER);
    expect(String(body.note)).toContain("NOTHING HAS BEEN DELETED");

    // The journal is untouched.
    expect(fs.existsSync(path.join(dir, user, "config.json"))).toBe(true);
    expect(getTrips(user)).toHaveLength(1);

    const text = mailBody(user);
    expect(text).toContain("Anna's journal");
    expect(text).toMatch(/1 journeys, 1 days/);
    expect(text).toContain(`/${user}/delete/`);
    // The export is offered, and it is the complete one.
    expect(text).toContain(`/${user}/delete/`);
    expect(text).toMatch(/export\.zip/);
  });

  test("a trip: 202, nothing deleted, and the mail says the photographs go too", async () => {
    const user = makeJournal();
    const trip = makeTrip(user);
    writeDay(user, trip, "kyoto-in-the-rain");
    const token = await tokenFor(user, OWNER);

    const response = await deleteTripRoute(
      request(`https://t.test/api/v1/${user}/trips/${trip}`, token),
      { params: Promise.resolve({ user, trip }) },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body.deleted).toBe(false);
    expect(getTrip(tripRef(user, trip))).toBeTruthy();

    const text = mailBody(user);
    expect(text).toContain("Japan");
    expect(text.toLowerCase()).toContain("photograph");
  });

  test("a second request retires the first link, so one inbox holds one live one", async () => {
    const user = makeJournal();
    makeTrip(user);
    const first = await requestDeletion({ kind: "journal", username: user });
    expect(first.ok).toBe(true);
    const staleToken = takeToken(user);
    const second = await requestDeletion({ kind: "journal", username: user });
    expect(second.ok).toBe(true);

    const stale = staleToken;
    const live = takeToken(user);
    expect(await resolveDeletionToken(user, stale)).toMatchObject({ ok: false, reason: "used" });
    expect(await resolveDeletionToken(user, live)).toMatchObject({ ok: true });
  });

  test("a journal with no owner.email is refused rather than deleted on a token's word", async () => {
    const user = makeJournal();
    const config = JSON.parse(fs.readFileSync(path.join(dir, user, "config.json"), "utf8"));
    delete config.owner.email;
    fs.writeFileSync(path.join(dir, user, "config.json"), JSON.stringify(config));
    clearConfigCache();
    clearUserCache();

    const asked = await requestDeletion({ kind: "journal", username: user });
    expect(asked).toMatchObject({ ok: false, error: "no_owner_address" });
  });

  test("with mail switched off the endpoint is absent, not broken", async () => {
    const user = makeJournal();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "Testbed", url: "https://t.test" },
        users: { reserved: [] },
        features: { auth: { enabled: true }, signup: { enabled: true }, mail: { enabled: false } },
      }),
    );
    clearConfigCache();
    clearUserCache();

    const asked = await requestDeletion({ kind: "journal", username: user });
    expect(asked).toMatchObject({ ok: false, error: "deletion_unavailable", status: 404 });
    expect(userExists(user)).toBe(true);
  });
});

describe("who may ask", () => {
  test("a trip-scoped token is refused on both endpoints", async () => {
    const user = makeJournal();
    const trip = makeTrip(user);
    // What somebody listed in a trip's `people:` gets from /api/auth/request.
    const scoped = await tokenFor(user, GUEST, tripWriteScope(trip));

    const journal = await deleteJournalRoute(request(`https://t.test/api/v1/${user}`, scoped), {
      params: Promise.resolve({ user }),
    });
    expect(journal.status).toBe(403);
    expect((await journal.json()).error).toBe("out_of_scope");

    // Refused on the very trip the token may write days into: writing to a
    // journey and ending it are different authorities.
    const tripResponse = await deleteTripRoute(
      request(`https://t.test/api/v1/${user}/trips/${trip}`, scoped),
      { params: Promise.resolve({ user, trip }) },
    );
    expect(tripResponse.status).toBe(403);
    expect((await tripResponse.json()).error).toBe("out_of_scope");

    expect(mails(user)).toHaveLength(0);
    expect(getTrip(tripRef(user, trip))).toBeTruthy();
  });

  test("a token for another journal cannot reach this one", async () => {
    const anna = makeJournal("anna");
    makeJournal("bruno");
    const brunosToken = await tokenFor("bruno", "bruno@example.test");

    const response = await deleteJournalRoute(request(`https://t.test/api/v1/${anna}`, brunosToken), {
      params: Promise.resolve({ user: anna }),
    });
    expect(response.status).toBe(403);
    expect(userExists(anna)).toBe(true);
  });

  test("no token at all is a 401", async () => {
    const user = makeJournal();
    const response = await deleteJournalRoute(request(`https://t.test/api/v1/${user}`), {
      params: Promise.resolve({ user }),
    });
    expect(response.status).toBe(401);
  });
});

describe("the link", () => {
  test("following it with GET deletes nothing", async () => {
    const user = makeJournal();
    const trip = makeTrip(user);
    writeDay(user, trip, "kyoto-in-the-rain");
    await requestDeletion({ kind: "journal", username: user });
    const token = takeToken(user);

    // The page is a page, and pages cannot be POSTed to. Rendering it is the
    // whole of what a mail scanner following the link can do.
    const rendered = await DeletePage({ params: Promise.resolve({ user, token }), searchParams: Promise.resolve({}) });
    expect(rendered).toBeTruthy();

    expect(userExists(user)).toBe(true);
    expect(getTrips(user)).toHaveLength(1);
    expect(journalTombstone(user)).toBeNull();
    // And the token is not spent by looking at it.
    expect(await resolveDeletionToken(user, token)).toMatchObject({ ok: true });
  });

  test("the confirmation endpoint has no GET at all", () => {
    expect(typeof confirmRoute.POST).toBe("function");
    expect((confirmRoute as Record<string, unknown>).GET).toBeUndefined();
    expect((confirmRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });

  test("a used token is refused, and the page explains rather than 404s", async () => {
    const user = makeJournal();
    makeTrip(user);
    await requestDeletion({ kind: "trip", username: user, tripId: "japan-2027" });
    const token = takeToken(user);

    const first = await confirmRoute.POST(
      new Request(`https://t.test/api/v1/${user}/deletions/${token}`, { method: "POST" }),
      { params: Promise.resolve({ user, token }) },
    );
    expect(first.status).toBe(200);

    const second = await confirmRoute.POST(
      new Request(`https://t.test/api/v1/${user}/deletions/${token}`, { method: "POST" }),
      { params: Promise.resolve({ user, token }) },
    );
    expect(second.status).toBe(409);
    expect((await second.json()).deleted).toBe(false);

    const page = (await DeletePage({ params: Promise.resolve({ user, token }), searchParams: Promise.resolve({}) })) as {
      props: { title: string; body: string; actions: { href: string }[] };
    };
    expect(page.props.title).toBe("This link no longer works");
    expect(page.props.body).toContain("already been used");
    expect(page.props.actions[0].href).toBe(`/${user}`);
  });

  test("an expired token is refused", async () => {
    const user = makeJournal();
    makeTrip(user);
    await requestDeletion({ kind: "journal", username: user });
    const token = takeToken(user);

    const { db } = await getDatabase();
    await db
      .updateTable("deletion_requests")
      .set({ expires_at: new Date(Date.now() - DELETION_TTL_MS).toISOString() })
      .execute();

    expect(await resolveDeletionToken(user, token)).toMatchObject({ ok: false, reason: "expired" });
    const response = await confirmRoute.POST(
      new Request(`https://t.test/api/v1/${user}/deletions/${token}`, { method: "POST" }),
      { params: Promise.resolve({ user, token }) },
    );
    expect(response.status).toBe(409);
    expect(userExists(user)).toBe(true);

    // And the person following the dead link reads a sentence, not a 404.
    const page = (await DeletePage({ params: Promise.resolve({ user, token }), searchParams: Promise.resolve({}) })) as {
      props: { title: string; body: string };
    };
    expect(page.props.title).toBe("This link no longer works");
    expect(page.props.body).toContain("60 minutes");
  });

  test("a token issued for one journal will not delete another", async () => {
    const anna = makeJournal("anna");
    const bruno = makeJournal("bruno");
    makeTrip(anna);
    makeTrip(bruno);
    await requestDeletion({ kind: "journal", username: anna });
    const annasToken = takeToken(anna);

    expect(await resolveDeletionToken(bruno, annasToken)).toMatchObject({
      ok: false,
      reason: "unknown",
    });
    const response = await confirmRoute.POST(
      new Request(`https://t.test/api/v1/${bruno}/deletions/${annasToken}`, { method: "POST" }),
      { params: Promise.resolve({ user: bruno, token: annasToken }) },
    );
    expect(response.status).toBe(404);
    expect(userExists(bruno)).toBe(true);
    expect(userExists(anna)).toBe(true);

    // Pasted under the wrong journal, it explains rather than 404s.
    const page = (await DeletePage({
      params: Promise.resolve({ user: bruno, token: annasToken }),
      searchParams: Promise.resolve({}),
    })) as { props: { title: string; actions: { href: string }[] } };
    expect(page.props.title).toBe("This link no longer works");
    expect(page.props.actions[0].href).toBe(`/${bruno}`);
  });

  test("it hands over the complete export, private trips and drafts included", async () => {
    const user = makeJournal();
    // Explicit, so this test proves what it claims regardless of B306: a
    // trip's default now follows its journal (`makeJournal` above leaves it
    // `public`), so this has to ask for `private` to be the thing an
    // anonymous export would not otherwise have carried.
    const trip = makeTrip(user, "japan-2027", "private");
    writeDay(user, trip, "kyoto-in-the-rain");
    await requestDeletion({ kind: "journal", username: user });
    const token = takeToken(user);

    const response = await deletionExport(new Request("https://t.test/x"), {
      params: Promise.resolve({ user, token }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(getTrip(tripRef(user, trip))?.visibility).toBe("private");
    expect(bytes.toString("latin1")).toContain(`trips/${trip}/entries/`);
    // Reading the copy does not spend the link.
    expect(await resolveDeletionToken(user, token)).toMatchObject({ ok: true });
  });
});

describe("deleting a journal", () => {
  /**
   * One row in every table, discovered rather than listed.
   *
   * The point of the assertion below is that it does not rot when a table is
   * added, so the seeding must not either: the columns are read off the
   * database, and every non-nullable one without a default is filled.
   */
  async function seedEveryTable(username: string): Promise<void> {
    const { db } = await getDatabase();
    const tables = await db.introspection.getTables();
    let n = 0;
    // `sessions.user_id` is a real foreign key onto `users.id`, so the users
    // row has to exist first — which it does, because TABLE_NAMES is in
    // dependency order.
    const seeded: Record<string, string> = {};
    for (const name of TABLE_NAMES) {
      const meta = tables.find((t) => t.name === name);
      if (!meta) throw new Error(`no such table: ${name}`);
      seeded[name] = `seed-${name}-${n++}`;
      const columns: string[] = [];
      const values: unknown[] = [];
      for (const column of meta.columns) {
        // `id` always, whatever the introspection says: SQLite reports a text
        // primary key as nullable, and a users row with a null id fails every
        // foreign key pointing at it.
        if (column.name !== "id" && (column.isNullable || column.hasDefaultValue)) continue;
        columns.push(column.name);
        if (column.name === "owner_id") values.push(username);
        else if (column.name === "id") values.push(seeded[name]);
        // `sessions.user_id` and `access_grants.contact_id` are real foreign
        // keys. Resolved by convention (`<thing>_id` -> the `<thing>s` table)
        // rather than by a list, so a new one does not silently break the
        // seeding this whole assertion depends on.
        else if (column.name.endsWith("_id") && seeded[`${column.name.slice(0, -3)}s`])
          values.push(seeded[`${column.name.slice(0, -3)}s`]);
        else if (/int|real|double|numeric|float/i.test(column.dataType)) values.push(1);
        else values.push("x");
      }
      try {
        await sql`insert into ${sql.table(name)} (${sql.join(columns.map((c) => sql.ref(c)))}) values (${sql.join(values.map((v) => sql.lit(v as string)))})`.execute(db);
      } catch (err) {
        throw new Error(`seeding ${name} (${columns.join(",")}) = ${JSON.stringify(values)}: ${String(err)}`);
      }
    }
  }

  async function rowsNaming(username: string): Promise<Record<string, number>> {
    const { db } = await getDatabase();
    const counts: Record<string, number> = {};
    for (const name of TABLE_NAMES) {
      const result = await sql<{ n: number }>`select count(*) as n from ${sql.table(name)} where owner_id = ${username}`.execute(db);
      counts[name] = Number(result.rows[0].n);
    }
    return counts;
  }

  test("takes the folder and every row in every table with it", async () => {
    const user = makeJournal();
    const trip = makeTrip(user);
    writeDay(user, trip, "kyoto-in-the-rain");
    await seedEveryTable(user);

    // Every table really did have a row naming this journal, or the assertion
    // afterwards would pass for the wrong reason.
    const before = await rowsNaming(user);
    for (const name of TABLE_NAMES) expect(`${name}=${before[name]}`).toBe(`${name}=1`);

    await requestDeletion({ kind: "journal", username: user });
    const token = takeToken(user);
    const done = await confirmDeletion(user, token);
    expect(done).toMatchObject({ ok: true, kind: "journal" });

    expect(fs.existsSync(path.join(dir, user))).toBe(false);
    expect(userExists(user)).toBe(false);

    // The check that will not rot as tables are added: nothing, anywhere,
    // still names this journal.
    const after = await rowsNaming(user);
    for (const name of TABLE_NAMES) expect(`${name}=${after[name]}`).toBe(`${name}=0`);
  });

  test("leaves a tombstone, keeps the name, and answers 410 on the old URLs", async () => {
    const user = makeJournal();
    makeTrip(user);
    await requestDeletion({ kind: "journal", username: user });
    await confirmDeletion(user, takeToken(user));

    const stone = journalTombstone(user);
    expect(stone).toMatchObject({ kind: "journal", username: user, title: "Anna's journal" });
    expect(stone?.requestedBy).toBe(OWNER);

    // The name is not handed back.
    const again = createJournal({
      username: user,
      title: "Somebody else",
      ownerEmail: "other@example.test",
      ownerName: "Other Person",
      ownerNickname: "Other",
    });
    expect(again).toMatchObject({ ok: false, error: "deleted_username" });

    for (const url of [
      `https://t.test/${user}`,
      `https://t.test/${user}/trips/japan-2027`,
      `https://t.test/${user}/documentation.txt`,
    ]) {
      const response = proxy(new NextRequest(new Request(url)));
      expect(`${url} -> ${response?.status}`).toBe(`${url} -> 410`);
      expect(await response!.text()).toContain("This journal has been deleted");
    }

    // A journal that was never here still answers 404, not 410.
    expect(proxy(new NextRequest(new Request("https://t.test/nobody")))?.status).not.toBe(410);
  });

  test("the API answers 410 rather than 404 for a journal that has gone", async () => {
    const user = makeJournal();
    makeTrip(user);
    const token = await tokenFor(user, OWNER);
    await requestDeletion({ kind: "journal", username: user });
    await confirmDeletion(user, takeToken(user));

    const response = await deleteJournalRoute(request(`https://t.test/api/v1/${user}`, token), {
      params: Promise.resolve({ user }),
    });
    expect(response.status).toBe(410);
  });
});

describe("deleting a trip", () => {
  test("takes its media, and leaves the rest of the journal alone", async () => {
    const user = makeJournal();
    const going = makeTrip(user, "japan-2027");
    const staying = makeTrip(user, "peru-2028");
    writeDay(user, going, "kyoto-in-the-rain");
    writeDay(user, staying, "lima-at-dusk");

    const summary = summarise({ kind: "trip", username: user, tripId: going });
    expect(summary?.files).toBeGreaterThan(1);

    await requestDeletion({ kind: "trip", username: user, tripId: going });
    const done = await confirmDeletion(user, takeToken(user));
    expect(done).toMatchObject({ ok: true, kind: "trip", tripId: going });

    expect(fs.existsSync(path.join(dir, user, "trips", going))).toBe(false);
    expect(fs.existsSync(path.join(dir, user, "trips", going, "media"))).toBe(false);

    // Everything else is exactly where it was.
    expect(userExists(user)).toBe(true);
    expect(getUser(user)?.title).toBe("Anna's journal");
    expect(getTrips(user).map((t) => t.id)).toEqual([staying]);
    expect(
      fs.existsSync(path.join(dir, user, "trips", staying, "media", "lima-at-dusk.jpg")),
    ).toBe(true);
    expect(journalTombstone(user)).toBeNull();
  });

  test("its rows go with it, and the journal's others stay", async () => {
    const user = makeJournal();
    const going = makeTrip(user, "japan-2027");
    const staying = makeTrip(user, "peru-2028");

    const { db } = await getDatabase();
    for (const trip of [going, staying]) {
      await db
        .insertInto("reactions")
        .values({
          id: `r-${trip}`,
          owner_id: user,
          trip_id: trip,
          day_slug: "a-day",
          voter_id: "v",
          emoji: "❤",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
    }

    await requestDeletion({ kind: "trip", username: user, tripId: going });
    await confirmDeletion(user, takeToken(user));

    const left = await db.selectFrom("reactions").select("trip_id").execute();
    expect(left.map((r) => r.trip_id)).toEqual([staying]);
  });

  test("old trip URLs answer 410, and the rest of the journal still renders", async () => {
    const user = makeJournal();
    const going = makeTrip(user, "japan-2027");
    await requestDeletion({ kind: "trip", username: user, tripId: going });
    await confirmDeletion(user, takeToken(user));

    expect(tripTombstone(user, going)).toMatchObject({ kind: "trip", title: "Japan" });
    const gone = proxy(new NextRequest(new Request(`https://t.test/${user}/trips/${going}`)));
    expect(gone?.status).toBe(410);
    expect(await gone!.text()).toContain("This journey has been deleted");

    // The journal itself is not gone, so it must not answer 410.
    expect(proxy(new NextRequest(new Request(`https://t.test/${user}`)))?.status).not.toBe(410);
  });
});

describe("the mail is the gate", () => {
  test("a session that asked cannot finish it — only the link can", async () => {
    const user = makeJournal();
    makeTrip(user);
    const asking = await session(user, OWNER);
    const asked = await requestDeletion({ kind: "journal", username: user }, { sessionId: asking.id });
    expect(asked.ok).toBe(true);

    // The token is nowhere in the reply. It exists in the mailbox and, as a
    // hash, in the database — and nowhere else. That is the whole design.
    const token = takeToken(user);
    expect(JSON.stringify(asked)).not.toContain(token);

    const { db } = await getDatabase();
    const row = await db.selectFrom("deletion_requests").selectAll().executeTakeFirst();
    expect(row?.token_hash).not.toBe(token);
    expect(row?.requested_by).toBe(asking.id);
    expect(userExists(user)).toBe(true);
  });
});

/**
 * B374 — a balance dies with the journal, silently, unless the mail and the
 * page both say so before the button.
 */
describe("credits are named before they are lost", () => {
  async function renderedPage(user: string, token: string): Promise<string> {
    const rendered = await DeletePage({
      params: Promise.resolve({ user, token }),
      searchParams: Promise.resolve({}),
    });
    return renderToStaticMarkup(rendered as Parameters<typeof renderToStaticMarkup>[0]);
  }

  test("a balance of 180 is named in the mail and on the page", async () => {
    const user = makeJournal();
    makeTrip(user);
    serverConfigWithCredits(true);
    await grant(user, 180, "test");

    const asked = await requestDeletion({ kind: "journal", username: user });
    expect(asked.ok).toBe(true);
    expect(mailBody(user)).toContain("180");

    const token = takeToken(user);
    expect(await renderedPage(user, token)).toContain("180");
  });

  test("a balance of zero says nothing about credits", async () => {
    const user = makeJournal();
    makeTrip(user);
    serverConfigWithCredits(true);
    // No grant: the journal's balance is zero, the same as every journal
    // starts with.

    await requestDeletion({ kind: "journal", username: user });
    expect(mailBody(user)).not.toMatch(/credit/i);

    const token = takeToken(user);
    expect(await renderedPage(user, token)).not.toMatch(/credit/i);
  });

  test("credits switched off says nothing, even over a balance granted before the switch", async () => {
    const user = makeJournal();
    makeTrip(user);
    serverConfigWithCredits(true);
    await grant(user, 50, "test");
    serverConfigWithCredits(false);

    await requestDeletion({ kind: "journal", username: user });
    expect(mailBody(user)).not.toMatch(/credit/i);

    const token = takeToken(user);
    expect(await renderedPage(user, token)).not.toMatch(/credit/i);
  });

  test("deleting a trip never mentions credits — a trip destroys none", async () => {
    const user = makeJournal();
    const trip = makeTrip(user);
    serverConfigWithCredits(true);
    await grant(user, 90, "test");

    await requestDeletion({ kind: "trip", username: user, tripId: trip });
    expect(mailBody(user)).not.toMatch(/credit/i);

    const token = takeToken(user);
    expect(await renderedPage(user, token)).not.toMatch(/credit/i);
  });
});

/**
 * B293 — the two verbs a real agent guessed, and what they say now.
 *
 * Both routes answered a bare `405` with no body. The agent that got one could
 * not tell "wrong verb" from "wrong path" from "not built", and went on to
 * offer its owner a web interface that does not exist. These are not
 * deletion tests; they live here because this is the file that already holds
 * these two route modules.
 */
describe("a verb these routes do not have", () => {
  test("PATCH on a journal points at the config door", async () => {
    const response = await patchJournalRoute(new Request("https://x.test/api/v1/alex"), {
      params: Promise.resolve({ user: "alex" }),
    } as never);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("DELETE");
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("method_not_allowed");
    expect(body.message).toContain("/api/v1/alex/config");
    expect(body.message).toContain("features are not writable");
  });

  test("PATCH on a trip points at the budget, the day and the media doors", async () => {
    const response = await patchTripRoute(new Request("https://x.test/api/v1/alex/trips/alps"), {
      params: Promise.resolve({ user: "alex", trip: "alps" }),
    } as never);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("DELETE");
    const body = (await response.json()) as { error: string; message: string };
    expect(body.message).toContain("/api/v1/alex/trips/alps/costs");
    expect(body.message).toContain("/api/v1/alex/trips/alps/days/<slug>");
    expect(body.message).toContain("/api/v1/alex/trips/alps/media");
  });
});
