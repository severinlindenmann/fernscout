import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, listDrafts, validateDraft } from "@/lib/api/entries";
import { slugify } from "@/lib/slug.ts";
import { agentGuide, instanceDocumentation, userDocumentation } from "@/lib/api/documentation";
import { openApiDocument } from "@/lib/api/openapi";
import { getAllEntries } from "@/lib/entries";
import { validateEntry } from "@/lib/validate/entry";
import {
  BUDGET_QUESTION,
  COORDINATES_QUESTION,
  GUEST_LINK_OFFER,
  MEDIA_ENDPOINT_PATH,
  NOT_WRITABLE,
  PHOTOS_SECOND_CALL,
  PUBLISH_OFFER,
  TRANSLATIONS_REQUIRED,
  TITLE_COLLISION_EXAMPLE,
  PRIVATE_SHUTS_OUT_GUESTS,
  VISIBILITY_CHOICE,
  VISIBILITY_ENUM_NOTE,
  VISIBILITY_MEANING,
  VISIBILITY_NOT_A_LOCK,
  asSentence,
  firstQuestions,
} from "@/lib/api/agentCopy";

let dir: string;

function writeTrip(username: string, tripId: string) {
  const tripPath = path.join(dir, username, "trips", tripId);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    tripPath + "/trip.md",
    [
      "---",
      `id: ${tripId}`,
      `title: "${tripId}"`,
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: current",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-agent-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {},
    }),
  );
  for (const username of ["ana", "bea"]) {
    fs.mkdirSync(path.join(dir, username), { recursive: true });
    fs.writeFileSync(
      path.join(dir, username, "config.json"),
      JSON.stringify({
        title: `${username}'s journal`,
        tagline: "A tagline",
        owner: { name: "A B", nickname: "A" },
        startLocation: "X",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        units: "metric",
        features: { reactions: { enabled: true }, costs: { enabled: true } },
      }),
    );
    writeTrip(username, `${username}-trip`);
  }
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const DRAFT = {
  title: "Lanterns of Hoi An",
  date: "2026-01-05",
  time: "16:45",
  location: "Hoi An",
  country: "Vietnam",
  lat: 15.8801,
  lng: 108.338,
  content: "The old town hangs with lanterns.",
};

describe("writing as an agent", () => {
  test("a valid draft is written to disk", () => {
    const result = createDraft("ana/ana-trip", DRAFT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("draft");
    expect(fs.existsSync(result.file)).toBe(true);
    expect(fs.readFileSync(result.file, "utf8")).toContain("status: draft");
  });

  /** The whole point of G7: an agent cannot put words on the site. */
  test("a draft is invisible to every reading path", () => {
    createDraft("ana/ana-trip", DRAFT);
    expect(getAllEntries("ana/ana-trip")).toHaveLength(0);
  });

  test("but it is listed as waiting for a person", () => {
    createDraft("ana/ana-trip", DRAFT);
    expect(listDrafts("ana/ana-trip")).toEqual([
      { slug: "lanterns-of-hoi-an", title: "Lanterns of Hoi An", date: "2026-01-05" },
    ]);
  });

  test("publishing it makes it appear", () => {
    const result = createDraft("ana/ana-trip", DRAFT);
    if (!result.ok) throw new Error("expected the draft to be written");
    fs.writeFileSync(
      result.file,
      fs.readFileSync(result.file, "utf8").replace("status: draft\n", ""),
    );
    expect(getAllEntries("ana/ana-trip")).toHaveLength(1);
    expect(listDrafts("ana/ana-trip")).toHaveLength(0);
  });

  /** Agents retry. A retry must not quietly replace the first attempt. */
  test("writing the same day twice is a conflict, not an overwrite", () => {
    createDraft("ana/ana-trip", DRAFT);
    const again = createDraft("ana/ana-trip", { ...DRAFT, content: "different words" });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatch(/already exists/);

    const file = path.join(
      dir,
      "ana/trips/ana-trip/entries/2026-01-05-lanterns-of-hoi-an.md",
    );
    expect(fs.readFileSync(file, "utf8")).toContain("The old town hangs with lanterns.");
  });

  test("an unknown trip is refused", () => {
    expect(createDraft("ana/nope", DRAFT)).toEqual({ ok: false, error: "unknown_trip" });
  });

  test("one user's ref cannot write into another's journal", () => {
    createDraft("ana/ana-trip", DRAFT);
    expect(listDrafts("bea/bea-trip")).toHaveLength(0);
  });

  test("quotes and backslashes in a title cannot break the frontmatter", () => {
    const result = createDraft("ana/ana-trip", {
      ...DRAFT,
      title: 'A "quoted" \\ title',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.readFileSync(result.file, "utf8")).toContain('title: "A \\"quoted\\" \\\\ title"');
    expect(listDrafts("ana/ana-trip")[0].title).toBe('A "quoted" \\ title');
  });
});

describe("validation", () => {
  test("rejects what it cannot write safely", () => {
    expect(validateDraft({ ...DRAFT, title: "" })).toMatch(/title/);
    expect(validateDraft({ ...DRAFT, date: "5 January" })).toMatch(/date/);
    expect(validateDraft({ ...DRAFT, time: "6pm" })).toMatch(/time/);
    expect(validateDraft({ ...DRAFT, content: "" })).toMatch(/content/);
    expect(validateDraft({ ...DRAFT, lat: "north" as unknown as number })).toMatch(/lat/);
  });

  test("accepts a minimal entry", () => {
    expect(validateDraft({ title: "T", date: "2026-01-01", content: "c" })).toBeNull();
  });

  // The whole table of letters lives in test/slug.test.ts. What matters here
  // is that the API writes with that function and no other: before B77 this
  // module had its own copy, and a day titled "Rückfahrt" landed at
  // /day/ruckfahrt — a different German word — while photo ingest would have
  // filed the same title as rueckfahrt.
  test("the slug on disk is the one the shared rule produces", () => {
    writeTrip("ana", "trip-a");
    const result = createDraft("ana/trip-a", {
      title: "Rückfahrt",
      date: "2026-01-02",
      content: "Home again.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("rueckfahrt");
    expect(result.slug).toBe(slugify("Rückfahrt"));
    expect(path.basename(result.file)).toBe("2026-01-02-rueckfahrt.md");
  });

  test("slugs are safe for a filename", () => {
    expect(slugify("Lanterns of Hội An!")).toBe("lanterns-of-hoi-an");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("")).toBe("entry");
  });
});

/**
 * Fields the API checked and then threw away.
 *
 * `lib/validate/entry.ts` has validated `costs` and `transportMode` since W29,
 * so a caller sending either got a clean 400 for a malformed one and a
 * cheerful 201 for a correct one — which was then written to a file that did
 * not mention it. An agent reading a day back saw `"costs": []` on a day it
 * had just logged spend against, with nothing anywhere to say why.
 */
describe("what a day can actually carry", () => {
  test("costs survive into the file and read back", () => {
    const result = createDraft("ana/ana-trip", {
      ...DRAFT,
      costs: [
        { label: "Coffee", amount: 4.5, currency: "eur", category: "food" },
        { label: "Bus", amount: 12 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entry = getAllEntries("ana/ana-trip", { includeDrafts: true })[0];
    expect(entry.costs).toHaveLength(2);
    expect(entry.costs[0]).toMatchObject({ label: "Coffee", amount: 4.5, currency: "EUR" });
    // No currency means the journal's base currency, not a guess.
    expect(entry.costs[1]).toMatchObject({ label: "Bus", amount: 12, currency: "CHF" });
    // And an unstated category is written rather than left for a reader to
    // wonder about.
    expect(entry.costs[1].category).toBe("other");
  });

  test("transport survives into the file", () => {
    const result = createDraft("ana/ana-trip", {
      ...DRAFT,
      transportMode: "train",
      transportFrom: "Hue",
      transportTo: "Hoi An",
    });
    if (!result.ok) throw new Error("expected the draft to be written");
    const entry = getAllEntries("ana/ana-trip", { includeDrafts: true })[0];
    expect(entry.transport).toEqual({ mode: "train", from: "Hue", to: "Hoi An" });
  });

  test("travelScene survives into the file", () => {
    const result = createDraft("ana/ana-trip", { ...DRAFT, travelScene: "quick" });
    if (!result.ok) throw new Error("expected the draft to be written");
    expect(fs.readFileSync(result.file, "utf8")).toContain("travelScene: \"quick\"");
    const entry = getAllEntries("ana/ana-trip", { includeDrafts: true })[0];
    expect(entry.travelScene).toBe("quick");
  });

  test("an unrecognised travelScene round-trips into the file but reads back as the default", () => {
    // Unlike transportMode, a typo here is not refused at write time (B15) —
    // it is written as sent, the same way an unrecognised trip `visibility:`
    // is, and it is the read side that falls back rather than the write.
    const result = createDraft("ana/ana-trip", { ...DRAFT, travelScene: "epic-flyover" });
    if (!result.ok) throw new Error("expected the draft to be written");
    expect(fs.readFileSync(result.file, "utf8")).toContain("travelScene: \"epic-flyover\"");
    const entry = getAllEntries("ana/ana-trip", { includeDrafts: true })[0];
    expect(entry.travelScene).toBeUndefined();
  });

  test("a quote in a cost label does not break the frontmatter", () => {
    createDraft("ana/ana-trip", {
      ...DRAFT,
      costs: [{ label: 'The "good" coffee', amount: 4 }],
    });
    expect(getAllEntries("ana/ana-trip", { includeDrafts: true })[0].costs[0].label).toBe(
      'The "good" coffee',
    );
  });
});

/**
 * `test: true` — the honest way to answer "invent me a day".
 *
 * The guide forbids inventing detail, and rightly. But proving the pipeline
 * works end to end means writing a day nobody lived, and until this existed
 * an agent asked to do it had only its own prose to warn anybody.
 */
describe("content nobody lived", () => {
  test("is written into the file, so the page can say so", () => {
    const result = createDraft("ana/ana-trip", { ...DRAFT, test: true });
    if (!result.ok) throw new Error("expected the draft to be written");
    expect(fs.readFileSync(result.file, "utf8")).toContain("test: true");
    expect(getAllEntries("ana/ana-trip", { includeDrafts: true })[0].test).toBe(true);
  });

  test("is absent from an ordinary day, rather than written as false", () => {
    const result = createDraft("ana/ana-trip", DRAFT);
    if (!result.ok) throw new Error("expected the draft to be written");
    expect(fs.readFileSync(result.file, "utf8")).not.toContain("test:");
    expect(getAllEntries("ana/ana-trip", { includeDrafts: true })[0].test).toBeUndefined();
  });

  test("a string is refused rather than ignored", () => {
    // Ignoring it would publish invented content with no banner, which is the
    // one outcome the flag exists to prevent.
    const problems = validateEntry({ ...DRAFT, test: "true" });
    expect(problems.map((p) => p.field)).toContain("test");
  });

  test("and only `true` counts when the file is read", () => {
    const tripPath = path.join(dir, "ana", "trips", "ana-trip", "entries");
    fs.writeFileSync(
      path.join(tripPath, "2026-01-09-real-day.md"),
      ['---', 'title: "Real"', 'date: "2026-01-09"', "test: no", "---", "", "It happened.", ""].join("\n"),
    );
    const entry = getAllEntries("ana/ana-trip").find((e) => e.slug === "real-day");
    expect(entry?.test).toBeUndefined();
  });
});

describe("the documents an agent reads", () => {
  test("the instance document lists every journal", () => {
    const doc = instanceDocumentation();
    expect(doc.startsWith("# Fernscout")).toBe(true);
    expect(doc).toContain("/ana/documentation.txt");
    expect(doc).toContain("/bea/documentation.txt");
  });

  test("it follows the llmstxt.org shape: H1, blockquote, then H2 lists", () => {
    const lines = instanceDocumentation().split("\n");
    expect(lines[0]).toMatch(/^# /);
    expect(lines.find((l) => l.startsWith(">"))).toBeDefined();
    expect(lines.filter((l) => l.startsWith("## ")).length).toBeGreaterThan(0);
    // Every file-list entry is a markdown link, optionally with ": note".
    for (const line of lines.filter((l) => l.startsWith("- ["))) {
      expect(line).toMatch(/^- \[[^\]]+\]\([^)]+\)/);
    }
  });

  test("a user document is specific to that user", () => {
    const doc = userDocumentation("ana");
    expect(doc).toContain("ana's journal");
    expect(doc).not.toContain("bea's journal");
    expect(userDocumentation("nobody")).toBeNull();
  });

  test("the guide states the draft rule, because it is the one rule", () => {
    const guide = agentGuide();
    expect(guide).toMatch(/draft/i);
    // Whitespace-tolerant: the guide is wrapped prose, not one line.
    //
    // What it must say is the shape of the rule, not the old prohibition. The
    // agent publishes (ROADMAP decision 28); what it cannot do is publish as a
    // side effect of writing, because the gap between the two calls is where
    // the person reads the day back. B223.
    expect(guide).toMatch(/no\s+argument\s+that\s+changes\s+that/i);
    expect(guide).toMatch(/days\/<slug>\/publish/);
  });

  /**
   * `/documentation.txt` is the first document an agent reads and, until B223,
   * the only one that stated the rule without ever saying how publishing
   * happens. An agent that reads only this one must still finish the job.
   */
  test("the summary names the publish call, not just the draft rule", () => {
    const summary = instanceDocumentation();
    expect(summary).toMatch(/draft/i);
    expect(summary).toContain("days/<slug>/publish");
  });

  /**
   * B256: an agent that could not fetch `/agent.md` had read only the three
   * prose steps that used to be here — "signup is in the guide" — and had no
   * call it could actually make. The index has to carry the signup calls
   * itself, not just point at where they live, so a failed hop to the guide
   * costs the rest of the API and not the whole of it.
   */
  test("the summary is self-sufficient for signup: it carries the three calls", () => {
    const summary = instanceDocumentation();
    expect(summary).toContain("/api/auth/signup/request");
    expect(summary).toContain("/api/auth/signup/verify");
    expect(summary).toContain("POST");
    expect(summary).toMatch(/\/api\/v1\/journals/);
    // A complete body, not just the path: the fields a signup token cannot
    // proceed without.
    for (const field of ["username", "title", "ownerName", "ownerNickname"]) {
      expect(summary, `${field} must appear in the journals example`).toContain(`"${field}"`);
    }
  });

  test("the guide documents authentication without ever mailing a token", () => {
    const guide = agentGuide();
    expect(guide).toContain("/api/auth/request");
    expect(guide).toContain("/api/auth/verify");
    expect(guide).toMatch(/never sent by email/i);
  });

  test("the guide tells an agent not to invent detail", () => {
    expect(agentGuide()).toMatch(/do not invent/i);
  });

  /**
   * B331: an agent holding a valid owner token was asked to invite somebody,
   * found no call in either summary, and invented a browser "dashboard" that
   * does not exist. Both documents now name the invites endpoint — the
   * per-journal one directly in its endpoint list, the instance-level one in
   * a heading of its own rather than only inside the "Then" onboarding
   * script that offers a guest link in passing once a trip is published.
   */
  test("a journal's own document names the invites endpoint", () => {
    const doc = userDocumentation("ana")!;
    expect(doc).toContain("/api/v1/ana/invites");
    expect(doc).toMatch(/"kind":\s*"guest"/);
    expect(doc).toMatch(/"kind":\s*"buddy"/);
  });

  test("the instance document has its own heading for invites, not only a mention inside onboarding", () => {
    const summary = instanceDocumentation();
    // GUEST_LINK_OFFER already lives inside "## Then" (the walkthrough), and
    // is not what this asserts: this is a heading of its own, findable by an
    // agent that is not reading the create-a-journal script at all.
    const headingIdx = summary.indexOf("## Letting other people in");
    expect(headingIdx).toBeGreaterThan(-1);
    const journalsIdx = summary.indexOf("## Journals");
    expect(journalsIdx).toBeGreaterThan(headingIdx);
    const section = summary.slice(headingIdx, journalsIdx);
    expect(section.toLowerCase()).toContain("invite");
    expect(section).toContain("/api/v1/their-name/invites");
  });
});

/**
 * The gaps a real agent run fell into.
 *
 * Each of these is something an agent could not learn from the prose guide and
 * had to work out from a 400, from openapi.json, or not at all. The guide is
 * generated beside the routes precisely so that it cannot drift from them —
 * these tests are the other half of that, naming the things it must not stop
 * saying.
 */
/** These documents are wrapped at 78, so a shared sentence lands across lines.
 * Collapsing whitespace asserts the wording without asserting the wrapping. */
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("what the guide has to tell an agent before it starts", () => {
  test("names the four things to ask the person", () => {
    const guide = agentGuide();
    expect(guide).toMatch(/email address/i);
    // B306: renamed from "public or private", which borrowed the trip
    // level's word for a different meaning.
    expect(guide).toMatch(/public or guest/i);
    // The nickname rule, which is invisible to anyone reading only the prose.
    expect(guide).toMatch(/never (derived|guessed)/i);
  });

  test("the journal-creation example carries every required field", () => {
    // The published example used to omit ownerName and ownerNickname, so an
    // agent following it exactly got a 400 on the one call it could not
    // discover another way.
    const guide = agentGuide();
    for (const field of ["username", "title", "ownerName", "ownerNickname"]) {
      expect(guide, `${field} must appear in the journals example`).toContain(`"${field}"`);
    }
  });

  test("says that asking for a second code kills the first", () => {
    // The failure this prevents: the person reads out the code from the email
    // they have, and it has already been superseded by an identical one.
    expect(agentGuide()).toMatch(/invalidates the code|newest/i);
  });

  test("says photographs are attached rather than pasted", () => {
    const guide = agentGuide();
    expect(guide).toMatch(/nothing to paste/i);
    // And no longer tells anyone to paste a block into an entry, which there
    // has never been a call to do.
    expect(guide).not.toMatch(/paste (it|this|the .gallery)/i);
  });

  test("documents idempotency_key for REST", () => {
    expect(agentGuide()).toContain("idempotency_key");
  });

  test("the markdown twin it documents carries the trip", () => {
    // `/<user>/day/<slug>.md` alone was the documented form, and it 404s for
    // every day outside the current trip.
    expect(agentGuide()).toContain("/trips/<trip-id>/day/<slug>.md");
  });

  test("the error table distinguishes the two 404s", () => {
    const guide = agentGuide();
    expect(guide).toContain("auth_disabled");
    expect(guide).toContain("unknown_trip");
  });

  test("lists the optional day fields the write example does not show", () => {
    const guide = agentGuide();
    for (const field of ["costs", "transportMode", "travelScene", "test"]) {
      expect(guide, `${field} must be documented`).toContain(field);
    }
  });

  /**
   * The four documents say some of the same things, and must not come to
   * disagree about them.
   *
   * `/documentation.txt` and `/<user>/documentation.txt` are indexes — the
   * second generated per journal, naming its own trips — `/agent.md` is the
   * manual, and `/openapi.json` is the machine contract. Keeping them apart is
   * deliberate: an agent handed one journal's link should get 2.5 KB of
   * "whose is this, where do I write", not 24 KB of manual. What that does not
   * license is four hand-written copies of one definition. AGENTS.md is blunt
   * about where that ends, and this project has been there once already.
   *
   * So the shared sentences live in lib/api/agentCopy.ts, and these tests fail
   * if a document stops using them.
   */
  test("every document defines journal visibility with the same words", () => {
    // Not a substring check against a hand-typed copy — that would be the bug
    // it is guarding against. The constant itself is the expectation.
    //
    // Compared with whitespace collapsed, because these documents are wrapped
    // at 78 and the sentence lands across lines. What is being asserted is the
    // wording, not the line breaks.
    expect(flat(agentGuide())).toContain(flat(VISIBILITY_MEANING));
    expect(flat(instanceDocumentation())).toContain(flat(VISIBILITY_MEANING));
  });

  test("and all of them carry the warning that private is not a lock", () => {
    // The half that gets misread. A person told "private" who believes it
    // means "locked" will put something in the journal they should not.
    expect(flat(agentGuide())).toContain(flat(VISIBILITY_NOT_A_LOCK));
    expect(flat(instanceDocumentation())).toContain(
      flat(VISIBILITY_NOT_A_LOCK.replace(/`/g, "")),
    );
  });

  /**
   * B302 — the difference between defining the three values and telling an
   * agent which to ask for.
   *
   * The definitions were already everywhere. What was missing was the choice:
   * the guide said "created private unless you say otherwise; ask before
   * public", which never mentions `guest` at all. An agent following it asked
   * "shall I make this public?", was told no, and left a private trip — after
   * which its owner approved a guest who could not read it (B300).
   */
  test("the guide says which of the three to ask for, and recommends two of them", () => {
    const guide = flat(agentGuide());
    expect(guide).toContain(flat(VISIBILITY_CHOICE));
    // The recommendation is the point, so assert on it rather than only on
    // the constant being present somewhere.
    expect(guide).toMatch(/recommend `?public`? or `?guest`?/i);
  });

  test("every door that offers trip creation says a private trip shuts out guests", () => {
    // The consequence an owner actually walked into. The guide is where a trip
    // gets created; the index is where an agent meets the three values first.
    expect(flat(agentGuide())).toContain(flat(PRIVATE_SHUTS_OUT_GUESTS));
    expect(flat(instanceDocumentation())).toContain(
      flat(PRIVATE_SHUTS_OUT_GUESTS.replace(/`/g, "")),
    );
    expect(flat(JSON.stringify(openApiDocument()))).toContain(flat(PRIVATE_SHUTS_OUT_GUESTS));
  });

  test("the machine contract carries the choice too, not just the default", () => {
    // An agent working from the schema alone used to know less than one
    // reading the prose: the summary named the default and nothing else.
    const doc = openApiDocument();
    const post = doc.paths["/api/v1/{user}/trips"].post;
    expect(flat(post.description)).toContain(flat(VISIBILITY_ENUM_NOTE));
    // Most open first — the order a person decides in.
    expect(
      post.requestBody.content["application/json"].schema.properties.visibility.enum,
    ).toEqual(["public", "guest", "private"]);
    // B306: there is no longer one fixed default to name in the schema — a
    // forgotten field now takes the journal's own answer, never wider than
    // that, and a misspelling still falls back to the closed value. The
    // schema says so in prose (VISIBILITY_ENUM_NOTE, asserted above) rather
    // than in a `default` key, because the value is not fixed.
    expect(
      "default" in post.requestBody.content["application/json"].schema.properties.visibility,
    ).toBe(false);
  });

  test("the index and the guide ask for the same things, in their own shapes", () => {
    const guide = flat(agentGuide());
    const index = flat(instanceDocumentation());
    for (const question of firstQuestions("https://example.test")) {
      expect(guide, `the guide must ask: ${question.ask}`).toContain(flat(question.because));
      expect(index, `the index must ask: ${question.ask}`).toContain(flat(question.because));
    }
    // One as a table, one as a numbered list — the point is that the wording
    // is shared and the form is not.
    expect(guide).toContain("| Ask | Because |");
    expect(instanceDocumentation()).toMatch(/^1\. Their \*\*email address\*\*/m);
  });

  test("a generated sentence does not end in `?.`", () => {
    // "**Public or private?**." is the seam that makes a generated document
    // read as generated.
    for (const question of firstQuestions("https://example.test")) {
      expect(asSentence(question)).not.toMatch(/[?!][*`_]*\.\s/);
    }
    expect(instanceDocumentation()).not.toMatch(/\?\*\*\./);
  });

  test("both documents say a day owes the journal's other languages", () => {
    // B294: and they must carry the prohibition as loudly as the requirement,
    // or an agent satisfies the refusal by translating somebody's prose.
    expect(flat(agentGuide())).toContain(flat(TRANSLATIONS_REQUIRED));
    expect(flat(instanceDocumentation())).toContain(flat(TRANSLATIONS_REQUIRED));
  });

  test("the translations sentence forbids translating unasked but permits it when asked", () => {
    // B316: the B294 wording read as an absolute ban, and an agent refused an
    // owner who asked directly. A future edit must not drop either half —
    // the prohibition on quietly manufacturing translations, or the
    // permission to translate on request.
    expect(TRANSLATIONS_REQUIRED).toContain("Do not translate unasked");
    expect(TRANSLATIONS_REQUIRED).toContain("If they ask you to, translate it");
  });

  test("the languages question says what answering it commits an owner to", () => {
    // B294 again: three languages is a promise to write everything three
    // times, and an owner choosing at creation had no way to know that.
    const asked = firstQuestions("https://x.test")
      .map((q) => q.because)
      .join(" ");
    expect(asked).toContain("every day of every trip");
  });

  test("neither document claims deleting a budget removes the costs page", () => {
    // B332: B328 widened `hasCostsData` to ask whether the trip has any costs
    // at all, so the old "DELETE it and the page goes" became false wherever a
    // day still logs spend — and an agent following it would have reported the
    // page gone when it was not.
    expect(NOT_WRITABLE).toContain("both have to go");
    expect(NOT_WRITABLE).not.toMatch(/DELETE it and the page goes/);
    for (const doc of [agentGuide(), instanceDocumentation()]) {
      expect(flat(doc)).not.toMatch(/DELETE it and the page goes/);
    }
  });

  test("both documents say what no call changes", () => {
    // B293: an agent that could not find a way to turn a costs page off told
    // its owner to use a web UI that does not exist. The documents now say
    // which of the two things it was reaching for is writable and which is not.
    expect(flat(agentGuide())).toContain(flat(NOT_WRITABLE));
    expect(flat(instanceDocumentation())).toContain(flat(NOT_WRITABLE));
  });

  test("both documents name the media endpoint where they mention photographs", () => {
    // B292: the day-fields table used to say only "the media endpoint" and an
    // agent that had just written a day guessed a path, 404'd, and hunted.
    expect(flat(agentGuide())).toContain(flat(MEDIA_ENDPOINT_PATH));
    expect(flat(instanceDocumentation())).toContain(flat(MEDIA_ENDPOINT_PATH));
  });

  test("both documents give the worked example for titling repeated places", () => {
    // B292: "no two days may share a slug" was already documented; the
    // consequence for how to name a second "Bangkok" was not.
    expect(flat(agentGuide())).toContain(flat(TITLE_COLLISION_EXAMPLE));
    expect(flat(instanceDocumentation())).toContain(flat(TITLE_COLLISION_EXAMPLE));
  });

  test("both documents ask whether a trip tracks its money", () => {
    // B267: `costs.md` is optional and the capability is on by default at
    // creation, so nothing ever put the question to the person — the page
    // rendered anyway, with nothing in it.
    expect(flat(agentGuide())).toContain(flat(BUDGET_QUESTION));
    expect(flat(instanceDocumentation())).toContain(flat(BUDGET_QUESTION));
  });

  test("both documents ask for a day's coordinates, and only as a proposal", () => {
    // B267: fifteen days went out with no lat/lng because nothing ever asked
    // for them. The sentence has to survive being read by a weak model as
    // permission to geocode silently, so it says "propose" and "never
    // written" in the same breath.
    expect(flat(agentGuide())).toContain(flat(COORDINATES_QUESTION));
    expect(flat(instanceDocumentation())).toContain(flat(COORDINATES_QUESTION));
  });

  test("a journal's own document shows a twin URL with a real trip in it", () => {
    // The demo journal's docs said "append .md to a day's URL" and left the
    // reader to guess that the URL has a trip in it. It does.
    const doc = userDocumentation("ana")!;
    expect(doc).toContain("/ana/trips/ana-trip/day/<slug>.md");
  });

  /**
   * B317: a question script said what to ask and never what to offer once
   * the answers were in, so an owner had to think of photographs,
   * publishing and a guest link unprompted. These assert the three offers
   * survive in both documents, and that the photographs offer names the
   * real field names rather than leaving an agent to guess them.
   */
  test("both documents offer photographs, naming the field names, once a day is written", () => {
    expect(flat(agentGuide())).toContain(flat(PHOTOS_SECOND_CALL));
    expect(flat(instanceDocumentation())).toContain(flat(PHOTOS_SECOND_CALL));
  });

  test("the photographs offer names the real media field names", () => {
    // A rename of the media field should break this document rather than
    // silently making it wrong — so assert the actual field names the route
    // reads, not a paraphrase of them.
    expect(PHOTOS_SECOND_CALL).toContain("`multipart/form-data`");
    expect(PHOTOS_SECOND_CALL).toContain("`day`");
    expect(PHOTOS_SECOND_CALL).toContain("`files`");
  });

  test("both documents offer to publish once a trip's days are written", () => {
    expect(flat(agentGuide())).toContain(flat(PUBLISH_OFFER));
    expect(flat(instanceDocumentation())).toContain(flat(PUBLISH_OFFER));
  });

  test("both documents offer a guest link once a trip is published", () => {
    expect(flat(agentGuide())).toContain(flat(GUEST_LINK_OFFER));
    expect(flat(instanceDocumentation())).toContain(flat(GUEST_LINK_OFFER));
  });

  test("the guest-link offer names the email argument, so the offer and the call agree", () => {
    // B333: an agent that had only ever seen `{"kind": "guest"}` here had no
    // way to discover the mailed, pre-approving form B319 added — say the
    // argument by name, and say what proving it does and does not grant.
    expect(GUEST_LINK_OFFER).toMatch(/"email"/);
    expect(GUEST_LINK_OFFER).toMatch(/pre-approved/i);
    expect(GUEST_LINK_OFFER).toMatch(/no queue/i);
  });
});

/**
 * B259: an agent whose only tools were web search and web fetch read the
 * whole of the signup flow B256 put here, collected every answer, and then
 * could not make a single call — nothing on the way in said that writing
 * needs `POST`/`PATCH` with a bearer token, so it improvised instead of
 * stopping. These assert the fix stays true: the capability is stated before
 * the questions, the improvisation is forbidden by name, and the minimum
 * write path — trip, day, publish — is inlined rather than left one refused
 * hop away behind `/agent.md`.
 */
describe("the entry document tells an agent whether it can write here", () => {
  test("states the POST/PATCH-with-bearer requirement above the questions", () => {
    const summary = instanceDocumentation();
    const capabilityIdx = summary.indexOf("## Can you write here?");
    const questionsIdx = summary.indexOf("## Before you call anything, ask");
    expect(capabilityIdx).toBeGreaterThan(-1);
    expect(questionsIdx).toBeGreaterThan(capabilityIdx);
    const section = summary.slice(capabilityIdx, questionsIdx);
    expect(section).toContain("POST");
    expect(section).toContain("PATCH");
    expect(section).toContain("Authorization: Bearer");
  });

  test("names the one real door", () => {
    const summary = instanceDocumentation();
    expect(summary).toMatch(/arbitrary\s+HTTP\s+request/i);
    expect(summary).not.toContain("/api/mcp");
  });

  test("forbids the two observed workarounds by name", () => {
    const summary = flat(instanceDocumentation());
    expect(summary).toMatch(/no upload interface/i);
    expect(summary).toMatch(/no web form/i);
    expect(summary).toMatch(/no CMS/i);
    expect(summary).toMatch(/manually upload/i);
    expect(summary).toMatch(/follow this guide themselves/i);
  });

  test("tells an agent that cannot fetch the guide to ask for it to be pasted", () => {
    expect(instanceDocumentation()).toMatch(/ask the person to paste it/i);
  });

  test("inlines a minimal trip, a minimal day, and the publish call", () => {
    const summary = instanceDocumentation();

    expect(summary).toMatch(/POST https?:\/\/[^\s]+\/trips\b/);
    expect(summary).toContain('"id": "japan-2027"');
    expect(summary).toContain('"start"');
    expect(summary).toContain('"end"');

    expect(summary).toMatch(/\/trips\/japan-2027\/days\b/);
    expect(summary).toContain('"title": "Lanterns of Hoi An"');
    expect(summary).toContain('"date"');
    expect(summary).toContain('"content"');

    expect(summary).toMatch(/\/trips\/japan-2027\/days\/lanterns-of-hoi-an\/publish\b/);
  });

  test("every inlined call carries the bearer header a trip-owning token needs", () => {
    const summary = instanceDocumentation();
    const writeIdx = summary.indexOf("## Then");
    const section = summary.slice(writeIdx, summary.indexOf("## Journals"));
    // fs_signup_ for the journal-creation call, fs_agent_ for the three below it.
    expect(section.match(/Authorization: Bearer fs_agent_…/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the discovery document does not point at 404s", () => {
  /**
   * `/documentation.txt` advertises other URLs. A link in a discovery document
   * that does not resolve is the worst kind of broken: an agent follows it,
   * gets nothing, and has no way to tell whether the API exists at all.
   * /openapi.json was exactly that until it was written.
   */
  test("every absolute link it advertises has a route", () => {
    const doc = instanceDocumentation() + userDocumentation("ana");
    const paths = [...doc.matchAll(/\]\(https?:\/\/[^/]+(\/[^)]*)\)/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(3);

    const routed = (p: string) =>
      // Route handlers and pages, with dynamic segments left as templates.
      p === "/agent.md" ||
      p === "/openapi.json" ||
      p === "/documentation.txt" ||
      // Rewritten in next.config.ts to /api/well-known/… — RFC 9728 requires
      // the well-known segment first, which Next cannot express as a directory.
      p.startsWith("/.well-known/") ||
      /^\/[a-z0-9-]+\/documentation\.txt$/.test(p) ||
      /^\/[a-z0-9-]+(\/(trips(\/.+)?|feed\.xml|export\.zip|search-index\.json))?$/.test(p) ||
      p.startsWith("/api/");

    const dangling = paths.filter((p) => !routed(p));
    expect(dangling, `these are advertised but have no route:\n${dangling.join("\n")}`).toEqual(
      [],
    );
  });

  test("the routes it names exist as files", () => {
    for (const route of ["app/openapi.json/route.ts", "app/agent.md/route.ts", "app/documentation.txt/route.ts"]) {
      expect(fs.existsSync(path.join(process.cwd(), route)), route).toBe(true);
    }
  });
});
