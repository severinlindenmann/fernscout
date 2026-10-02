import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "check-changed.mjs");

function plan(...files: string[]) {
  return run(process.execPath, [script, "--plan", ...files], { cwd: process.cwd() });
}

describe("changed-path check planning", () => {
  // B2711 — keepers are derived from each test's own `// @scans` header
  // (scripts/check-changed.mjs), not a hand-kept KEEPERS array, so this no
  // longer asserts a hand-picked label: it asserts the actual test files a
  // real change pulls in, and why (lib/brand.ts reads app/globals.css at
  // runtime — an EXTRA_KEEPERS entry, the one coupling a test cannot declare
  // itself — while depersonalised.test.ts gets there through its own header).
  test("adds source-scanning keepers that Vitest's import graph cannot find", async () => {
    const { stdout } = await plan("app/globals.css");

    expect(stdout).toContain("Vitest related tests");
    expect(stdout).toContain("brand and colour tokens");
    expect(stdout).toContain("test/brand.test.ts");
    expect(stdout).toContain("test/undefined-color-tokens.test.ts");
    expect(stdout).toContain("test/depersonalised.test.ts");
  });

  // test/api-route-schemas.test.ts and test/openapi-contract.test.ts (v1)
  // are gone from the repository entirely — the old KEEPERS array still
  // named them, a stale entry this derivation cannot reproduce on purpose.
  test("adds schema and public-contract keepers for an API route", async () => {
    const { stdout } = await plan("app/api/v2/example/route.ts");

    expect(stdout).toContain("@scans header: test/openapi-v2-contract.test.ts");
    expect(stdout).toContain("@scans header: test/no-browser-dialogs.test.ts");
  });

  // knip.jsonc, not README.md: a header on test/docs-links.test.ts now
  // correctly covers README.md (it scans exactly that file for dead links),
  // which is new, true coverage the old hand list never had — not a path
  // this fallback case can still use.
  test("names the full-suite fallback when neither source has evidence", async () => {
    const { stdout } = await plan("knip.jsonc");

    expect(stdout).toContain("none mapped");
    expect(stdout).toContain("run the full Vitest suite if the dependency graph also finds nothing");
  });

  test("refuses a path outside the repository", async () => {
    await expect(plan("../somewhere-else.ts")).rejects.toThrow(/Path is outside the repository/);
  });
});
