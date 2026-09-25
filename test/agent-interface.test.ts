import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, listDrafts, validateDraft } from "@/lib/api/entries";
import { slugify } from "@/lib/slug.ts";
import { instanceDocumentation, userDocumentation } from "@/lib/api/documentation";
import { skillDoc } from "@/lib/api/skillDocs";
import { openApiDocumentV2 } from "@/lib/api/v2/openapi";
import { getAllEntries } from "@/lib/entries";
import { validateEntry } from "@/lib/validate/entry";
import {
  PRIVATE_SHUTS_OUT_GUESTS,
  VISIBILITY_MEANING,
  VISIBILITY_NOT_A_LOCK,
  firstQuestions,
} from "@/lib/api/agentCopy";
import { writeTripFixture } from "./fixtures/content";

let dir: string;

function writeTrip(username: string, tripId: string) {
  writeTripFixture(username, {
    id: tripId,
    title: tripId,
    start: "2026-01-01",
    end: "2026-01-31",
    status: "current",
    intro: "Body.",
  });
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
    expect(fs.readFileSync(result.file, "utf8")).toContain('"status": "draft"');
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
    const published = JSON.parse(fs.readFileSync(result.file, "utf8"));
    published.status = "published";
    fs.writeFileSync(result.file, JSON.stringify(published, null, 2) + "\n");
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
      "ana/trips/ana-trip/entries/2026-01-05-lanterns-of-hoi-an.json",
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

  test("quotes and backslashes in a title cannot break the file", () => {
    const result = createDraft("ana/ana-trip", {
      ...DRAFT,
      title: 'A "quoted" \\ title',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // JSON.stringify's own escaping, not the YAML escaper this used to
    // exercise (dayToJson/lib/api/v2/documents.ts, B1606) — a string is a
    // string now, and there is no frontmatter delimiter left to break.
    expect(fs.readFileSync(result.file, "utf8")).toContain(
      JSON.stringify('A "quoted" \\ title'),
    );
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
    expect(path.basename(result.file)).toBe("2026-01-02-rueckfahrt.json");
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
    // No currency means the day's own country (B542) — DRAFT's is Vietnam.
    expect(entry.costs[1]).toMatchObject({ label: "Bus", amount: 12, currency: "VND" });
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
    expect(fs.readFileSync(result.file, "utf8")).toContain('"travelScene": "quick"');
    const entry = getAllEntries("ana/ana-trip", { includeDrafts: true })[0];
    expect(entry.travelScene).toBe("quick");
  });

  test("an unrecognised travelScene round-trips into the file but reads back as the default", () => {
    // Unlike transportMode, a typo here is not refused at write time (B15) —
    // it is written as sent, the same way an unrecognised trip `visibility:`
    // is, and it is the read side that falls back rather than the write.
    const result = createDraft("ana/ana-trip", { ...DRAFT, travelScene: "epic-flyover" });
    if (!result.ok) throw new Error("expected the draft to be written");
    expect(fs.readFileSync(result.file, "utf8")).toContain('"travelScene": "epic-flyover"');
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
    expect(fs.readFileSync(result.file, "utf8")).toContain('"test": true');
    expect(getAllEntries("ana/ana-trip", { includeDrafts: true })[0].test).toBe(true);
  });

  test("is absent from an ordinary day, rather than written as false", () => {
    const result = createDraft("ana/ana-trip", DRAFT);
    if (!result.ok) throw new Error("expected the draft to be written");
    expect(fs.readFileSync(result.file, "utf8")).not.toContain('"test"');
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

describe("the documents an agent reads (v2, step 6 of the v2 migration)", () => {
  /**
   * `agentGuide()` (the 140+ KB hand-written v1 guide) is retired with this
   * ticket — docs/v2-migration/03-build-order.md, step 6. `/documentation.txt`
   * is slimmed to narrative; the field-by-field reference lives in the nine
   * generated /skill/*.md documents and in /api/v2/openapi.json, generated
   * from the frozen Zod schemas in lib/api/v2/schemas/. These tests check the
   * new shape rather than the old one's size ceilings, which no longer apply
   * to a document that no longer inlines a whole write-flow's worth of JSON.
   */
  test("the instance document stays small enough to fetch and read as a fallback", () => {
    const bytes = Buffer.byteLength(instanceDocumentation(), "utf8");
    expect(bytes).toBeLessThan(30 * 1024);
  });

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

  test("the summary states the draft rule and names the publish call", () => {
    const summary = instanceDocumentation();
    expect(summary).toMatch(/draft/i);
    expect(summary).toContain("days/<slug>/publish");
    // The v2 shape: PUT/PATCH, not just POST, and no argument that publishes
    // as a side effect of writing.
    expect(summary).toMatch(/no argument that changes that/i);
  });

  /**
   * B256: an agent that could not fetch a further document had read only
   * three prose steps here and had no call it could actually make. Step 6 of
   * the v2 migration deliberately moves that inlined shape out of the index
   * — /documentation.txt now points at /skill/new-account.md, which carries
   * the actual codes/redeem/journals calls, generated from the schema.
   */
  test("the summary points at the guide that carries the signup calls", () => {
    const summary = instanceDocumentation();
    expect(summary).toContain("/skill/new-account.md");
    const guide = skillDoc("new-account");
    expect(guide).toContain("/api/auth/codes");
    expect(guide).toContain("/api/auth/codes/redeem");
    expect(guide).toContain("POST /api/v2/journals");
  });

  test("the new-account guide carries the journal-create shape with every required field", () => {
    // The v2 fields, generated from the schema — not a hand-typed copy that
    // could omit one and go unnoticed the way the v1 example once did.
    const guide = skillDoc("new-account");
    for (const field of ["username", "title", "ownerName", "ownerNickname", "visibility", "defaultLocale", "locales", "baseCurrency"]) {
      expect(guide, `${field} must appear in the journals field table`).toContain(`\`${field}\``);
    }
    expect(guide).toContain("POST /api/v2/journals");
  });

  test("the new-account guide documents authentication without ever mailing a token", () => {
    const guide = skillDoc("new-account");
    expect(guide).toContain("/api/auth/codes");
    expect(guide).toContain("/api/auth/codes/redeem");
  });

  test("the summary tells an agent not to invent detail", () => {
    expect(instanceDocumentation()).toMatch(/no weather nobody mentioned/i);
  });

  /**
   * B331: an agent holding a valid owner token was asked to invite somebody,
   * found no call, and invented a browser "dashboard" that does not exist.
   * The instance document names the invites guide in a heading of its own,
   * and a journal's own document names the v2 door directly.
   */
  test("a journal's own document names the v2 invites endpoint", () => {
    const doc = userDocumentation("ana")!;
    expect(doc).toContain("/api/v2/ana/invites");
  });

  test("the instance document has its own heading for invites, not only a mention inside onboarding", () => {
    const summary = instanceDocumentation();
    const headingIdx = summary.indexOf("## Letting other people in");
    expect(headingIdx).toBeGreaterThan(-1);
    const journalsIdx = summary.indexOf("## Journals");
    expect(journalsIdx).toBeGreaterThan(headingIdx);
    const section = summary.slice(headingIdx, journalsIdx);
    expect(section.toLowerCase()).toContain("invite");
    expect(section).toContain("/skill/invite-someone.md");
  });

  test("the invite-someone guide names both link kinds and says which grants write access", () => {
    const guide = skillDoc("invite-someone");
    expect(guide).toContain("/invite/guest/");
    expect(guide).toContain("/invite/buddy/");
    expect(guide.toLowerCase()).toContain("write access");
  });
});

describe("what the v2 guides have to tell an agent", () => {
  /** These documents are wrapped at 78 in the instance index, so a shared
   * sentence lands across lines. Collapsing whitespace asserts the wording
   * without asserting the wrapping. */
  const flat = (text: string) => text.replace(/\s+/g, " ");

  test("names the things to ask the person before creating a journal", () => {
    const guide = skillDoc("new-account");
    expect(guide).toMatch(/public[\s\S]*guest/i);
    expect(guide).toMatch(/never derived/i);
  });

  test("the add-a-day guide says it always arrives as a draft, and PATCH never publishes", () => {
    const guide = skillDoc("add-a-day");
    expect(guide).toMatch(/arrives as a draft/i);
    expect(guide).toMatch(/status[\s\S]*never accepted/i);
  });

  test("the add-a-day guide describes the asked-or-declined mechanism, not v1's false/\"unknown\"", () => {
    const guide = skillDoc("add-a-day");
    expect(guide).toMatch(/declined/);
    expect(guide).not.toMatch(/"costs":\s*false/);
    expect(guide).not.toMatch(/"unknown"/);
  });

  test("the add-a-day guide documents the weather field's two honest routes", () => {
    const guide = skillDoc("add-a-day");
    expect(guide).toMatch(/weather: true/);
    expect(guide).toMatch(/weatherData/);
    expect(guide).toMatch(/open-meteo/);
  });

  test("the add-a-day guide says a published day cannot be deleted through this door", () => {
    const guide = skillDoc("add-a-day");
    expect(guide).toMatch(/published_day_not_deletable/);
  });

  test("the add-a-trip guide shows the trip's whole shape and explains asked-or-declined", () => {
    const guide = skillDoc("add-a-trip");
    expect(guide).toContain("`costs`");
    expect(guide).toContain("`translations`");
    expect(guide).toMatch(/asked, or declined/i);
  });

  test("the add-a-trip guide says buddies are their own question", () => {
    const guide = skillDoc("add-a-trip");
    expect(guide.toLowerCase()).toContain("buddies");
    expect(guide).toMatch(/travelling solo/i);
  });

  test("every document defines journal visibility with the same words", () => {
    // Not a substring check against a hand-typed copy — the constant itself
    // is the expectation, shared with lib/api/openapi.ts (v1, untouched).
    expect(flat(instanceDocumentation())).toContain(flat(VISIBILITY_MEANING));
  });

  test("the summary carries the warning that private is not a lock", () => {
    expect(flat(instanceDocumentation())).toContain(
      flat(VISIBILITY_NOT_A_LOCK.replace(/`/g, "")),
    );
  });

  test("the summary says a private trip shuts out approved guests", () => {
    expect(flat(instanceDocumentation())).toContain(
      flat(PRIVATE_SHUTS_OUT_GUESTS.replace(/`/g, "")),
    );
  });

  test("the ingest-photos guide names the real v2 media field names", () => {
    const guide = skillDoc("ingest-photos");
    expect(guide).toContain("multipart/form-data");
    expect(guide).toMatch(/file=@/);
    expect(guide).toContain("`intent.kind`");
    expect(guide).toContain("EXIF");
  });

  test("the costs guide states the v2 manual-rate convention, which differs from v1's", () => {
    const guide = skillDoc("costs");
    expect(guide).toMatch(/units per 1 EUR/i);
    expect(guide).toMatch(/different convention from v1/i);
  });

  test("the invite-someone guide says a link grants nothing by itself", () => {
    const guide = skillDoc("invite-someone");
    expect(guide).toMatch(/grants anything by itself/i);
    expect(guide).toMatch(/never reads back/i);
  });

  test.skipIf(!fs.existsSync(path.join(process.cwd(), "paid")))("the send-postcards guide says the owner presses the button, never the agent", () => {
    const guide = skillDoc("send-postcards");
    expect(guide).toMatch(/charges nothing and prints nothing/i);
    expect(guide).toMatch(/never a street/i);
  });

  test("the make-a-photobook guide says there is nothing here to propose", () => {
    const guide = skillDoc("make-a-photobook");
    expect(guide).toMatch(/nothing here for you to propose/i);
  });

  test("the add-journal guide says features are instance-only, not a field on the journal", () => {
    const guide = skillDoc("add-journal");
    expect(guide).toMatch(/features[\s\S]*are not a field here/i);
    expect(guide).toMatch(/deletes nothing/i);
  });

  test("the index asks the same journal-creation questions firstQuestions() names, before the first call", () => {
    // Whole-sentence matching, the way the rest of this file already checks
    // shared prose — not a positional derivation from firstQuestions()'s own
    // markdown, which would just be re-deriving the thing being checked.
    const index = flat(instanceDocumentation());
    // firstQuestions() itself is still exercised above via VISIBILITY_MEANING
    // (question 4's own "because" sentence); this checks the index states
    // the same eight topics in its own numbered-list voice.
    expect(firstQuestions("https://example.test")).toHaveLength(8);
    for (const topic of [
      "email address",
      "journal's address",
      "journal is called",
      "public or guest",
      "what the site should call them",
      "which language",
      "which languages a reader may switch",
      "what they count money in",
    ]) {
      expect(index.toLowerCase(), `the index should ask about: ${topic}`).toContain(topic);
    }
  });
});

describe("the entry document tells an agent whether it can write here", () => {
  test("states the POST/PUT/PATCH-with-bearer requirement above the questions", () => {
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
    const summary = instanceDocumentation().replace(/\s+/g, " ");
    expect(summary).toMatch(/no upload interface/i);
    expect(summary).toMatch(/no web form/i);
    expect(summary).toMatch(/no CMS/i);
    expect(summary).toMatch(/manually upload/i);
    expect(summary).toMatch(/follow this guide themselves/i);
  });

  test("points an agent at the generated machine contract and the task guides, not an inlined write-flow", () => {
    const summary = instanceDocumentation();
    expect(summary).toContain("/api/v2/openapi.json");
    expect(summary).toContain("/skill/new-account.md");
    expect(summary).toContain("/skill/add-a-trip.md");
    expect(summary).toContain("/skill/add-a-day.md");
  });
});

describe("the generated v2 machine contract carries what the guides promise", () => {
  test("openapi.json documents the day, trip and journal create doors", () => {
    const doc = openApiDocumentV2() as unknown as { paths: Record<string, unknown> };
    expect(doc.paths["/api/v2/{user}/trips/{trip}/days/{slug}"]).toBeTruthy();
    expect(doc.paths["/api/v2/{user}/trips/{trip}"]).toBeTruthy();
    expect(doc.paths["/api/v2/journals"]).toBeTruthy();
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
      /^\/skill\/[a-z-]+\.md$/.test(p) ||
      // Rewritten in next.config.ts to /api/well-known/… — RFC 9728 requires
      // the well-known segment first, which Next cannot express as a directory.
      p.startsWith("/.well-known/") ||
      // The documentation hub and its pages — app/docs/**.
      p.startsWith("/docs/") ||
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
})

// "the wrong-verb messages name doors that exist" (B414) has no tests left.
// The trip route's own wrong-verb message went first: B622 gave `PATCH` the
// four fields it had spent two tickets apologising for not having, so there
// was no message left to keep honest. The journal route's followed —
// B1632 retired v1's `/api/v1/{user}` (PATCH answered 405 on purpose, a
// signpost to `.../config`) once `PATCH /api/v2/{user}` covered the same
// ground for real, so there is no wrong-verb stub left to keep honest either.
