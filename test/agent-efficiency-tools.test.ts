import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = process.cwd();

describe("agent context lookup", () => {
  it("maps a task id to concise code, tests, docs, skills and visible checks", async () => {
    const { stdout } = await run(process.execPath, [path.join(root, "scripts/agent-context.mjs"), "B1665"], { cwd: root });
    expect(Buffer.byteLength(stdout)).toBeLessThan(10 * 1024);
    expect(stdout).toContain("Relevant paths");
    expect(stdout).toContain("Tests:");
    expect(stdout).toContain("Docs:");
    expect(stdout).toContain("Skills:");
    expect(stdout).toContain("Visible checks:");
    expect(stdout).toContain("work-on-a-task");
  });

  it("routes helper work to persona and browser verification", async () => {
    const { stdout } = await run(process.execPath, [path.join(root, "scripts/agent-context.mjs"), "B900", "--json"], { cwd: root });
    const result = JSON.parse(stdout);
    expect(result.skills).toContain("test-with-personas");
    expect(result.skills).toContain("test-in-a-browser");
    expect(result.tests).toContain("test/helper-honesty.test.ts");
  });
});

describe("agent benchmark metrics", () => {
  const completeRun = {
    caseId: "B1578",
    variant: "candidate",
    instructionBytes: 12086,
    toolCalls: 4,
    toolOutputBytes: 2000,
    timeToFirstEditMs: 1000,
    focusedTestMs: 5000,
    fullGateMs: 90000,
    retries: 0,
    finalFailures: 0,
    selectedChecks: ["test/openapi-contract.test.ts", "test/depersonalised.test.ts"],
    acceptanceMet: true,
    unrelatedDiff: false,
    weakenedAssertion: false,
    forbiddenActions: 0,
  };

  it("scores correctness only when required checks were selected", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-agent-score-"));
    const file = path.join(directory, "runs.json");
    fs.writeFileSync(file, JSON.stringify({ runs: [completeRun] }));
    try {
      const { stdout } = await run(process.execPath, [path.join(root, "scripts/agent-benchmark.mjs"), "--score", file], { cwd: root });
      const result = JSON.parse(stdout);
      expect(result.variants.candidate.correctnessPasses).toBe(1);
      expect(result.variants.candidate.selectionPasses).toBe(1);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses unknown fields so raw conversation data cannot be stored", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-agent-score-"));
    const file = path.join(directory, "runs.json");
    fs.writeFileSync(file, JSON.stringify({ runs: [{ ...completeRun, conversation: "raw text" }] }));
    try {
      await expect(run(process.execPath, [path.join(root, "scripts/agent-benchmark.mjs"), "--score", file], { cwd: root })).rejects.toThrow(/forbidden\/raw fields: conversation/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
