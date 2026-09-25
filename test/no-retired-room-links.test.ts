import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B2171 — the chat room at `/agent` is retired (B2173), so nothing WhatsApp
 * sends, no mail the digest builds, no helper tool's block and no locale
 * string may build or contain a link into it. Derived from the directories,
 * not a list of files: a new file lands under the rule the day it is added.
 *
 * Comments are stripped first — they may still name the room historically.
 * `/agent.md` (the outside-agent guide) and `/agents` are other addresses.
 */

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = [
  ...(fs.existsSync(path.join(ROOT, "paid")) ? ["paid/whatsapp/lib/whatsapp", "paid/printOrder/lib/helper/tools"] : []),
  "lib/digest",
  "lib/helper/tools",
];
const ROOM = /\/agent(?![\w.-])/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx|mts)$/.test(entry.name) ? [full] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

describe("no link into the retired chat room — B2171", () => {
  const files = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));

  test("the scan finds the files it is about", () => {
    if (fs.existsSync(path.join(ROOT, "paid"))) expect(files.some((file) => file.endsWith(path.join("lib", "whatsapp", "dispatch.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(path.join("lib", "digest", "reminder.ts")))).toBe(true);
    expect(files.some((file) => file.endsWith(path.join("tools", "areas", "journal.ts")))).toBe(true);
  });

  test.each(SOURCE_DIRS)("no code under %s builds an /agent link", (dir) => {
    const offenders = walk(path.join(ROOT, dir)).filter((file) => ROOM.test(withoutComments(fs.readFileSync(file, "utf8"))));
    expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
  });

  test("no locale string contains an /agent link", () => {
    const localeDir = path.join(ROOT, "site", "locales");
    const offenders = fs
      .readdirSync(localeDir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) =>
        Object.entries(JSON.parse(fs.readFileSync(path.join(localeDir, name), "utf8")) as Record<string, string>)
          .filter(([, value]) => typeof value === "string" && ROOM.test(value))
          .map(([key]) => `${name}:${key}`),
      );
    expect(offenders).toEqual([]);
  });
});
