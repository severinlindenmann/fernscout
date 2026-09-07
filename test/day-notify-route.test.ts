import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { requestContact, confirmContact, approveContact } from "@/lib/contacts";
import { issueCode } from "@/lib/auth";
import { balanceOf } from "@/lib/credits";

/**
 * B633 — the button on a day itself.
 *
 * `test/day-mail.test.ts` already pins everything about what a letter
 * contains and who it reaches; this is only the owner's own door onto it:
 * that it is cookie-only, that it quotes a cost and a balance before
 * spending anything, that a short balance spends nothing, and that a day
 * once sent stops offering the button — the one record nothing else in the
 * codebase kept (see `022-day-notifications`).
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP = "day-trip";
const READER_EMAIL = "reader@example.test";

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

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

function writeUserConfig() {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Notebook",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true } },
    }),
  );
}

function writeTrip(opts: { test?: boolean } = {}) {
  const root = path.join(dir, OWNER, "trips", TRIP);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${TRIP}"`,
      `title: "${TRIP}"`,
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "public"',
      ...(opts.test ? ["test: true"] : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

function writeEntry(opts: { slug: string; draft?: boolean; test?: boolean }): void {
  const entriesDir = path.join(dir, OWNER, "trips", TRIP, "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  fs.writeFileSync(
    path.join(entriesDir, `2026-09-02-${opts.slug}.md`),
    [
      "---",
      'title: "A day"',
      'date: "2026-09-02"',
      'location: "Somewhere"',
      'country: "Nowhere"',
      ...(opts.test ? ["test: true"] : []),
      ...(opts.draft ? ["status: draft"] : []),
      "---",
      "",
      "Something happened.",
      "",
    ].join("\n"),
  );
}

async function addReader(): Promise<void> {
  await requestContact(OWNER, {
    name: "A Reader",
    email: READER_EMAIL,
    locale: "en",
    address: null,
    wantsEmailDigest: true,
    wantsPostcard: false,
    createdVia: "open",
  });
  const { code } = await issueCode(OWNER, READER_EMAIL, "guest");
  const confirmed = await confirmContact(OWNER, READER_EMAIL, code);
  if (!confirmed.ok) throw new Error("confirmation failed");
  await approveContact(OWNER, confirmed.contact.id);
}

function mailFiles(): string[] {
  const box = path.join(dir, "mail", OWNER);
  return fs.existsSync(box) ? fs.readdirSync(box).sort() : [];
}

async function route() {
  return import("@/app/[user]/trips/[trip]/day/[slug]/notify/route");
}

function req(method: string, headers: Record<string, string> = {}) {
  return new Request(`https://t.test/${OWNER}/trips/${TRIP}/day/x/notify`, { method, headers });
}

function paramsFor(slug: string) {
  return { params: Promise.resolve({ user: OWNER, trip: TRIP, slug }) };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-day-notify-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
  process.env.SESSION_SECRET = "day-notify-test-secret-day-notify-test";
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig();
  writeUserConfig();
  writeTrip();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  const session = await import("@/lib/contacts/session");
  isOwnerMock = vi.mocked(session.isOwner);
  isOwnerMock.mockResolvedValue(true);
});

afterEach(async () => {
  await closeDatabase();
  for (const key of [
    "CONTENT_DIR",
    "DATA_DIR",
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
  ]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("a bearer token is refused outright — an agent has POST …/send-mail instead", () => {
  test("GET", async () => {
    const { GET } = await route();
    const response = await GET(req("GET", { authorization: "Bearer whatever" }), paramsFor("x"));
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("POST", async () => {
    const { POST } = await route();
    const response = await POST(req("POST", { authorization: "Bearer whatever" }), paramsFor("x"));
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });
});

test("somebody who is not the owner is refused, cookie or none", async () => {
  isOwnerMock.mockResolvedValue(false);
  writeEntry({ slug: "day-one" });
  const { GET } = await route();
  const response = await GET(req("GET"), paramsFor("day-one"));
  expect(response.status).toBe(403);
});

test("a draft has nothing to offer", async () => {
  writeEntry({ slug: "draft-day", draft: true });
  const { GET } = await route();
  const response = await GET(req("GET"), paramsFor("draft-day"));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe("not_published");
});

test("test content has nothing to offer", async () => {
  writeEntry({ slug: "test-day", test: true });
  const { GET } = await route();
  const response = await GET(req("GET"), paramsFor("test-day"));
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe("test_content");
});

describe("the ordinary path — quote, send, and stop offering it", () => {
  test("shows the button, names the cost, sends once, and then says it was sent", async () => {
    await addReader();
    writeEntry({ slug: "day-one" });

    const { GET, POST } = await route();

    const before = await (await GET(req("GET"), paramsFor("day-one"))).json();
    expect(before).toMatchObject({ ok: true, reachable: true, alreadySent: false, pending: ["mail"] });
    // Credits are off by default (test/credits.test.ts), so nothing is
    // billed and the balance question does not even apply.
    expect(before.balance).toBeNull();
    expect(before.short).toBe(false);

    const sent = await (await POST(req("POST"), paramsFor("day-one"))).json();
    expect(sent.ok).toBe(true);
    // The owner's own free copy (B614) plus the one reader.
    expect(mailFiles()).toHaveLength(2);

    const after = await (await GET(req("GET"), paramsFor("day-one"))).json();
    expect(after).toMatchObject({ ok: true, alreadySent: true, pending: [] });

    // Pressing it again changes nothing and mails nobody a second time.
    const again = await (await POST(req("POST"), paramsFor("day-one"))).json();
    expect(again).toEqual({ ok: true, alreadySent: true });
    expect(mailFiles()).toHaveLength(2);
  });
});

describe("two presses at once", () => {
  test("only one actually sends — the other finds the channel already claimed", async () => {
    await addReader();
    writeEntry({ slug: "day-one" });

    const { POST } = await route();

    // Both requests run `statusFor` before either has recorded anything, so
    // both would see "mail" as pending without the claim in between —
    // `Promise.all` is what makes this an actual race rather than two
    // sequential calls that could never collide.
    const [first, second] = await Promise.all([
      POST(req("POST"), paramsFor("day-one")),
      POST(req("POST"), paramsFor("day-one")),
    ]);
    const bodies = await Promise.all([first.json(), second.json()]);

    // Exactly one of the two actually attempted a send.
    const attempted = bodies.filter((b) => b.mail);
    expect(attempted).toHaveLength(1);
    expect(attempted[0].mail).toMatchObject({ attempted: true });

    // One reader plus the owner's own free copy — never two of each.
    expect(mailFiles()).toHaveLength(2);
  });
});

describe("an empty balance — B840", () => {
  test("a mail-only announcement quotes nothing and goes out anyway", async () => {
    writeServerConfig({ credits: true });
    // No grant at all: a journal with no `credits` row has a balance of
    // zero, which is what every journal starts with (`lib/credits.ts`). This
    // used to quote one credit, answer 402 and send nothing.
    await addReader();
    writeEntry({ slug: "day-one" });

    const { GET, POST } = await route();

    const status = await (await GET(req("GET"), paramsFor("day-one"))).json();
    expect(status).toMatchObject({ ok: true, needed: 0, balance: 0, short: false });

    const response = await POST(req("POST"), paramsFor("day-one"));
    expect(response.status).toBe(200);

    // Sent, and still nothing charged: the reader and the owner both got one.
    expect(await balanceOf(OWNER)).toBe(0);
    expect(mailFiles()).toHaveLength(2);
    const still = await (await GET(req("GET"), paramsFor("day-one"))).json();
    expect(still.alreadySent).toBe(true);
  });
});
