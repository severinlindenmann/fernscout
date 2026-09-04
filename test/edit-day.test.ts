import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
import { GET as getDayRoute, PATCH as editRoute } from "@/app/api/v1/[user]/trips/[trip]/days/[slug]/route";
import { POST as createRoute } from "@/app/api/v1/[user]/trips/[trip]/days/route";

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
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

async function agentToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

async function patchDay(token: string, slug: string, body: unknown) {
  const response = await editRoute(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: "alex", trip: "reise", slug }) },
  );
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
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
  test("a comment, an unrelated field and the file's key order are untouched", () => {
    const made = createDraft(REF, { ...DRAFT, tags: ["tessin", "hiking"] });
    if (!made.ok) throw new Error("expected the draft to be written");

    // Hand-edit in a comment and reorder nothing — this is the shape a person
    // touching the file themselves would leave behind.
    const before = fs.readFileSync(made.file, "utf8").replace(
      'country: "Switzerland"',
      'country: "Switzerland"\n# ask them for the exact trailhead name',
    );
    fs.writeFileSync(made.file, before);

    editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02 });
    const after = fs.readFileSync(made.file, "utf8");

    expect(after).toContain("# ask them for the exact trailhead name");
    expect(after).toContain('title: "Erster Tag"');
    expect(after).toContain('location: "Bellinzona"');
    expect(after).toContain('tags: ["tessin", "hiking"]');
    expect(after).toContain("Ankunft am Morgen.");
    // The new lines land at the end of the frontmatter, not scattered through
    // the middle of what was already there.
    expect(after).toContain("status: draft\nlat: 46.19\nlng: 9.02");
  });

  test("editing content leaves the frontmatter alone", () => {
    const made = createDraft(REF, DRAFT);
    if (!made.ok) throw new Error("expected the draft to be written");
    editEntry(REF, "erster-tag", { content: "Ein neuer Absatz." });
    const after = fs.readFileSync(made.file, "utf8");
    expect(after).toContain('title: "Erster Tag"');
    expect(after).toContain("status: draft");
    expect(after).toContain("Ein neuer Absatz.");
    expect(after).not.toContain("Ankunft am Morgen.");
  });

  test("`status: draft` in the prose is not the frontmatter's", () => {
    const made = createDraft(REF, {
      ...DRAFT,
      content: "We debated whether status: draft was still the right default.",
    });
    if (!made.ok) throw new Error("expected the draft to be written");
    editEntry(REF, "erster-tag", { lat: 46.19, lng: 9.02 });
    const after = fs.readFileSync(made.file, "utf8");
    expect(after).toContain("whether status: draft was still the right default");
    expect(after.match(/^status:\s*draft\s*$/m)?.length).toBe(1);
  });
});

describe("PATCH .../days/<slug>: the route", () => {
  test("changes a field on a draft and it is still a draft", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", { lat: 46.19, lng: 9.02 });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, slug: "erster-tag", status: "draft" });
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBe(true);
  });

  test("changes a field on a published day and it is still published", async () => {
    createDraft(REF, DRAFT);
    publishDraft(REF, "erster-tag");
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", { lat: 46.19, lng: 9.02 });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, slug: "erster-tag", status: "published" });
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBeUndefined();
  });

  test("sending status on a draft is refused, and nothing is written", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", { status: "published" });
    expect(status).toBe(400);
    expect(body.error).toBe("unsupported_field");
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBe(true);
  });

  test("sending status on a published day is refused, and nothing is written", async () => {
    createDraft(REF, DRAFT);
    publishDraft(REF, "erster-tag");
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", { status: "draft" });
    expect(status).toBe(400);
    expect(body.error).toBe("unsupported_field");
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.draft).toBeUndefined();
  });

  test("status alongside an otherwise valid field refuses the whole request", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", {
      lat: 46.19,
      lng: 9.02,
      status: "published",
    });
    expect(status).toBe(400);
    expect(body.error).toBe("unsupported_field");
    const entry = getEntryBySlug(REF, "erster-tag", { includeDrafts: true });
    expect(entry?.draft).toBe(true);
    expect(entry?.lat).toBeUndefined();
  });

  test("says which state the day was left in, in the response", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { body } = await patchDay(token, "erster-tag", { location: "Chur" });
    expect(typeof body.note).toBe("string");
    expect(body.note as string).toMatch(/draft/i);
  });

  test("an unknown day is 404", async () => {
    const token = await agentToken();
    const { status } = await patchDay(token, "no-such-day", { location: "Chur" });
    expect(status).toBe(404);
  });

  test("an empty body is refused rather than a no-op 200", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status } = await patchDay(token, "erster-tag", {});
    expect(status).toBe(400);
  });

  test("an invalid field is refused with the same problems shape as creation", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", { lat: "not a number" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_entry");
    expect(Array.isArray(body.problems)).toBe(true);
  });
});

/**
 * B304 — a day's costs held to the same rule B295 gave the trip budget door:
 * a zero or negative amount, and a currency `normalizeCurrency` would not
 * recognise, are refused rather than accepted and silently dropped when the
 * page reads them back (`parseCostItems`, lib/costFormat.ts). Both doors
 * share `checkCosts` (lib/validate/entry.ts) now, so the messages match.
 *
 * The one thing these tests hold apart from that: a day already on disk with
 * either mistake — written before this ticket, or by hand — must keep
 * rendering. Reading a day never calls the validator; only a write does.
 */
describe("day costs: the same refusal as the trip budget door (B304)", () => {
  async function createDay(token: string, body: unknown) {
    const response = await createRoute(
      new Request("https://t.test/api/v1/alex/trips/reise/days", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
    const parsed = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body: parsed };
  }

  test("POST refuses a zero-amount cost, naming the field", async () => {
    const token = await agentToken();
    const { status, body } = await createDay(token, {
      ...DRAFT,
      costs: [{ label: "Ferry", amount: 0, currency: "EUR" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_entry");
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "costs[0].amount")).toBe(true);
    // Refused, not written half-done.
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })).toBeUndefined();
  });

  test("POST refuses a negative amount the same way", async () => {
    const token = await agentToken();
    const { status, body } = await createDay(token, {
      ...DRAFT,
      costs: [{ label: "Ferry", amount: -5, currency: "EUR" }],
    });
    expect(status).toBe(400);
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "costs[0].amount")).toBe(true);
  });

  test("POST refuses an unrecognisable currency, naming the field", async () => {
    const token = await agentToken();
    const { status, body } = await createDay(token, {
      ...DRAFT,
      costs: [{ label: "Ferry", amount: 40, currency: "Euros" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_entry");
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "costs[0].currency")).toBe(true);
  });

  test("PATCH refuses the same shape, and writes nothing", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", {
      costs: [{ label: "Taxi", amount: 0, currency: "CHF" }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_entry");
    const problems = body.problems as { field: string }[];
    expect(problems.some((p) => p.field === "costs[0].amount")).toBe(true);
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.costs).toEqual([]);
  });

  test("the messages match the trip-budget door's", async () => {
    const token = await agentToken();
    const { body: byAmount } = await createDay(token, {
      ...DRAFT,
      costs: [{ label: "Ferry", amount: 0, currency: "EUR" }],
    });
    const amountProblem = (byAmount.problems as { field: string; expected: string }[]).find(
      (p) => p.field === "costs[0].amount",
    );
    // Same sentence lib/validate/costs.ts uses for the trip budget door —
    // both now come from the one function, checkCosts (lib/validate/entry.ts).
    expect(amountProblem?.expected).toBe(
      "a number greater than zero — parseCostItems drops a zero or negative amount " +
        "silently when the page reads it back, which is the failure this door exists to refuse.",
    );

    const { body: byCurrency } = await createDay(token, {
      ...DRAFT,
      costs: [{ label: "Ferry", amount: 40, currency: "Euros" }],
    });
    const currencyProblem = (byCurrency.problems as { field: string; expected: string }[]).find(
      (p) => p.field === "costs[0].currency",
    );
    expect(currencyProblem?.expected).toBe("an ISO-4217 code, e.g. CHF — three letters");
  });

  test("a day already on disk with a zero-amount cost and a bad currency still renders", async () => {
    // createDraft is the lib function the route calls *after* validation —
    // used directly here, unvalidated, to stand in for a day already on disk
    // before this ticket (or one written by hand, or by ingest). The read
    // path must not start erroring on a file the write path would now refuse.
    createDraft(REF, {
      ...DRAFT,
      costs: [{ label: "Ferry", amount: 0, currency: "Euros" }],
    });
    const token = await agentToken();
    const response = await getDayRoute(
      new Request("https://t.test/api/v1/alex/trips/reise/days/erster-tag", {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise", slug: "erster-tag" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { costs: unknown[] };
    // parseCostItems drops the zero-amount item silently, exactly as it did
    // before this ticket — this is about the render not throwing, not about
    // resurrecting a cost the write path would now refuse.
    expect(body.costs).toEqual([]);
  });
});
