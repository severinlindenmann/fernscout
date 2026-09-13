import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * `GET /api/v1/<user>/status` — B91.
 *
 * The call an agent makes first, and the reason it exists is not the saved
 * round trips. It is that an agent with no cheap way to orient either skips
 * orienting — and writes a fourth day on top of three already waiting for
 * approval — or reconstructs the picture differently every time.
 *
 * So the assertions are about what an agent would *act on*: that the queue is
 * there with the call that publishes each item, that a capability which is off
 * says so rather than going missing, and that a trip-scoped token is told in
 * words that it is holding a slice. The last one is the dangerous case — an
 * agent that cannot tell a slice from the whole will report "this journal has
 * one trip" to somebody who has two.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const ROBIN = "robin@example.test";

let dir: string;

let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.4.0.${calls % 250}`,
    ...extra,
  };
}

function writeTrip(id: string, people: string[]) {
  writeTripFixture(OWNER, {
    id,
    title: id,
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "public",
    people: people.map((email) => ({ name: "R", email })),
  });
}

/** A day on disk, draft or published, as ingest or an agent would leave it. */
function writeDay(trip: string, slug: string, draft: boolean) {
  writeDayFixture(dir, OWNER, trip, {
    slug,
    date: "2026-08-25",
    location: "Somewhere",
    country: "Switzerland",
    coordinates: { lat: 47.0, lng: 8.0 },
    status: draft ? "draft" : undefined,
    content: "Something happened.",
  });
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function tripToken(email: string, trip: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { tripWriteScope } = await import("@/lib/tripPeople");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  const result = await verifyCode(OWNER, email, code, "agent", tripWriteScope(trip));
  if (!result.ok) throw new Error(`no token for ${email} on ${trip}`);
  return result.token;
}

type StatusBody = {
  user?: string;
  error?: string;
  scope?: { kind: string; trips?: string[]; note?: string };
  journal?: { url: string; title: string | null; locale: string | null };
  drafts?: { count: number; items: { slug: string; trip: string; publish: string }[] };
  trips?: { id: string }[];
  features?: Record<string, { enabled: boolean; reason?: string }>;
  invites?: string;
  credits?: unknown;
  pricing?: unknown;
  next?: string;
};

async function status(token?: string): Promise<{ status: number; body: StatusBody }> {
  const { GET } = await import("@/app/api/v1/[user]/status/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${OWNER}/status`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as StatusBody };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-status-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      // `postcards` deliberately left off, which is the default: an agent has
      // to be able to see that it is off and why.
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en", "de"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );

  writeTrip("asia-2026", [ROBIN]);
  writeTrip("alps-2026", []);
  writeDay("asia-2026", "a-draft", true);
  writeDay("asia-2026", "published", false);
  writeDay("alps-2026", "another-draft", true);

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("status, with no token", () => {
  test("answers 401, which is the guide's `am I signed in` check", async () => {
    const { status: code, body } = await status();
    expect(code).toBe(401);
    expect(body.error).toBeTruthy();
  });
});

describe("status, for the journal's owner", () => {
  test("answers the four calls it replaces in one", async () => {
    const { status: code, body } = await status(await ownerToken());
    expect(code).toBe(200);
    expect(body.journal?.url).toBe("https://example.test/ana");
    expect(body.journal?.title).toBe("Two Backpacks");
    expect(body.journal?.locale).toBe("en");
    expect(body.trips?.map((t) => t.id).sort()).toEqual(["alps-2026", "asia-2026"]);
    expect(body.drafts?.count).toBe(2);
    expect(body.features).toBeTruthy();
    expect(body.next).toBeTruthy();
  });

  test("every draft carries the call that publishes it, and nothing else does", async () => {
    const { body } = await status(await ownerToken());
    const draft = body.drafts?.items.find((d) => d.slug === "a-draft");
    expect(draft?.trip).toBe("ana/asia-2026");
    expect(draft?.publish).toBe(
      "POST https://example.test/api/v1/ana/trips/asia-2026/days/a-draft/publish",
    );
    // The published day is not in the queue — the queue is what is waiting.
    expect(body.drafts?.items.some((d) => d.slug === "published")).toBe(false);
  });

  test("says what to do, and it is the drafts rather than a new day", async () => {
    const { body } = await status(await ownerToken());
    expect(body.next).toContain("not on the site");
    // The one thing an agent must not conclude on its own.
    expect(body.next).toContain("Never publish because it looks finished");
  });

  test("is holding the whole journal, and says so", async () => {
    const { body } = await status(await ownerToken());
    expect(body.scope?.kind).toBe("journal");
    expect(body.scope?.note).toBeUndefined();
  });
});

describe("status, for a token scoped to one trip", () => {
  test("returns that trip's slice and no other trip", async () => {
    const { status: code, body } = await status(await tripToken(ROBIN, "asia-2026"));
    expect(code).toBe(200);
    expect(body.trips?.map((t) => t.id)).toEqual(["asia-2026"]);
    expect(body.drafts?.items.map((d) => d.slug)).toEqual(["a-draft"]);
  });

  test("is told in words that it is a slice, so it cannot report it as the total", async () => {
    const { body } = await status(await tripToken(ROBIN, "asia-2026"));
    expect(body.scope?.kind).toBe("trip");
    expect(body.scope?.trips).toEqual(["ana/asia-2026"]);
    expect(body.scope?.note).toContain("not the whole of it");
  });
});

describe("what status says about this server", () => {
  test("a capability that is off is reported as off, with the reason", async () => {
    const { body } = await status(await ownerToken());
    expect(body.features?.postcards?.enabled).toBe(false);
    expect(body.features?.postcards?.reason).toContain("not enabled on this server");
  });

  test("credits are absent when this server does not bill", async () => {
    // Off is this suite's default (the shared config never enables credits), so
    // there is no balance to state — a `credits` key here would read as an
    // empty account rather than as a server that does not charge. B366/B397.
    const { body } = await status(await ownerToken());
    // No balance block — there is no account to state.
    expect(body).not.toHaveProperty("credits");
    // But the capability is still reported off with a reason, the same shape
    // as postcards above, so an agent can tell "off" from "not a concept".
    expect(body.features?.credits?.enabled).toBe(false);
    expect(body.features?.credits?.reason).toBeTruthy();
  });

  test("credits are reported on though the journal never opts in — B397", async () => {
    // Server-only: a journal cannot set `credits` in its own config, so
    // resolving it per-journal used to answer "not enabled by <user>" beside a
    // live balance. Turn the server switch on and confirm status reports the
    // capability enabled and carries the balance, from the journal config as
    // it stands — credits unmentioned.
    const configPath = path.join(dir, "config.json");
    const saved = fs.readFileSync(configPath, "utf8");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        site: { name: "R", url: "https://example.test", defaultUser: OWNER },
        users: { reserved: [] },
        features: { auth: { enabled: true }, credits: { enabled: true } },
      }),
    );
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    clearConfigCache();
    clearUserCache();
    try {
      const { body } = await status(await ownerToken());
      expect(body.features?.credits).toEqual({ enabled: true });
      // The balance block is present (owner, not trip-scoped), at zero — no
      // grant was made — which is a real number, not the "absent" of off.
      expect(body.credits).toMatchObject({ balance: 0 });
    } finally {
      fs.writeFileSync(configPath, saved);
      clearConfigCache();
      clearUserCache();
    }
  });

  test("no invite link where contacts is off, because there is no queue to land in", async () => {
    const { body } = await status(await ownerToken());
    expect(body.invites).toBeUndefined();
  });
});

/**
 * B1612 repoint: v1's `GET /api/v1/{user}/drafts` is deleted — "one function,
 * not two" is now trivially true, since there is only the one function left
 * (`lib/api/v2/status.ts`'s `buildJournalStatus`). What is worth pinning
 * instead is that v2's own status route (`GET /api/v2/{user}/status`) carries
 * the same drafts this fixture's v1 queue used to list, in its own shape
 * (`{trip, slug}[]`, no nested `{count, items}`, no `publish` URL — see
 * `lib/api/v2/schemas/status.ts`).
 */
describe("the drafts shape, folded into v2 status", () => {
  test("v2 status carries the same drafts as the v1 queue used to, in its own shape", async () => {
    const token = await ownerToken();
    const { GET } = await import("@/app/api/v2/[user]/status/route");
    const response = await GET(
      new Request(`https://example.test/api/v2/${OWNER}/status`, {
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { drafts: { trip: string; slug: string }[] };
    expect(body.drafts.map((d) => `${d.trip}/${d.slug}`).sort()).toEqual(
      // The full filename stem, not the bare slug — B1633. This is the slug
      // an agent can hand straight back to the day route; the bare form it
      // used to carry answered 404 there.
      ["alps-2026/2026-08-25-another-draft", "asia-2026/2026-08-25-a-draft"],
    );
  });
});
