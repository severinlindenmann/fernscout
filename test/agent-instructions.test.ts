import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const instructionsFile = path.join(root, "AGENTS.md");
const source = fs.readFileSync(instructionsFile, "utf8");

describe("agent instruction routing", () => {
  test("the universal instructions fit below the supported 32 KiB limit with headroom", () => {
    expect(Buffer.byteLength(source), "AGENTS.md must stay at or below 28 KiB").toBeLessThanOrEqual(
      28 * 1024,
    );
  });

  test("every local Markdown link resolves", () => {
    const localLinks = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map((match) => match[1].split("#")[0])
      .filter((target) => target && !/^[a-z]+:/i.test(target));

    const missing = localLinks.filter(
      (target) => !fs.existsSync(path.resolve(path.dirname(instructionsFile), target)),
    );
    expect(missing).toEqual([]);
  });

  test("every scoped agent reference is discoverable from the root", () => {
    const references = fs
      .readdirSync(path.join(root, "docs", "agents"))
      .filter((file) => file.endsWith(".md"));

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(source, `${reference} is not linked from AGENTS.md`).toContain(`docs/agents/${reference}`);
    }
  });
});
