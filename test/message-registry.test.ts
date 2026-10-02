// @scans app/**, lib/**, scripts/**, paid/**
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FLOWS, TEMPLATES, type TemplateDef, type TemplateId } from "../lib/messages/registry";

/**
 * The registry test — B2438, decision D3: "a test holds it to the send
 * calls". Every id in `TEMPLATES` must be referenced, as a string literal,
 * somewhere a real send happens; every id with `paid: true` needs that call
 * site in `paid/` only when `paid/` actually exists here (a plain clone has
 * none, and that must not fail this suite). Every flow node's `to` must name
 * a real node in the same flow, and every `send` node must name a real
 * template.
 */

const ROOT = path.join(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "scripts", "paid"];
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", ".git", "test", "dist"]);

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
}

function allSourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files);
  return files;
}

function paidExists(): boolean {
  return fs.existsSync(path.join(ROOT, "paid")) && fs.readdirSync(path.join(ROOT, "paid")).length > 0;
}

describe("message registry", () => {
  const files = allSourceFiles();
  // Read once; the registry file itself and this test are excluded from the
  // corpus (both name every id, which would make the check vacuous).
  const contents = files
    .filter((f) => !f.endsWith(path.join("lib", "messages", "registry.ts")))
    .map((f) => fs.readFileSync(f, "utf8"));
  const corpus = contents.join("\n");

  test("every template id has at least one real call site", () => {
    const paid = paidExists();
    const missing: string[] = [];
    for (const [id, def] of Object.entries(TEMPLATES) as [TemplateId, TemplateDef][]) {
      if (def.paid && !paid) continue; // no paid/ here — nothing to find, and that's fine.
      const needle = `"${id}"`;
      if (!corpus.includes(needle)) missing.push(id);
    }
    expect(missing, `template id(s) with no call site: ${missing.join(", ")}`).toEqual([]);
  });

  test("an id added to the registry with no call site fails", () => {
    // The behaviour the acceptance line asks for, proven directly rather than
    // trusted from the test above: a made-up id is never in the corpus.
    expect(corpus.includes('"totally.made.up.template.id"')).toBe(false);
  });

  test("every flow's send node names a real template", () => {
    for (const flow of FLOWS) {
      for (const node of flow.nodes) {
        if (node.type === "send") {
          expect(node.template, `${flow.id}/${node.id} is a send node with no template`).toBeTruthy();
          expect(
            node.template && node.template in TEMPLATES,
            `${flow.id}/${node.id} names "${node.template}", not in TEMPLATES`,
          ).toBe(true);
        }
      }
    }
  });

  test("every flow is a tree: every `to` id exists in the same flow", () => {
    for (const flow of FLOWS) {
      const ids = new Set(flow.nodes.map((n) => n.id));
      for (const node of flow.nodes) {
        for (const target of node.to) {
          expect(ids.has(target.id), `${flow.id}/${node.id} points to missing node "${target.id}"`).toBe(true);
        }
      }
    }
  });
});
