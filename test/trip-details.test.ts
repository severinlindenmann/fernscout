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

type Body = {
  ok?: boolean;
  error?: string;
  message?: string;
  title?: string;
  tagline?: string;
  translations?: Record<string, { title?: string; tagline?: string }>;
  visibility?: string;
  accent?: string;
  costsVisibility?: string;
  intro?: string;
};

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

/** A day with a gallery, so a `cover` can name a real photo — and a draft
 * one, so `AS_AUTHOR` covering it is exercised too. */
const ENTRY_MD = [
  "---",
  'title: "Over the Susten"',
  'date: "2024-09-12"',
  'status: "draft"',
  'location: "Susten Pass"',
  'country: "Switzerland"',
  'countryCode: "CH"',
  "gallery:",
  '  - src: "/media/alps-2024/over-the-susten/01.jpg"',
  '    type: "image"',
  "---",
  "",
  "The pass, from the top.",
  "",
].join("\n");

function entryFile(): string {
  return path.join(dir, OWNER, "trips", TRIP, "entries", "2024-09-12-over-the-susten.md");
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
      locales: ["en", "de"],
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
  fs.writeFileSync(entryFile(), ENTRY_MD);
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
    // `invalid_date` rather than a code of its own: lib/api/errorCodes.ts
    // already says "a date is not a real calendar date, or `end` is before
    // `start`", which is both of this route's date refusals.
    expect(refused.body.error).toBe("invalid_date");
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('end: "2024-09-14"');
  });

  test("a date that is not one", async () => {
    const refused = await patch({ start: "11.09.2024" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_date");
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

/**
 * B622 — the same four fields, through the door an agent uses.
 *
 * `PATCH /api/v1/{user}/trips/{trip}` was a `405` that named every other door
 * and apologised for this one. It now calls the same `patchTripDetails` the
 * browser's `/api/trip` does, so the rules cannot differ between them — what
 * this file's cases above pin for one is true of both.
 */
describe("the agent's door onto the same four fields", () => {
  async function v1(
    body: Record<string, unknown>,
    token?: string,
    trip = TRIP,
  ): Promise<{ status: number; body: Body }> {
    const { PATCH } = await import("@/app/api/v1/[user]/trips/[trip]/route");
    const response = await PATCH(
      new Request(`https://example.test/api/v1/${OWNER}/trips/${trip}`, {
        method: "PATCH",
        headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: OWNER, trip }) },
    );
    return { status: response.status, body: (await response.json()) as Body };
  }

  test("the owner renames a trip and reads it back", async () => {
    const saved = await v1({ title: "Algarve 2026" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.title).toBe("Algarve 2026");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.title).toBe("Algarve 2026");
  });

  test("a body naming none of the writable fields is refused, not silently accepted", async () => {
    const refused = await v1({ status: "current" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("nothing_to_change");
  });

  test("a trip-scoped token writes days into the trip and cannot rename it", async () => {
    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    // The fixture's `people:` carries this address, which is what entitles it
    // to a trip-scoped token at all — and, this test's point, to nothing
    // beyond writing days into the journey.
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: TRIP });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(TRIP));
    if (!result.ok) throw new Error(`no trip token: ${result.reason}`);

    const refused = await v1({ title: "Not yours" }, result.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("out_of_scope");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.title).not.toBe("Not yours");
  });

  test("a trip that does not exist answers the same as one this token may not touch", async () => {
    const missing = await v1({ title: "x" }, await tokenFor(OWNER_EMAIL), "no-such-trip");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("unknown_trip");
  });
});

/**
 * B245 — the fifth field, `cover`, on the same door.
 *
 * The last field of a trip with no write door anywhere. Unlike the other
 * four, a bad value does not merely fail to parse — it would render as a
 * broken image on the trips index and the OG card — so it is checked against
 * the trip's own gallery rather than only against its shape.
 */
describe("the fifth field, cover", () => {
  async function v1(
    body: Record<string, unknown>,
    token?: string,
  ): Promise<{ status: number; body: Body & { cover?: string } }> {
    const { PATCH } = await import("@/app/api/v1/[user]/trips/[trip]/route");
    const response = await PATCH(
      new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}`, {
        method: "PATCH",
        headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    return { status: response.status, body: (await response.json()) as Body & { cover?: string } };
  }

  test("a cover naming a real photo is written and read back", async () => {
    const saved = await v1(
      { cover: `/${OWNER}/media/alps-2024/over-the-susten/01.jpg` },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.cover).toBe(`/${OWNER}/media/alps-2024/over-the-susten/01.jpg`);

    // Written trip-relative on disk, like every other cover.
    expect(fs.readFileSync(tripFile(), "utf8")).toContain(
      'cover: "/media/alps-2024/over-the-susten/01.jpg"',
    );

    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.cover).toBe(`/${OWNER}/media/alps-2024/over-the-susten/01.jpg`);
  });

  test("the cover may name a photo still in a draft day — this is the owner's own call", async () => {
    // ENTRY_MD carries `status: draft`; a cover naming its photo must still
    // be accepted, because `patchTripDetails` reads `AS_AUTHOR`.
    const saved = await v1(
      { cover: `/${OWNER}/media/alps-2024/over-the-susten/01.jpg` },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);
  });

  test("a cover naming a photo the trip does not have is refused, not written", async () => {
    const refused = await v1(
      { cover: `/${OWNER}/media/alps-2024/nowhere/nope.jpg` },
      await tokenFor(OWNER_EMAIL),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_cover");
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("cover:");
  });

  test("clearing a cover removes the key rather than writing an empty one", async () => {
    fs.writeFileSync(
      tripFile(),
      TRIP_MD.replace(
        "tagline:",
        'cover: "/media/alps-2024/over-the-susten/01.jpg"\ntagline:',
      ),
    );
    await clearCaches();

    const saved = await v1({ cover: "" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("cover:");
  });
});

/**
 * B907 — `accent`, `costsVisibility` and `intro`, on the same door.
 *
 * `POST .../trips` validated and accepted all three and then nothing ever
 * let them be corrected. `intro` is the prose below the frontmatter rather
 * than a scalar line, so it is the one field here that replaces the whole
 * body instead of splicing one line — proven by asserting every frontmatter
 * key survives byte for byte while the prose changes.
 */
describe("B907's three fields: accent, costsVisibility, intro", () => {
  async function v1(
    body: Record<string, unknown>,
    token?: string,
  ): Promise<{ status: number; body: Body }> {
    const { PATCH } = await import("@/app/api/v1/[user]/trips/[trip]/route");
    const response = await PATCH(
      new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}`, {
        method: "PATCH",
        headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    return { status: response.status, body: (await response.json()) as Body };
  }

  test("a trip's intro can be corrected over the API — the ticket's own acceptance line", async () => {
    const saved = await v1(
      { intro: "Corrected: four days, four passes and rather less rain than remembered." },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.intro).toBe(
      "Corrected: four days, four passes and rather less rain than remembered.",
    );

    const after = fs.readFileSync(tripFile(), "utf8");
    expect(after).toContain("Corrected: four days, four passes");
    expect(after).not.toContain("Four days, three passes and a great deal of rain.");
    // Every frontmatter key, untouched — only the prose changed.
    expect(after).toContain('id: "alps-2024"');
    expect(after).toContain('status: "past"');
    expect(after).toContain('title: "Four days round the Alps"');
    expect(after).toContain('accent: "sky"');
    expect(after).toContain('visibility: "private"');
    expect(after).toContain('  - name: "Ana"');

    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.intro).toBe(
      "Corrected: four days, four passes and rather less rain than remembered.",
    );
  });

  test("an intro can be cleared to empty — a trip may say nothing about itself", async () => {
    const saved = await v1({ intro: "" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.intro).toBe("");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.intro).toBe("");
  });

  test("accent is corrected and read back", async () => {
    const saved = await v1({ accent: "coral" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.accent).toBe("coral");
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("accent: coral");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.accent).toBe("coral");
  });

  test("an unrecognised accent is refused, not written", async () => {
    const refused = await v1({ accent: "purple" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_accent");
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('accent: "sky"');
  });

  test("clearing accent removes the key", async () => {
    const saved = await v1({ accent: "" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("accent:");
  });

  test("costsVisibility narrows to guests, and the line is written", async () => {
    const saved = await v1({ costsVisibility: "guests" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.costsVisibility).toBe("guests");
    expect(fs.readFileSync(tripFile(), "utf8")).toContain("costsVisibility: guests");
    await clearCaches();
    const { getTrip } = await import("@/lib/trips");
    expect(getTrip(`${OWNER}/${TRIP}`)?.costsVisibility).toBe("guests");
  });

  test("costsVisibility cleared back to public writes no line, since absent already reads as public", async () => {
    fs.writeFileSync(tripFile(), TRIP_MD.replace("tagline:", 'costsVisibility: "guests"\ntagline:'));
    await clearCaches();

    const saved = await v1({ costsVisibility: "" }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.costsVisibility).toBe("public");
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("costsVisibility:");
  });

  test("an unrecognised costsVisibility is refused rather than defaulted", async () => {
    const refused = await v1({ costsVisibility: "publik" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_costs_visibility");
  });

  test("a non-string intro is refused", async () => {
    const refused = await v1({ intro: 42 }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_intro");
  });

  test("a trip-scoped token cannot correct the intro either", async () => {
    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: TRIP });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(TRIP));
    if (!result.ok) throw new Error(`no trip token: ${result.reason}`);

    const refused = await v1({ intro: "Not yours to correct" }, result.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("out_of_scope");
  });
});

/**
 * B1496 — the eleventh field, `translations`.
 *
 * The last field `POST .../trips` accepts that had no way back: writable at
 * create, readable on the route's own `GET`, correctable nowhere. A typo in a
 * trip's German title was therefore permanent over the API — and it matters
 * more than most, because whoever reads that title is reading it *instead of*
 * the English one and cannot tell it is wrong.
 *
 * What these pin is that the correction and the create agree. They are the
 * same `translationsBlock`, so the refusals must be the same refusals word for
 * word; a test asserting only that both answer 400 would let a second
 * serialiser into the codebase, which is the same bug one level down.
 */
describe("the eleventh field, translations", () => {
  async function v1(
    body: Record<string, unknown>,
    token?: string,
  ): Promise<{ status: number; body: Body }> {
    const { PATCH } = await import("@/app/api/v1/[user]/trips/[trip]/route");
    const response = await PATCH(
      new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}`, {
        method: "PATCH",
        headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    return { status: response.status, body: (await response.json()) as Body };
  }

  async function read(): Promise<Body> {
    await clearCaches();
    const { GET } = await import("@/app/api/v1/[user]/trips/[trip]/route");
    const response = await GET(
      new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}`, {
        headers: headers({ authorization: `Bearer ${await tokenFor(OWNER_EMAIL)}` }),
      }),
      { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
    );
    return (await response.json()) as Body;
  }

  /** The trip as it was created, with the typo that is the whole ticket. */
  const TYPOED = [
    "---",
    'id: "alps-2024"',
    'title: "Four days round the Alps"',
    'start: "2024-09-10"',
    'end: "2024-09-14"',
    'visibility: "private"',
    "translations:",
    "  de:",
    '    title: "Vier Tage um die Alpn"',
    '    tagline: "eine langsame Runde"',
    "---",
    "",
    "Four days, three passes and a great deal of rain.",
    "",
  ].join("\n");

  test("a typoed German title is corrected and reads back", async () => {
    fs.writeFileSync(tripFile(), TYPOED);
    await clearCaches();

    const saved = await v1(
      { translations: { de: { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde" } } },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.translations).toEqual({
      de: { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde" },
    });
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("Alpn");

    expect((await read()).translations).toEqual({
      de: { title: "Vier Tage um die Alpen", tagline: "eine langsame Runde" },
    });
  });

  test("a block added to a trip that had none lands in the frontmatter, prose untouched", async () => {
    const saved = await v1(
      { translations: { de: { title: "Vier Tage um die Alpen" } } },
      await tokenFor(OWNER_EMAIL),
    );
    expect(saved.status).toBe(200);

    const after = fs.readFileSync(tripFile(), "utf8");
    expect(after).toContain("translations:");
    expect(after).toContain("The second paragraph, which must survive every edit.");
    // Every other key byte for byte — the splice's whole job.
    expect(after).toContain('title: "Four days round the Alps"');
    expect(after).toContain('  - name: "Ana"');
    expect((await read()).translations).toEqual({ de: { title: "Vier Tage um die Alpen" } });
  });

  test("an empty object clears the block and leaves no orphaned children", async () => {
    fs.writeFileSync(tripFile(), TYPOED);
    await clearCaches();

    const saved = await v1({ translations: {} }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.translations).toBeUndefined();

    const after = fs.readFileSync(tripFile(), "utf8");
    expect(after).not.toContain("translations:");
    expect(after).not.toContain("Alpn");
    expect(after).not.toContain("langsame");
    expect((await read()).translations).toBeUndefined();
  });

  test("null clears it too, the convention tagline and cover already follow", async () => {
    fs.writeFileSync(tripFile(), TYPOED);
    await clearCaches();

    const saved = await v1({ translations: null }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(tripFile(), "utf8")).not.toContain("translations:");
  });

  test("the block replaces rather than merges, so a locale left out is gone", async () => {
    fs.writeFileSync(tripFile(), TYPOED);
    await clearCaches();
    await v1(
      { translations: { de: { title: "A" }, en: { title: "B" } } },
      await tokenFor(OWNER_EMAIL),
    );

    await clearCaches();
    const saved = await v1({ translations: { en: { title: "B" } } }, await tokenFor(OWNER_EMAIL));
    expect(saved.status).toBe(200);
    expect(saved.body.translations).toEqual({ en: { title: "B" } });
  });

  test("an invalid block is refused with invalid_translations and writes nothing", async () => {
    const refused = await v1({ translations: "de" }, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_translations");
    expect(fs.readFileSync(tripFile(), "utf8")).toBe(TRIP_MD);
  });

  /**
   * The pin the ticket asks for. Not "both refuse" — *the same refusal*: if
   * these two sentences ever differ, a second serialiser has been written and
   * the correction has stopped agreeing with the create.
   */
  test("a locale the journal does not declare is refused exactly as create refuses it", async () => {
    const block = { fr: { title: "Quatre jours" } };

    const patched = await v1({ translations: block }, await tokenFor(OWNER_EMAIL));
    expect(patched.status).toBe(400);

    const { createTrip } = await import("@/lib/tripWrite");
    const created = createTrip(OWNER, {
      id: "pyrenees-2025",
      title: "Four days round the Pyrenees",
      start: "2025-09-10",
      end: "2025-09-14",
      translations: block,
    });
    expect(created.ok).toBe(false);

    expect(patched.body.error).toBe(created.ok ? undefined : created.error);
    expect(patched.body.message).toBe(created.ok ? undefined : created.message);
    expect(patched.body.error).toBe("invalid_translations");
  });

  test("a trip-scoped token cannot correct a translation", async () => {
    const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: TRIP });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(TRIP));
    if (!result.ok) throw new Error(`no trip token: ${result.reason}`);

    const refused = await v1({ translations: { de: { title: "Nicht deins" } } }, result.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("out_of_scope");
  });
});
