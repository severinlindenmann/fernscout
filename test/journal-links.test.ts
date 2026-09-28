import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { movedJournalPath } from "@/lib/movedJournal";

/**
 * Journal addresses are `/@<user>` and are built with `journalPath()`
 * (`lib/journalPath.ts`). A link written the old way — `/${username}/studio`
 * — still compiles, still renders, and sends the reader to a 404, so this
 * reads the source for the shapes that build one.
 *
 * It exists because the move was done more than once: other work kept
 * landing with the old shape after the codemod had swept the tree.
 */

const ROOT = process.cwd();
const DIRS = ["app", "components", "lib", "paid"];
const USERISH = String.raw`(?:encodeURIComponent\(\s*)?[\w$.]*?(?:[Uu]ser(?:name)?|[Oo]wner|[Jj]ournal|[Hh]andle)[\w$.]*(?:\s*\))?`;

/** Shapes that build a journal page URL without `journalPath`. */
const BAD: { name: string; re: RegExp }[] = [
  // `/${username}/studio`, `/${trip.username}`
  { name: "template starting /${user}", re: new RegExp("`/\\$\\{" + USERISH + "\\}", "g") },
  // `${base}/${username}/…`, `${site.url}/${owner}` — an absolute journal URL
  { name: "${base}/${user}", re: new RegExp("\\$\\{(?![^}]*JOURNAL_ROUTE_ROOT)[^}]*\\}/\\$\\{" + USERISH + "\\}", "g") },
  // "/" + username
  { name: '"/" + user', re: new RegExp(`["'\`]/["'\`]\\s*\\+\\s*${USERISH}`, "g") },
];

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // paid/test is that repository's own suite, with its own fixtures.
        if (path.relative(ROOT, full) === path.join("paid", "test")) continue;
        walk(full);
      } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const dir of DIRS) walk(path.join(ROOT, dir));
  return out;
}

describe("journal links are built with journalPath", () => {
  test("no source builds a /<user> page URL by hand", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const rel = path.relative(ROOT, file);
      if (rel === path.join("lib", "journalPath.ts")) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const { name, re } of BAD) {
          for (const m of line.matchAll(re)) {
            // `/api/v2/${user}` and friends are API paths, which keep the bare name.
            const before = line.slice(0, m.index);
            if (/\/api\/[\w/${}.()-]*$/.test(before) || /\/api\/[\w/${}.()-]*$/.test(m[0])) continue;
            offenders.push(`${rel}:${i + 1} (${name}): ${line.trim().slice(0, 140)}`);
          }
        }
      });
    }
    expect(offenders, `build these with journalPath() from lib/journalPath.ts:\n${offenders.join("\n")}`).toEqual([]);
  });

  test("the scan itself catches each shape", () => {
    const samples = [
      "const a = `/${username}/studio`;",
      "const b = `${site.url}/${trip.username}/trips`;",
      'const c = "/" + owner;',
    ];
    for (const sample of samples) {
      expect(BAD.some(({ re }) => new RegExp(re.source).test(sample)), sample).toBe(true);
    }
    for (const fine of ["const d = `/api/v2/${user}/status`;", "const e = `${journalPath(user)}/studio`;"]) {
      const hit = BAD.some(({ re }) => {
        const m = new RegExp(re.source).exec(fine);
        return m && !/\/api\//.test(fine.slice(0, m.index) + m[0]);
      });
      expect(hit, fine).toBe(false);
    }
  });
});

describe("a journal's old address is sent on", () => {
  // `example` ships in content/, so it exists without any fixture.
  test("to the @ form, rest and query kept", () => {
    expect(movedJournalPath("/example", "")).toBe("/@example");
    expect(movedJournalPath("/example/studio/day/new", "?trip=usa-2026")).toBe("/@example/studio/day/new?trip=usa-2026");
    expect(movedJournalPath("/example/feed.xml", null)).toBe("/@example/feed.xml");
  });

  test("never for a name that is not a journal, an @ path, or an app page", () => {
    expect(movedJournalPath("/nobody-here/studio", "")).toBeNull();
    expect(movedJournalPath("/@example/studio", "")).toBeNull();
    expect(movedJournalPath("/docs", "")).toBeNull();
    expect(movedJournalPath("/api/v2/example", "")).toBeNull();
    expect(movedJournalPath(null, null)).toBeNull();
    // A search value that is not a query string is dropped, not appended.
    expect(movedJournalPath("/example", "/evil")).toBe("/@example");
  });
});
