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
  test("adds source-scanning keepers that Vitest's import graph cannot find", async () => {
    const { stdout } = await plan("lib/theme.ts");

    expect(stdout).toContain("Vitest related tests");
    expect(stdout).toContain("brand and colour source scans");
    expect(stdout).toContain("test/brand.test.ts");
    expect(stdout).toContain("test/undefined-color-tokens.test.ts");
    expect(stdout).toContain("test/depersonalised.test.ts");
  });

  test("adds schema and public-contract keepers for an API route", async () => {
    const { stdout } = await plan("app/api/v2/example/route.ts");

    expect(stdout).toContain("API route and OpenAPI contracts");
    expect(stdout).toContain("test/api-route-schemas.test.ts");
    expect(stdout).toContain("test/openapi-v2-contract.test.ts");
    expect(stdout).toContain("browser-dialog source scan");
  });

  test("names the full-suite fallback when neither source has evidence", async () => {
    const { stdout } = await plan("README.md");

    expect(stdout).toContain("none mapped");
    expect(stdout).toContain("run the full Vitest suite if the dependency graph also finds nothing");
  });

  test("maps agent references back to their link and size keeper", async () => {
    const { stdout } = await plan("docs/agents/content-model.md");

    expect(stdout).toContain("agent instruction routing");
    expect(stdout).toContain("test/agent-instructions.test.ts");
  });

  test("refuses a path outside the repository", async () => {
    await expect(plan("../somewhere-else.ts")).rejects.toThrow(/Path is outside the repository/);
  });
});
