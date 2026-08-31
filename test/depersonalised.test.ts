import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The clone test.
 *
 * The whole point of the content folder is that someone can delete it, drop in
 * their own, and have their own site. That only holds if nothing personal has
 * leaked into the code — which is exactly the kind of thing that creeps back in
 * one hardcoded string at a time. This fails the build when it does.
 *
 * Documentation is deliberately not covered: docs and the README talk about the
 * project and its author on purpose. Code must not.
 */

const ROOT = process.cwd();
const CODE_DIRS = ["lib", "app", "components", "scripts", "public"];

/**
 * The demo-content generator names the demo trips, which is its job. Every
 * other file in `scripts/` is still checked.
 */
const EXEMPT = new Set(["scripts/build-demo-content.mjs"]);

/**
 * Names, places and identifiers belonging to this instance rather than to the
 * software — read out of the content folder rather than written down here.
 *
 * They used to be a hardcoded list, which had two problems. It went stale the
 * moment somebody was renamed or a trip added, so the guard quietly stopped
 * guarding the thing it was named after. And it meant this file — the one
 * whose whole job is keeping personal names out of the repository — was itself
 * the place those names were written down, which is a poor joke to leave in a
 * public repository.
 *
 * Derived instead from whatever `content/` actually holds: every traveller's
 * name and nickname, the journal titles, the credited author, and every trip
 * id. A fork gets its own list for free, and a rename cannot outrun it.
 */
function personalTerms(): RegExp[] {
  const terms = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    // Short words match half the English language. "Alex" is worth checking;
    // "Al" is not.
    for (const word of value.split(/[\s+,/]+/)) {
      const clean = word.trim();
      if (clean.length >= 4) terms.add(clean);
    }
  };

  const contentRoot = path.join(ROOT, "content");
  const readJson = (file: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const server = readJson(path.join(contentRoot, "config.json"));
  const credit = (server?.site as { credit?: { name?: unknown } } | undefined)?.credit;
  add(credit?.name);

  let usernames: string[] = [];
  try {
    usernames = fs
      .readdirSync(contentRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    usernames = [];
  }

  for (const username of usernames) {
    // The demo journal is *meant* to be referred to by name in the code that
    // builds it, and its trips are the ones the tests use.
    if (username === "example" || username === "locales" || username === "rates") continue;
    const user = readJson(path.join(contentRoot, username, "config.json"));
    if (!user) continue;
    add(user.title);
    for (const traveller of Array.isArray(user.travellers) ? user.travellers : []) {
      const t = traveller as { name?: unknown; nickname?: unknown };
      add(t.name);
      add(t.nickname);
    }
    try {
      for (const trip of fs.readdirSync(path.join(contentRoot, username, "trips"))) {
        if (!trip.startsWith(".")) terms.add(trip);
      }
    } catch {
      // A journal with no trips yet.
    }
  }

  return [...terms].map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
}

const PERSONAL = personalTerms();

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mjs|js|jsx|json|css|svg|webmanifest)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("nothing personal in code", () => {
  const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  test("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * A clone with only the demo content has nothing personal to look for, and
   * that is the correct answer rather than a broken test — but it must be
   * *said*, because a silently empty list of patterns is a suite that passes
   * by checking nothing.
   */
  test("reports what it is looking for", () => {
    if (PERSONAL.length === 0) {
      expect(fs.existsSync(path.join(ROOT, "content", "example"))).toBe(true);
      return;
    }
    expect(PERSONAL.length).toBeGreaterThan(0);
  });

  for (const pattern of PERSONAL) {
    test(`no source file matches ${pattern}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        if (EXEMPT.has(path.relative(ROOT, file))) continue;
        const text = fs.readFileSync(file, "utf8");
        text.split("\n").forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(hits, `move this into content/config.json or content/:\n${hits.join("\n")}`).toEqual(
        [],
      );
    });
  }
});

describe("the example content set", () => {
  const dir = path.join(ROOT, "content", "example");

  test("exists and holds a trip", () => {
    expect(fs.existsSync(path.join(dir, "trips"))).toBe(true);
    expect(fs.readdirSync(path.join(dir, "trips")).length).toBeGreaterThan(0);
  });

  test("has its own config", () => {
    expect(fs.existsSync(path.join(dir, "config.json"))).toBe(true);
  });

  test("is itself free of personal data", () => {
    const hits: string[] = [];
    for (const file of walk(dir).concat(
      walk(dir).length ? [] : [],
    )) {
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of PERSONAL) {
        if (pattern.test(text)) hits.push(`${path.relative(ROOT, file)} matches ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("ships media inside the trip, not in public/", () => {
    const trip = fs.readdirSync(path.join(dir, "trips"))[0];
    expect(fs.existsSync(path.join(dir, "trips", trip, "media"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "public", "media"))).toBe(false);
  });
});

describe("the shipped content actually parses", () => {
  /**
   * The example's planned route silently parsed as no route at all for weeks:
   * it used `stops:`/`name:` while lib/plan.ts reads `route:`/`location:`. The
   * file was present, the map drew nothing, and nothing anywhere said so.
   *
   * Shipping content that quietly does not work is worse than shipping none,
   * because it is what a new self-hoster copies.
   */
  test("every trip with a plan.md has a route that resolves", async () => {
    const { getPlan } = await import("@/lib/plan");
    const { getAllTrips } = await import("@/lib/trips");

    const broken: string[] = [];
    for (const trip of getAllTrips()) {
      const planFile = path.join(
        ROOT,
        "content",
        trip.username,
        "trips",
        trip.id,
        "plan.md",
      );
      if (!fs.existsSync(planFile)) continue;
      if (getPlan(trip.ref).stops.length === 0) broken.push(trip.ref);
    }
    expect(broken, `these ship a plan.md that parses to no stops:\n${broken.join("\n")}`).toEqual(
      [],
    );
  });
});

/**
 * What is *tracked*, as opposed to what is in the source directories.
 *
 * The check above walks `lib`, `app`, `components`, `scripts` and `public` and
 * reads text files. It could therefore not see a 2.6 MB `severin-export.zip`
 * sitting in the repository root — an `npm run export` of the author's real
 * journal, with their trips, photographs and their family's names in it,
 * committed and staged for an open-source release. Nor three stray
 * screenshots beside it.
 *
 * So this asks git what is tracked, and judges by name rather than by content:
 * an archive of somebody's journal is not a thing this repository ever needs,
 * whatever it is called inside.
 */
describe("nothing personal is tracked", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  test("git is readable and the tree is not empty", () => {
    expect(tracked.length).toBeGreaterThan(50);
  });

  test("no journal export is committed", () => {
    const archives = tracked.filter((f) => /\.(zip|tar|tar\.gz|tgz)$/i.test(f));
    expect(
      archives,
      "`npm run export` writes real content. Untrack it and add it to .gitignore:\n" +
        archives.join("\n"),
    ).toEqual([]);
  });

  /**
   * Loose images at the root are screenshots somebody took to look at once.
   * Anything the documentation genuinely needs belongs in `docs/` or `public/`,
   * where it is referenced rather than merely present.
   */
  test("no loose image sits in the repository root", () => {
    const loose = tracked.filter((f) => /^[^/]+\.(png|jpe?g|gif|webp|heic)$/i.test(f));
    expect(loose, `move these under docs/ or public/, or delete them:\n${loose.join("\n")}`).toEqual(
      [],
    );
  });

  /**
   * `content/` is excluded: it is where trip ids and people's names belong, and
   * `asia-2023` is in PERSONAL to keep a hardcoded trip id out of *code*, not
   * to ban one from a journal. Everywhere else, a path named after somebody on
   * this instance is a file that should not have been committed.
   */
  test("no tracked path outside content/ is named after a person here", () => {
    const named = tracked
      .filter((f) => !f.startsWith("content/"))
      .filter((f) => PERSONAL.some((p) => p.test(f)));
    expect(named, `rename or untrack:\n${named.join("\n")}`).toEqual([]);
  });
});
