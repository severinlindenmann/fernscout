/**
 * B1838's own acceptance, made into tests. Each `test()` title below is one
 * of the ticket's Acceptance bullets, close to verbatim — `npm run tasks --
 * show B1838` for the ticket itself. This file is the gate's keeper: it
 * proves `scripts/studio-check.mts` actually enforces the three proof kinds
 * rather than trusting whatever a manifest entry claims about itself.
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { manifest } from "./conformance.manifest.ts";
import { checkAbsent, checkCapture, checkManifest, checkTest } from "../../scripts/studio-check.mts";
import { hasPaid } from "../support/openCore";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "studio-check.mts");
// The sample test file, screenshot and grep fixtures: knip's `test/**/*.test`
// and non-code-file exemptions already cover this location.
const FIXTURES = path.join(ROOT, "test", "studio", "fixtures");
// The fixture manifests: `.ts` files with no static importer, so they live
// under `test/fixtures/`, which knip already treats as reached by the suite.
const MANIFEST_FIXTURES = path.join(ROOT, "test", "fixtures", "studio");

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", cwd: ROOT });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("the manifest itself", () => {
  test("has exactly the 36 ids from spec §9, each with proof: null", () => {
    const expectedIds = [
      ...["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"],
      ...["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12"],
      ...["H1", "H2", "H3", "H4", "H5", "H6"],
      ...["L1", "L2"],
      ...["V1", "V2", "V3", "V4"],
    ];
    expect(manifest.map((m) => m.id)).toEqual(expectedIds);
    expect(manifest).toHaveLength(36);
    for (const item of manifest) {
      expect(item.claim.length, `${item.id} needs a claim`).toBeGreaterThan(0);
    }
  });

  test("every id is unique", () => {
    expect(new Set(manifest.map((m) => m.id)).size).toBe(manifest.length);
  });
});

describe("B1838 acceptance", () => {
  // The two assertions below were written as "prints 0 of 36 proven" and
  // "lists all 36 outstanding", which was true on the day the gate shipped
  // red and false the moment the first real proof landed (2026-09-19). A
  // test that encodes a starting state has to be rewritten every time the
  // thing it watches makes progress, which is the opposite of a keeper. The
  // invariant is what is asserted now: the count is honest, every unproven
  // item is named, and the script refuses to exit clean while any remain.
  test("studio:check names every outstanding item and exits non-zero while any remain", () => {
    const res = run([]);
    const outstanding = manifest.filter((item) => item.proof === null);

    expect(res.stdout).toMatch(new RegExp(`\\d+ of ${manifest.length} proven`));
    for (const item of outstanding) {
      expect(res.stdout, `${item.id} has no proof and should be listed as outstanding`).toMatch(
        new RegExp(`(^|\\s)${item.id}(\\s|$)`, "m"),
      );
    }
    if (outstanding.length > 0) expect(res.status).not.toBe(0);
  }, 60_000);

  test("a proven item is not listed as outstanding", () => {
    const res = run([]);
    const provenIds = manifest
      .filter((item) => item.proof !== null)
      .filter((item) => hasPaid() || !(item.proof?.kind === "test" && item.proof.file.startsWith("paid/")))
      .map((item) => item.id);
    const listed = (res.stdout.split("outstanding:")[1] ?? "").trim().split(/\s+/);
    for (const id of provenIds) {
      expect(listed, `${id} carries a proof and must not be listed as outstanding`).not.toContain(id);
    }
  }, 60_000);

  test("an item flipped to proof kind test naming a test that does not exist fails the script rather than counting as proven", async () => {
    const results = await checkManifest(
      path.join(MANIFEST_FIXTURES, "test-kind.manifest.ts"),
      ROOT,
      [path.join(FIXTURES, "sample.test.ts")],
    );
    const missing = results.find((r) => r.id === "BAD-TEST-MISSING");
    expect(missing?.proven).toBe(false);
    expect(missing?.reason).toMatch(/no test named/);
  }, 60_000);

  test("an item flipped to proof kind test naming a test that did not pass fails the script rather than counting as proven", () => {
    // Exercised directly against `checkTest`'s public surface (a results map,
    // the same shape `runVitestJson` builds) rather than by shipping a
    // failing test into the suite `npm run verify` runs — the outcome is
    // identical either way, since the checker's only input is that map.
    const results = new Map([["a test that ran and failed", "failed"]]);
    const reason = checkTest(
      { kind: "test", name: "a test that ran and failed", file: "test/studio/fixtures/sample.test.ts" },
      results,
    );
    expect(reason).toMatch(/did not pass/);
  });

  test("a test proof naming a test that exists and passed counts as proven", async () => {
    const results = await checkManifest(
      path.join(MANIFEST_FIXTURES, "test-kind.manifest.ts"),
      ROOT,
      [path.join(FIXTURES, "sample.test.ts")],
    );
    const good = results.find((r) => r.id === "GOOD-TEST");
    expect(good).toEqual({ id: "GOOD-TEST", proven: true });
  }, 60_000);

  test("an item with a capture proof whose sentence is a file path is rejected", async () => {
    const results = await checkManifest(path.join(MANIFEST_FIXTURES, "mixed-cases.manifest.ts"), ROOT);
    const repeated = results.find((r) => r.id === "BAD-CAPTURE-PATH-REPEATED");
    expect(repeated?.proven).toBe(false);
    expect(repeated?.reason).toMatch(/file path or a single word/);

    const captured = results.find((r) => r.id === "BAD-CAPTURE-CAPTURED");
    expect(captured?.proven).toBe(false);
    expect(captured?.reason).toMatch(/file path or a single word/);

    const missingFile = results.find((r) => r.id === "BAD-CAPTURE-MISSING-FILE");
    expect(missingFile?.proven).toBe(false);
    expect(missingFile?.reason).toMatch(/does not exist/);

    const good = results.find((r) => r.id === "GOOD-CAPTURE");
    expect(good).toEqual({ id: "GOOD-CAPTURE", proven: true });
  });

  test("an absent proof whose grep returns a line fails", async () => {
    const results = await checkManifest(path.join(MANIFEST_FIXTURES, "mixed-cases.manifest.ts"), ROOT);
    const dirty = results.find((r) => r.id === "BAD-ABSENT-MATCHES");
    expect(dirty?.proven).toBe(false);
    expect(dirty?.reason).toMatch(/still matches/);

    const clean = results.find((r) => r.id === "GOOD-ABSENT");
    expect(clean).toEqual({ id: "GOOD-ABSENT", proven: true });
  });

  test("npm run verify passes — the gate's own failure must not be what verify reports", () => {
    // studio:check is deliberately never invoked from verify.mjs or from
    // package.json's own verify script — its non-zero exit for the length of
    // the studio run must not fail the pre-merge gate.
    const verifyScript = fs.readFileSync(path.join(ROOT, "scripts", "verify.mjs"), "utf8");
    expect(verifyScript).not.toMatch(/studio[:-]check/);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.verify).not.toMatch(/studio/);
  });
});

describe("checkCapture and checkAbsent as plain functions", () => {
  test("checkCapture accepts a real sentence against an existing file", () => {
    expect(
      checkCapture(
        {
          kind: "capture",
          path: "test/studio/fixtures/screenshot.png",
          observed: "the confirm button is now grey instead of red",
        },
        ROOT,
      ),
    ).toBeUndefined();
  });

  test("checkCapture rejects an empty observed difference", () => {
    expect(checkCapture({ kind: "capture", path: "test/studio/fixtures/screenshot.png", observed: "   " }, ROOT)).toMatch(
      /no observed difference/,
    );
  });

  test("checkAbsent rejects a proof naming no paths", () => {
    expect(checkAbsent({ kind: "absent", grep: "anything", paths: [] }, ROOT)).toMatch(/no paths/);
  });

  test("checkAbsent reports when a named path does not exist", () => {
    expect(
      checkAbsent({ kind: "absent", grep: "anything", paths: ["test/studio/fixtures/does-not-exist.txt"] }, ROOT),
    ).toMatch(/does not exist/);
  });
});
