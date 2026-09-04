import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * No tracked file carries an unresolved merge conflict.
 *
 * B227. Commit `4705300` merged `deploy/Caddyfile` with the markers still in
 * it — three of them, thirty-eight lines of duplicated site block between — and
 * every gate stayed green. A person found it by eye a few hours later.
 *
 * Why nothing caught it is the useful part. Three checks read that file and all
 * three ask the same kind of question: `test/client-ip.test.ts` matches
 * `/^import\s+\S*deploy\/fernscout\.caddy$/m`, and two more match `header_up`
 * and the `reverse_proxy` block in `deploy/fernscout.caddy`. A line-anchored
 * regex asks whether some string is *somewhere* in the file. It cannot ask
 * whether the file is still a file — and the import line survived inside the
 * conflict's second half, so the regex matched a config Caddy would have
 * refused to load. Caddy is a single-config-file server, so that is a VPS with
 * no proxy at all.
 *
 * This is the cheap half of the answer and it is deliberately not about Caddy.
 * It needs no binary, runs everywhere `npx vitest run` does, and catches the
 * class in every tracked file rather than in the one that happened to break
 * this time. The expensive half — actually adapting the shipped Caddyfile
 * through `caddy adapt` — is in `test/check-caddy.test.ts`, where it skips
 * without a `caddy` binary until B226 puts one in CI.
 *
 * **The three regex assertions in `test/client-ip.test.ts` stay.** They assert
 * *content* and are correct at that job. What was missing is an assertion about
 * *shape*, which is this file. Neither replaces the other.
 */

const ROOT = process.cwd();

/**
 * The marker strings, built rather than written out.
 *
 * A test that hunts for `<<<<<<<` and spells it literally is a tracked file
 * carrying a conflict marker, and would fail itself on the first run.
 */
const OPEN = "<".repeat(7);
const MID = "|".repeat(7);
const SPLIT = "=".repeat(7);
const CLOSE = ">".repeat(7);

/**
 * A marker line is the exact seven characters at the start of a line, followed
 * by a space or the end of the line — git's own shape.
 *
 * `OPEN` and `CLOSE` are conclusive on their own: no language in this
 * repository begins a line that way for any other reason.
 *
 * `SPLIT` and `MID` are only counted in a file that already has one of those,
 * because seven `=` at the start of a line is also a valid Markdown setext
 * heading underline. Requiring the company of an opening or closing marker
 * costs nothing — a real conflict always has all of them — and keeps a
 * perfectly ordinary document from failing the build.
 */
export function conflictMarkers(text: string): { line: number; marker: string }[] {
  const lines = text.split("\n");
  const decisive: { line: number; marker: string }[] = [];
  const dependent: { line: number; marker: string }[] = [];

  for (const [index, line] of lines.entries()) {
    for (const marker of [OPEN, CLOSE]) {
      if (line.startsWith(marker) && (line.length === marker.length || line[marker.length] === " ")) {
        decisive.push({ line: index + 1, marker });
      }
    }
    for (const marker of [SPLIT, MID]) {
      if (line.startsWith(marker) && (line.length === marker.length || line[marker.length] === " ")) {
        dependent.push({ line: index + 1, marker });
      }
    }
  }

  if (decisive.length === 0) return [];
  return [...decisive, ...dependent].sort((a, b) => a.line - b.line);
}

/** Tracked files, from git — the same source `test/depersonalised.test.ts` uses. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

/** A NUL in the first few kilobytes means a photograph, not a source file. */
function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

describe("no tracked file carries a merge conflict", () => {
  const tracked = trackedFiles();

  test("git is readable and the tree is not empty", () => {
    expect(tracked.length).toBeGreaterThan(50);
  });

  test("every tracked text file is free of conflict markers", () => {
    const found: string[] = [];
    for (const file of tracked) {
      const absolute = path.join(ROOT, file);
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(absolute);
      } catch {
        // A file in the index that is not on disk right now (a submodule, a
        // half-applied checkout). Not this test's business.
        continue;
      }
      if (isBinary(bytes)) continue;
      for (const hit of conflictMarkers(bytes.toString("utf8"))) {
        found.push(`${file}:${hit.line} begins with a ${hit.marker} conflict marker`);
      }
    }
    expect(found, `unresolved merge conflict:\n  ${found.join("\n  ")}`).toEqual([]);
  });

  // The deploy files by name, so a failure says the word "Caddyfile" rather
  // than only appearing in a list of a thousand. These are the files B227 is
  // about: an unparseable one is a refused reload and a VPS with no proxy.
  for (const file of ["deploy/Caddyfile", "deploy/fernscout.caddy"]) {
    test(`${file} is free of conflict markers`, () => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      const hits = conflictMarkers(text);
      expect(hits, `${file} has a conflict marker at line ${hits[0]?.line}`).toEqual([]);
    });
  }
});

describe("the detector itself", () => {
  /**
   * `deploy/Caddyfile` as commit `4705300` had it: the shipped file with the
   * two halves of the merge spliced back around it.
   *
   * Rebuilt rather than read out of git history, because CI checks out at
   * depth 1 and `git show 4705300:deploy/Caddyfile` would not resolve there.
   * The shape is what matters and the shape is exact.
   */
  function asCommittedAt4705300(): string {
    const shipped = fs.readFileSync(path.join(ROOT, "deploy", "Caddyfile"), "utf8");
    const importLine = /^import\s+\S*deploy\/fernscout\.caddy$/m;
    expect(shipped).toMatch(importLine);
    return shipped.replace(
      importLine,
      [
        `${OPEN} HEAD`,
        "{$CADDY_DOMAIN} {",
        "\tencode gzip zstd",
        "\treverse_proxy 127.0.0.1:3000 {",
        "\t\theader_up X-Forwarded-For {remote_host}",
        "\t}",
        "}",
        SPLIT,
        "import /srv/fernscout/deploy/fernscout.caddy",
        `${CLOSE} g11-backup-systemd-and-tests`,
      ].join("\n"),
    );
  }

  test("catches deploy/Caddyfile in the state that shipped green", () => {
    const hits = conflictMarkers(asCommittedAt4705300());
    expect(hits.map((h) => h.marker)).toEqual([OPEN, SPLIT, CLOSE]);
  });

  test("the import line the old regex matched is still there, which is the point", () => {
    // The regex in test/client-ip.test.ts passed on this exact text. A check
    // that only asks whether a string is present cannot notice a broken file.
    expect(asCommittedAt4705300()).toMatch(/^import\s+\S*deploy\/fernscout\.caddy$/m);
  });

  test("a Markdown setext heading is not a conflict", () => {
    expect(conflictMarkers(`A title\n${SPLIT}\n\nSome prose.\n`)).toEqual([]);
  });

  test("a marker quoted in prose, indented or inline, is not reported", () => {
    expect(conflictMarkers(`Look for \`${OPEN} HEAD\` in the file.\n`)).toEqual([]);
    expect(conflictMarkers(`  ${OPEN} HEAD\n`)).toEqual([]);
  });

  test("seven characters exactly, and a separator after them", () => {
    expect(conflictMarkers(`${"<".repeat(8)} HEAD\n`)).toEqual([]);
    expect(conflictMarkers(`${OPEN}HEAD\n`)).toEqual([]);
    expect(conflictMarkers(`${OPEN} HEAD\n`)).toHaveLength(1);
    expect(conflictMarkers(`${OPEN}\n`)).toHaveLength(1);
  });

  test("a diff3 base marker is reported alongside the others", () => {
    const text = `${OPEN} HEAD\na\n${MID} base\nb\n${SPLIT}\nc\n${CLOSE} branch\n`;
    expect(conflictMarkers(text).map((h) => h.marker)).toEqual([OPEN, MID, SPLIT, CLOSE]);
  });
});
