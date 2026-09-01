import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, listDrafts, slugify, validateDraft } from "@/lib/api/entries";
import { agentGuide, instanceDocumentation, userDocumentation } from "@/lib/api/documentation";
import { getAllEntries } from "@/lib/entries";
import { validateEntry } from "@/lib/validate/entry";

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
    expect(guide).toMatch(/no\s+parameter,\s+header\s+or\s+endpoint\s+that\s+skips/i);
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
describe("what the guide has to tell an agent before it starts", () => {
  test("names the four things to ask the person", () => {
    const guide = agentGuide();
    expect(guide).toMatch(/email address/i);
    expect(guide).toMatch(/public or private/i);
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

  test("documents idempotency_key for REST, not only for MCP", () => {
    const guide = agentGuide();
    const restSection = guide.slice(0, guide.indexOf("## The same thing as MCP"));
    expect(restSection).toContain("idempotency_key");
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
    for (const field of ["costs", "transportMode", "test"]) {
      expect(guide, `${field} must be documented`).toContain(field);
    }
  });

  test("a journal's own document shows a twin URL with a real trip in it", () => {
    // The demo journal's docs said "append .md to a day's URL" and left the
    // reader to guess that the URL has a trip in it. It does.
    const doc = userDocumentation("ana")!;
    expect(doc).toContain("/ana/trips/ana-trip/day/<slug>.md");
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
