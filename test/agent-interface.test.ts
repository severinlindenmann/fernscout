import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, listDrafts, slugify, validateDraft } from "@/lib/api/entries";
import { agentGuide, instanceDocumentation, userDocumentation } from "@/lib/api/documentation";
import { getAllEntries } from "@/lib/entries";

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
