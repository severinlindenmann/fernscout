import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { createDraft, editEntry, publishDraft, type EditInput } from "@/lib/api/entries";
import { getEntryBySlug } from "@/lib/entries";
import { writeTripFixture } from "./fixtures/content";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B266 — editing a day, and the one property that must survive it.
 *
 * An agent that had written fifteen days and was then asked to add
 * coordinates found no editing endpoint, reached for `.../publish` because it
 * was the only verb that touched an existing file, and put all fifteen on the
 * site while reporting them as drafts. What these tests hold the line on:
 *
 *  - a draft stays a draft after a PATCH, and a published day stays
 *    published, whatever the body asks for — `status` included;
 *  - the file is otherwise a textual splice, not a rewrite: unrelated lines,
 *    comments and key order survive.
 */

let dir: string;
const REF = "alex/reise";
const OWNER_EMAIL = "alex@example.test";

function writeTrip() {
  writeTripFixture("alex", {
    id: "reise",
    title: "Reise",
    start: "2026-09-01",
    end: "2026-09-05",
    status: "current",
    visibility: "public",
    intro: "Body.",
  });
}

async function agentToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

/**
 * `slug` from here down is the v2 whole-filename slug (`YYYY-MM-DD-slug`) —
 * these two drive `app/api/v2/.../days/[slug]/route.ts`, which is the v2
 * repoint of the deleted `app/api/v1/.../days/[slug]/route.ts` this file used
 * to import directly. The sections above (`editEntry`) are lib-level and
 * untouched by this: they call `lib/api/entries.ts` directly, never through a
 * route at all — but since B1598 that writes and reads the same on-disk JSON
 * (`dayFromJson`/`dayToJson`) the v2 routes below use, so `writeTrip()`'s
 * fixture is the only trip either half needs.
 */
async function patchDay(token: string, slug: string, body: unknown, ifMatch?: string) {
  const { PATCH } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await PATCH(
    new Request(`https://t.test/api/v2/alex/trips/reise/days/${slug}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(ifMatch ? { "if-match": ifMatch } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, etag: response.headers.get("etag"), body: parsed };
}

async function getDay(token: string, slug: string) {
  const { GET } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const response = await GET(
    new Request(`https://t.test/api/v2/alex/trips/reise/days/${slug}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, etag: response.headers.get("etag"), body: parsed };
}

function v2DayBody(overrides: Record<string, unknown> = {}): Record<string, unknown> & { declined: Record<string, unknown> } {
  return {
    slug: "2026-09-01-erster-tag",
    title: "Erster Tag",
    date: "2026-09-01",
    content: "Ankunft am Morgen.",
    status: "draft",
    location: "Bellinzona",
    country: "Switzerland",
    declined: {
      media: "no photographs attached to this day yet",
      costs: "nothing spent today, tracked elsewhere",
      coordinates: "no position recorded for this day",
      weather: "weather was not asked for this day",
      time: "the exact time of day was not recorded",
      timezone: "no timezone established for this leg",
      countryCode: "no country code named for this day",
      transportMode: "no transport leg happened this day",
      tags: "no tags applied to this day",
      translations: "single-language journal, nothing to translate",
      visibility: "no narrower visibility set for this day",
    },
    ...overrides,
  };
}

async function putV2Day(overrides: Record<string, unknown> = {}) {
  const { PUT } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/route");
  const body = v2DayBody(overrides);
  const slug = String(body.slug);
  const response = await PUT(
    new Request(`https://t.test/api/v2/alex/trips/reise/days/${slug}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${await agentToken()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as Record<string, unknown> };
}

async function publishV2Day(slug: string) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/alex/trips/reise/days/${slug}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${await agentToken()}`, "content-type": "application/json" },
      body: "{}",
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-edit-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "edit-day-test-secret-edit-day-test";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
    }),
  );
  writeTrip();
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

const DRAFT = {
  title: "Erster Tag",
  date: "2026-09-01",
  location: "Bellinzona",
  country: "Switzerland",
  content: "Ankunft am Morgen.",
};

describe("editEntry: state survives an edit, in both directions", () => {
  test("a draft is still a draft after its fields change", () => {
    createDraft(REF, DRAFT);
    const result = editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02 });
    expect(result).toEqual({ ok: true, slug: "erster-tag", status: "draft" });
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBe(true);
  });

  test("a published day is still published after its fields change", () => {
    createDraft(REF, DRAFT);
    publishDraft(REF, "erster-tag");
    const result = editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02 });
    expect(result).toEqual({ ok: true, slug: "erster-tag", status: "published" });
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBeUndefined();
  });

  test("a status smuggled past the type system is not written", () => {
    // EditInput has no `status` field, so this only compiles by lying to the
    // type system — the same shape a JSON body from an untyped caller would
    // take. spliceEntryFields must not read a key it was never told about.
    createDraft(REF, DRAFT);
    const sneaky = { lat: 46.19, lng: 9.02, status: "published" } as EditInput;
    editEntry(REF, "erster-tag", sneaky);
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBe(true);
  });

  test("the new values read back", () => {
    createDraft(REF, DRAFT);
    editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02, location: "Chur" });
    const entry = getEntryBySlug(REF, "erster-tag", { includeDrafts: true });
    expect(entry?.lat).toBe(46.19);
    expect(entry?.lng).toBe(9.02);
    expect(entry?.location).toBe("Chur");
  });
});

describe("editEntry: everything else about the file survives", () => {
  // Under v1's YAML frontmatter, `editEntry` textually spliced the changed
  // lines into an existing file, which is what let a hand-written `#`
  // comment and an arbitrary key order ride through an edit untouched. Under
  // v2 (B1598) a day is JSON — a format with no comment syntax at all — and
  // `editEntry` reads the whole document, applies the edit to the object,
  // and writes it back with `dayToJson`'s fixed key order (documented there:
  // "a diff in git is then always a change in content, never a change in
  // this function's mood"). A hand-written annotation cannot survive that,
  // by design; what the old test's own name was really asserting — that a
  // field the edit did not touch keeps its value, and the file the edit
  // produces is always in the one canonical shape — still holds, and is
  // what the test below checks instead.
  test("an unrelated field keeps its value, and the file is in dayToJson's canonical key order", () => {
    const made = createDraft(REF, { ...DRAFT, tags: ["tessin", "hiking"] });
    if (!made.ok) throw new Error("expected the draft to be written");

    editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02 });
    const after = fs.readFileSync(made.file, "utf8");
    const day = JSON.parse(after) as Record<string, unknown>;

    expect(day.title).toBe("Erster Tag");
    expect(day.location).toBe("Bellinzona");
    expect(day.tags).toEqual(["tessin", "hiking"]);
    expect(day.content).toBe("Ankunft am Morgen.");
    expect(day.coordinates).toEqual({ lat: 46.19, lng: 9.02 });
    // `timezone` is resolved from the coordinates an edit with no zone of its
    // own supplied (B1090), and lands ahead of `coordinates` because that is
    // where `dayToJson` puts it — the file's key order is a function of the
    // document's shape, never of the order fields were edited in.
    // `countryCode` is derived from the country the draft named — B1907, and
    // every writer does it, so an edit that never mentioned a country still
    // writes the file the current writer would write.
    expect(day.countryCode).toBe("CH");
    expect(Object.keys(day)).toEqual([
      "title", "date", "timezone", "location", "country", "countryCode", "coordinates", "content", "tags", "status",
    ]);
  });

  test("travelScene can be set, then cleared back to the default", () => {
    const made = createDraft(REF, DRAFT);
    if (!made.ok) throw new Error("expected the draft to be written");

    editEntry(REF, "erster-tag", { travelScene: "skip" });
    expect(fs.readFileSync(made.file, "utf8")).toContain('"travelScene": "skip"');
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.travelScene).toBe("skip");

    // An empty string clears the key, the same as transportMode does —
    // absent means the default scene again.
    editEntry(REF, "erster-tag", { travelScene: "" });
    expect(fs.readFileSync(made.file, "utf8")).not.toContain("travelScene");
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.travelScene).toBeUndefined();
  });

  test("editing content leaves the rest of the document alone", () => {
    const made = createDraft(REF, DRAFT);
    if (!made.ok) throw new Error("expected the draft to be written");
    editEntry(REF, "erster-tag", { content: "Ein neuer Absatz." });
    const after = fs.readFileSync(made.file, "utf8");
    expect(after).toContain('"title": "Erster Tag"');
    expect(after).toContain('"status": "draft"');
    expect(after).toContain("Ein neuer Absatz.");
    expect(after).not.toContain("Ankunft am Morgen.");
  });

  test("`status: draft` in the prose is not the document's own status key", () => {
    const made = createDraft(REF, {
      ...DRAFT,
      content: "We debated whether status: draft was still the right default.",
    });
    if (!made.ok) throw new Error("expected the draft to be written");
    editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02 });
    const after = fs.readFileSync(made.file, "utf8");
    expect(after).toContain("whether status: draft was still the right default");
    expect(after.match(/^\s*"status":\s*"draft"/m)?.length).toBe(1);
  });
});

describe("PATCH .../days/<slug>: the route", () => {
  test("changes a field on a draft and it is still a draft", async () => {
    await putV2Day();
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", { coordinates: { lat: 46.19, lng: 9.02 } });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ slug: "2026-09-01-erster-tag", status: "draft" });
  });

  test("changes a field on a published day and it is still published", async () => {
    await putV2Day();
    const published = await publishV2Day("2026-09-01-erster-tag");
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", { coordinates: { lat: 46.19, lng: 9.02 } });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ slug: "2026-09-01-erster-tag", status: "published" });
  });

  /**
   * v1 refused `status` outright, whichever value it carried, whenever it
   * conflicted with the day's own state — `unsupported_field`, always. v2's
   * `resolveStatusEcho` (`lib/api/v2/days.ts`) treats the literal `"draft"`
   * as an always-tolerated echo (the same value `dayWrite`'s own `status`
   * field accepts on write), checked BEFORE it is compared against what the
   * day is actually stored as — so a request that supplies `status: "draft"`
   * on an already-published day is silently absorbed as a no-op rather than
   * refused, while `status: "published"` (a value the write schema never
   * accepts at all) is still refused outright. The two tests below are the
   * honest split this produces; there is no single "sending status is
   * refused" test left to write, because sending `status: "draft"` no longer
   * is one.
   */
  test("status: published is refused, and nothing is written", async () => {
    await putV2Day();
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", { status: "published" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
    const read = await getDay(token, "2026-09-01-erster-tag");
    expect(read.body.status).toBe("draft");
  });

  test("status: draft on an already-published day is a tolerated no-op, not a move back to draft", async () => {
    await putV2Day();
    await publishV2Day("2026-09-01-erster-tag");
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", { status: "draft", location: "Chur" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("published");
    expect(body.location).toBe("Chur");
  });

  test("an unknown day is 404", async () => {
    const token = await agentToken();
    const { status } = await patchDay(token, "2026-09-01-no-such-day", { location: "Chur" });
    expect(status).toBe(404);
  });

  test("an empty body is accepted as a genuine no-op, echoing the document unchanged", async () => {
    // v1 refused this outright. v2's merge-patch re-validates the WHOLE
    // merged document on every PATCH regardless of what the patch itself
    // named (the same machinery T6's decline-retraction depends on), and an
    // empty patch merged over an already-complete day is, honestly, still a
    // complete day — there is no separate "you asked for nothing" check left
    // to distinguish that from any other successful PATCH.
    await putV2Day();
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", {});
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.title).toBe("Erster Tag");
  });

  test("an invalid field is refused with the same problems shape as creation", async () => {
    await putV2Day();
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", { coordinates: { lat: "not a number", lng: 9 } });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
    expect(Array.isArray(body.details)).toBe(true);
  });
});

/**
 * B304 — a day's costs held to the same rule B295 gave the trip budget door:
 * a zero or negative amount, and a currency v1's `normalizeCurrency` would
 * not recognise, were refused rather than accepted and silently dropped when
 * the page read them back. v1's message and v2's are no longer the same
 * sentence: `costItem` (`lib/api/v2/schemas/day.ts`) is its own
 * `z.strictObject` — `amount: z.number().positive()`,
 * `currency: z.string().length(3).optional()` — validated by zod directly
 * rather than through `checkCosts`/`lib/validate/entry.ts`'s hand-written
 * message, and the field path zod reports is dotted (`costs.0.amount`), not
 * bracketed (`costs[0].amount`). What survives is the property B304 was
 * actually about: a bad cost amount or currency is refused rather than
 * accepted and silently dropped — not the specific words, which this file no
 * longer has any way to keep in sync with a validator it does not share.
 */
describe("day costs: refused rather than silently dropped (B304)", () => {
  test("PUT refuses a zero-amount cost, naming the field", async () => {
    const created = await putV2Day({ costs: [{ label: "Ferry", amount: 0, currency: "EUR" }] });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("invalid_entry");
    const problems = created.body.details as { field: string }[];
    expect(problems.some((p) => p.field === "costs.0.amount")).toBe(true);
  });

  test("PUT refuses a negative amount the same way", async () => {
    const created = await putV2Day({ costs: [{ label: "Ferry", amount: -5, currency: "EUR" }] });
    expect(created.status).toBe(400);
    const problems = created.body.details as { field: string }[];
    expect(problems.some((p) => p.field === "costs.0.amount")).toBe(true);
  });

  test("PUT refuses an unrecognisable currency, naming the field", async () => {
    const created = await putV2Day({ costs: [{ label: "Ferry", amount: 40, currency: "Euros" }] });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("invalid_entry");
    const problems = created.body.details as { field: string }[];
    expect(problems.some((p) => p.field === "costs.0.currency")).toBe(true);
  });

  test("PATCH refuses the same shape, and writes nothing", async () => {
    await putV2Day();
    const token = await agentToken();
    const { status, body } = await patchDay(token, "2026-09-01-erster-tag", {
      costs: [{ label: "Taxi", amount: 0, currency: "CHF" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
    const problems = body.details as { field: string }[];
    expect(problems.some((p) => p.field === "costs.0.amount")).toBe(true);
    const read = await getDay(token, "2026-09-01-erster-tag");
    expect(read.body.costs).toBeUndefined();
  });
});

/**
 * B540 — three bugs an agent following only `/agent.md` and `/openapi.json`
 * reproduced against a running instance, none of them found by reading the
 * source. Bugs 2 and 3 (an unrecognised `travelScene` silently written and
 * read back as absent; a `captions` map keyed by a src the day does not
 * have) have no v2 counterpart: v2's `travelScene` is a closed
 * `z.enum(TRAVEL_SCENE_VARIANTS)` refused outright at write time rather than
 * accepted and normalised on read, and `captions` as a separate PATCH field
 * does not exist at all — a v2 media item carries its own `caption` inline
 * (`dayMediaItem` in `lib/api/v2/schemas/day.ts`), addressed by the array
 * item rather than by a src-keyed map. Both bugs were about a write that
 * looked like it worked and quietly did not; v2 closes that a different way
 * (refuse a bad `travelScene` outright; there is no map left to key wrong),
 * so there is nothing left in the old shape to prove. Bug 1 (a set value
 * missing from the read) still applies and is repointed below.
 */
describe("GET .../days/<slug>: travelScene and weather read back (B540 bug 1)", () => {
  test("a travelScene set on the day is in the response", async () => {
    await putV2Day({ travelScene: "skip" });
    const token = await agentToken();
    const { body } = await getDay(token, "2026-09-01-erster-tag");
    expect(body.travelScene).toBe("skip");
  });

  test("a weather reading on the day is in the response, with its provenance", async () => {
    await putV2Day({
      coordinates: { lat: 46.19, lng: 9.02 },
      weather: { tempMax: 21, source: "a postcard from the trip", recordedAt: "2026-09-01T12:00:00Z" },
      declined: { ...v2DayBody().declined, coordinates: undefined, weather: undefined },
    });
    const token = await agentToken();
    const { body } = await getDay(token, "2026-09-01-erster-tag");
    expect(body.weather).toEqual({
      tempMax: 21,
      source: "a postcard from the trip",
      recordedAt: "2026-09-01T12:00:00Z",
    });
  });

  test("a day with neither carries neither key", async () => {
    await putV2Day();
    const token = await agentToken();
    const { body } = await getDay(token, "2026-09-01-erster-tag");
    expect(body.travelScene).toBeUndefined();
    expect(body.weather).toBeUndefined();
  });
});

describe("an unrecognised travelScene is refused outright — v2 has no bug 2 to reproduce", () => {
  test("PUT refuses it, rather than writing it and reading it back as absent", async () => {
    const created = await putV2Day({ travelScene: "sunrise-over-the-lake" });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe("invalid_entry");
  });
});
