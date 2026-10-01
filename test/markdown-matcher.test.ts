import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { MARKDOWN_PAGES } from "@/lib/languagePaths";

/**
 * Every page with a Markdown twin must also be in proxy.ts's matcher, or its
 * `.md` address never reaches the proxy and 404s. /switch.md did exactly that
 * on dev (B2663). Derived from MARKDOWN_PAGES, so a new page cannot be missed.
 */
describe("proxy matcher covers every Markdown page", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
  const line = source.split("\n").find((l) => l.includes("prices|schools") && l.includes(".md"));
  const pattern = new RegExp(`^${JSON.parse(line!.trim().replace(/,$/, ""))}$`);

  test.each(MARKDOWN_PAGES.map((p) => (p === "/" ? "/index" : p)))("%s.md", (page) => {
    expect(pattern.test(`${page}.md`)).toBe(true);
    expect(pattern.test(`/de${page}.md`)).toBe(true);
  });
});
