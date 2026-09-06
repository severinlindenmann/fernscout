import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B621 — a trip's `title:`, `tagline:`, `start:` and `end:` after it exists.
 *
 * These four were the last fields of a trip nothing could write, which the
 * `PATCH` on `/api/v1/{user}/trips/{trip}` said out loud in its own refusal:
 * *"A trip's title, dates and cover are still trip.md alone and no call writes
 * them."* So a journey called "Alagrve 2026" needed a shell on the server.
 *
 * What matters most here is not that the four change. It is that everything
 * else in the file does not: `patchTripDetails` splices one frontmatter line
 * at a time, so the prose under the frontmatter, the key order, and every key
 * this form has never heard of have to come back byte for byte.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "guest@example.test";
const TRIP = "alps-2024";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.8.0.${calls % 250}`, ...extra };
}

async function tokenFor(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent");
  const result = await verifyCode(OWNER, email, code, "agent");
  if (!result.ok) throw new Error(`no token for ${email}`);
  return result.token;
}

type Body = { ok?: boolean; error?: string; message?: string; title?: string; tagline?: string; visibility?: string };

async function patch(
  body: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: Body }> {
  const { PATCH } = await import("@/app/api/trip/route");
  const response = await PATCH(
    new Request("https://example.test/api/trip", {
      method: "PATCH",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
      body: JSON.stringify({ user: OWNER, trip: TRIP, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/** A trip.md with prose, an unusual key order, and a key nothing here knows
 * about — all of which a splice has to leave exactly as it found them. */
const TRIP_MD = [
  "---",
  'id: "alps-2024"',
  'status: "past"',
  'title: "Four days round the Alps"',
  'accent: "sky"',
  'start: "2024-09-10"',
  'end: "2024-09-14"',
  'tagline: "one slow loop"',
  'visibility: "private"',
  "people:",
  '  - name: "Ana"',
  '    email: "ana@example.test"',
  "---",
  "",
  "Four days, three passes and a great deal of rain.",
  "",
  "The second paragraph, which must survive every edit.",
  "",
].join("\n");

function tripFile(): string {
  return path.join(dir, OWNER, "trips", TRIP, "trip.md");
}

async function clearCaches() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { clearMatterCache } = await import("@/lib/entries");
  clearConfigCache();
  clearUserCache();
  // `getTrip` reads trip.md through the matter cache, so a file this test
  // just rewrote is otherwise still the parse from before the write.
  clearMatterCache();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-details-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "77".repeat(32);
  process.env.SESSION_SECRET = "88".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

beforeEach(async () => {
  fs.writeFileSync(tripFile(), TRIP_MD);
  await clearCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("what a save changes, and what it must not", () => {
  test("the four fields move and nothing else in the file does", async () => {
    const saved = await patch(
      { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde", start: "2024-09-11", end: "2024-09-15" },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);
    await clearCaches();

    const after = fs.readFileSync(tripFile(), "utf8");
    // The prose, both paragraphs of it.
    expect(after).toContain("Four days, three passes and a great deal of rain.");
    expect(after).toContain("The second paragraph, which must survive every edit.");
    // Keys this form has never heard of, in the order they were written.
    expect(after).toContain('id: "alps-2024"');
    expect(after).toContain('status: "past"');
    expect(after).toContain('accent: "sky"');
    expect(after).toContain('visibility: "private"');
    expect(after).toContain('  - name: "Ana"');
    expect(after.indexOf('status: "past"')).toBeLessThan(after.indexOf('accent: "sky"'));

    const { getTrip } = await import("@/lib/trips");
    const trip = getTrip(`${OWNER}/${TRIP}`);
    expect(trip?.title).toBe("Vier Tage um die Alpen");
    expect(trip?.tagline).toBe("eine langsame Runde");
    expect(trip?.start).toBe("2024-09-11");
    expect(trip?.end).toBe("2024-09-15");
  });

  test("a save touches only the lines it was given", async () => {
    // The whole promise of a splice: a typo fixed in the title must not
    // rewrite three dates that did not change, even into an equivalent form.
    const saved = await patch({ title: "Vier Tage" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    const after = fs.readFileSync(tripFile(), "utf8").split("\n");
    const before = TRIP_MD.split("\n");
    const differing = after.filter((line, i) => line !== before[i]);
    expect(differing).toEqual(['title: "Vier Tage"']);
  });

  test("a title with a colon in it survives, because the value is quoted", async () => {
    // "Japan: end to end" is not valid YAML unquoted, and a person typing a
    // title into a form has no reason to know that.
    const saved = await patch({ title: "Japan: end to end" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.title).toBe("Japan: end to end");
  });

  test("an emptied subtitle takes the key out rather than writing nothing", async () => {
    const saved = await patch({ tagline: "" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("tagline:");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.tagline).toBeUndefined();
  });
});

describe("what is refused", () => {
  test("a cleared title, because a trip.md without one does not load", async () => {
    const refused = await patch({ title: "   " }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_title");
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('title: "Four days round the Alps"');
  });

  test("an end before the start, checked against the result so one date may arrive alone", async () => {
    const refused = await patch({ end: "2024-09-01" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_range");
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('end: "2024-09-14"');
  });

  test("a date that is not one", async () => {
    const refused = await patch({ start: "11.09.2024" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_start");
  });

  test("visibility sent alongside a detail, because each call rewrites trip.md whole", async () => {
    const refused = await patch(
      { title: "Something else", visibility: "public" },
      await tokenFor(OWNER_EMAIL),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("mixed_change");
    const after = fs.readFileSync(tripFile(), "utf8");
    expect(after).toContain('title: "Four days round the Alps"');
    expect(after).toContain('visibility: "private"');
  });

  test("a body naming nothing writable", async () => {
    const refused = await patch({ accent: "coral" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("nothing_to_change");
  });
});

describe("who may do it", () => {
  test("a guest cannot rename somebody else's journey", async () => {
    const refused = await patch({ title: "Mine now" }, await tokenFor(GUEST_EMAIL));
    expect(refused.status).toBe(403);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('title: "Four days round the Alps"');
  });

  test("nobody at all is refused", async () => {
    expect((await patch({ title: "Mine now" })).status).toBe(403);
  });

  test("a trip that does not exist is a 404, not a silent success", async () => {
    const missing = await patch({ trip: "no-such-trip", title: "x" }, await tokenFor(OWNER_EMAIL));
    expect(missing.status).toBe(404);
  });
});

describe("who may read it, through the same door", () => {
  test("the owner can widen it, and is told that is what happened", async () => {
    const saved = await patch({ visibility: "public" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.visibility).toBe("public");
    expect((saved.body as { widened?: boolean }).widened).toBe(true);
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.visibility).toBe("public");
  });

  test("an unrecognised value is refused rather than read as private", async () => {
    const refused = await patch({ visibility: "everyone" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('visibility: "private"');
  });
});
