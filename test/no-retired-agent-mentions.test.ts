import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B2172 — the browser room at `/agent` is retired; the studio is where an
 * owner edits, and this instance's own helper, where it offers one, is
 * reached over WhatsApp. Prose that still sends a reader to `/agent` sends
 * them to a door this software no longer opens.
 *
 * A source scan rather than one test per string, for the reason
 * `docs/agents/repository-verification.md`'s neighbours already give: a
 * hand-maintained list of "every place `/agent` is mentioned" goes stale the
 * next time somebody adds a sentence, and the next drift is exactly this
 * ticket's bug — the room was retired once already and prose kept naming it.
 *
 * Two named exceptions: `/agent.md` is the retired document's own 301 target
 * name (`app/agent.md/route.ts`), not a page; `/studio/agent` is the studio's
 * permissions-and-keys page, which legitimately has "agent" as its last path
 * segment. Everything else naming `/agent` in served prose is a dead link.
 */

const FILES = [
  "lib/api/documentation.ts",
  "site/legal/en.md",
  "site/legal/de.md",
  "README.md",
  "docs/helper.md",
  "site/locales/en.json",
  "site/locales/de.json",
  "site/locales/hu.json",
];

function guideFiles(): string[] {
  const root = path.join(process.cwd(), "docs", "guides");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md")) out.push(path.relative(process.cwd(), full));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** `/agent`, at a word boundary — `/agentCopy` (an import in
 * `lib/api/documentation.ts`) never matches, because `t` and `C` share no
 * boundary; `/agent.md`, `/agent/`, `/agent"`, `/agent` followed by a space
 * or punctuation all do. */
const AGENT_PATH = /\/agent\b/g;

describe("no served prose still points at the retired /agent room", () => {
  const files = [...FILES, ...guideFiles()].filter((f) => fs.existsSync(path.join(process.cwd(), f)));

  test("there is something to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  test.each(files)("%s", (file) => {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const bad: string[] = [];
    for (const match of text.matchAll(AGENT_PATH)) {
      const idx = match.index ?? 0;
      if (text.startsWith("/agent.md", idx)) continue;
      if (text.slice(Math.max(0, idx - 7), idx) === "/studio") continue;
      const line = text.slice(0, idx).split("\n").length;
      bad.push(`line ${line}: …${text.slice(Math.max(0, idx - 30), idx + 20).replace(/\n/g, " ")}…`);
    }
    expect(bad, `${file} still names /agent — say the studio and, where the ` +
      "helper is on, WhatsApp instead").toEqual([]);
  });
});
