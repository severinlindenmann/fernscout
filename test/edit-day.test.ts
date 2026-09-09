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

async function getDay(token: string, slug: string) {
  const response = await getDayRoute(
    new Request(`https://t.test/api/v1/alex/trips/reise/days/${slug}`, {
      headers: { authorization: `Bearer ${token}` },
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
    // the middle of what was already there. `timezone` lands ahead of
    // `lat`/`lng` because supplying coordinates with no zone of their own
    // resolves one (B1090), and `spliceEntryFields` writes fields in the
    // order it considers them, timezone before lat/lng.
    expect(after).toContain('status: draft\ntimezone: "Europe/Zurich"\nlat: 46.19\nlng: 9.02');
  });

  test("travelScene can be set, then cleared back to the default", () => {
    const made = createDraft(REF, DRAFT);
    if (!made.ok) throw new Error("expected the draft to be written");

    editEntry(REF, "erster-tag", { travelScene: "skip" });
    expect(fs.readFileSync(made.file, "utf8")).toContain('travelScene: "skip"');
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.travelScene).toBe("skip");

    // An empty string clears the line, the same as transportMode does —
    // absent means the default scene again.
    editEntry(REF, "erster-tag", { travelScene: "" });
    expect(fs.readFileSync(made.file, "utf8")).not.toContain("travelScene");
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.travelScene).toBeUndefined();
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

/**
 * B540 — three bugs an agent following only `/agent.md` and `/openapi.json`
 * reproduced against a running instance, none of them found by reading the
 * source.
 */
describe("GET .../days/<slug>: travelScene and weather read back (B540 bug 1)", () => {
  test("a travelScene set on the day is in the response", async () => {
    createDraft(REF, DRAFT);
    editEntry(REF, "erster-tag", { travelScene: "skip" });
    const token = await agentToken();
    const { body } = await getDay(token, "erster-tag");
    // Before the fix this key was missing entirely, which read exactly like
    // "no scene was ever set" — indistinguishable from the day never having
    // asked for one, even though `editEntry` had written it moments earlier.
    expect(body.travelScene).toBe("skip");
  });

  test("a weather reading on the day is in the response, with its provenance", async () => {
    createDraft(REF, { ...DRAFT, lat: 46.19, lng: 9.02 });
    editEntry(REF, "erster-tag", {
      weatherData: { tempMax: 21, source: "a postcard from the trip", recordedAt: "2026-09-01T12:00:00Z" },
    });
    const token = await agentToken();
    const { body } = await getDay(token, "erster-tag");
    expect(body.weather).toEqual({
      tempMax: 21,
      source: "a postcard from the trip",
      recordedAt: "2026-09-01T12:00:00Z",
    });
  });

  test("a day with neither carries neither key", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { body } = await getDay(token, "erster-tag");
    expect(body.travelScene).toBeUndefined();
    expect(body.weather).toBeUndefined();
  });
});

describe("an unrecognised travelScene reads back as the default (B540 bug 2)", () => {
  test("parseTravelSceneVariant already treats it as absent, which is the default", () => {
    // EditInput's travelScene is typed to TRAVEL_SCENE_VARIANTS, so writing a
    // value outside it — exactly what the openapi document says is "written
    // as sent" rather than refused — needs the same type escape edit-day's
    // other "smuggled past the type system" test uses above.
    createDraft(REF, DRAFT);
    const sneaky = { travelScene: "sunrise-over-the-lake" } as EditInput;
    editEntry(REF, "erster-tag", sneaky);

    // Written as sent: the file carries the value nobody recognises.
    const onDisk = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-09-01-erster-tag.md"),
      "utf8",
    );
    expect(onDisk).toContain('travelScene: "sunrise-over-the-lake"');

    // Read back as the default — undefined, which is exactly what a day that
    // never set travelScene at all also reads as (see `Entry.travelScene`'s
    // own comment: "Absent means the default").
    expect(getEntryBySlug(REF, "erster-tag", { includeDrafts: true })?.travelScene).toBeUndefined();
  });

  test("the day route agrees: the key is simply absent, same as a day that never asked", async () => {
    createDraft(REF, DRAFT);
    editEntry(REF, "erster-tag", { travelScene: "sunrise-over-the-lake" } as EditInput);
    const token = await agentToken();
    const { body } = await getDay(token, "erster-tag");
    expect(body.travelScene).toBeUndefined();
  });
});

describe("PATCH .../days/<slug>: a caption naming a src the day does not have is refused (B540 bug 3)", () => {
  function addGalleryItem(slug: string) {
    const file = path.join(dir, "alex", "trips", "reise", "entries", `2026-09-01-${slug}.md`);
    const before = fs.readFileSync(file, "utf8");
    // Hand-written the way `galleryLines` (lib/ingest/entry.ts) renders one —
    // no need to drive the real upload pipeline just to give the day one
    // photograph to caption.
    const after = before.replace(
      "status: draft\n",
      `status: draft\ngallery:\n  - src: "/media/reise/${slug}/01.jpg"\n    type: "image"\n    width: 800\n    height: 600\n`,
    );
    fs.writeFileSync(file, after);
  }

  test("a src the day does not have is 400, not a silent 200", async () => {
    createDraft(REF, DRAFT);
    addGalleryItem("erster-tag");
    const token = await agentToken();

    const { status, body } = await patchDay(token, "erster-tag", {
      captions: { "/alex/media/reise/erster-tag/02.jpg": "Wrong photograph entirely" },
    });

    // The bug: this used to answer 200 with changed: ["captions"] and write
    // nothing at all, so a typo'd src looked exactly like success.
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_entry");
    const problems = body.problems as { field: string; got: string; expected: string }[];
    expect(problems.some((p) => p.field.includes("02.jpg"))).toBe(true);

    const onDisk = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-09-01-erster-tag.md"),
      "utf8",
    );
    expect(onDisk).not.toContain("Wrong photograph entirely");
  });

  test("captioning the src the day actually has still works", async () => {
    createDraft(REF, DRAFT);
    addGalleryItem("erster-tag");
    const token = await agentToken();

    const { status } = await patchDay(token, "erster-tag", {
      captions: { "/alex/media/reise/erster-tag/01.jpg": "The right photograph" },
    });
    expect(status).toBe(200);
    const entry = getEntryBySlug(REF, "erster-tag", { includeDrafts: true });
    expect(entry?.gallery[0]?.caption).toBe("The right photograph");
  });

  test("an empty string still removes an existing caption", async () => {
    createDraft(REF, DRAFT);
    addGalleryItem("erster-tag");
    const token = await agentToken();
    await patchDay(token, "erster-tag", {
      captions: { "/alex/media/reise/erster-tag/01.jpg": "First" },
    });

    const { status } = await patchDay(token, "erster-tag", {
      captions: { "/alex/media/reise/erster-tag/01.jpg": "" },
    });
    expect(status).toBe(200);
    const entry = getEntryBySlug(REF, "erster-tag", { includeDrafts: true });
    expect(entry?.gallery[0]?.caption).toBeUndefined();
  });

  test("a day with no gallery at all still refuses any src named", async () => {
    createDraft(REF, DRAFT);
    const token = await agentToken();
    const { status, body } = await patchDay(token, "erster-tag", {
      captions: { "/alex/media/reise/erster-tag/01.jpg": "hello" },
    });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_entry");
  });
});
