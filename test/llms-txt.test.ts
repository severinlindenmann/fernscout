import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { llmsTxt } from "@/lib/llmsTxt";
import { SKILL_DOC_SLUGS } from "@/lib/api/skillDocMeta";
import { isGuide } from "@/lib/docs";
import { getUser } from "@/lib/users";
import { serverSite } from "@/lib/site";
import { GET } from "@/app/llms.txt/route";

/**
 * B2487 — /llms.txt is generated from the lists the site already renders
 * from, and every link in it has to resolve. A guide renamed or retired
 * fails here rather than as a dead link an agent follows.
 */
const base = serverSite().url;
const exists = (file: string) => fs.existsSync(path.join(process.cwd(), file));

/** Whether a path this document links has something behind it. */
function resolves(route: string): boolean {
  if (exists(`app${route}/route.ts`) || exists(`app${route}/page.tsx`)) return true;
  const guide = route.match(/^\/docs\/guide\/([^/]+)$/);
  if (guide) return isGuide(guide[1]);
  const journal = route.match(/^\/([^/]+)$/);
  return journal ? getUser(journal[1]) !== null : false;
}

describe("/llms.txt", () => {
  const text = llmsTxt();
  const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);

  test("is in the llmstxt.org shape: an H1, a summary, then sections", () => {
    expect(text).toMatch(/^# .+\n\n> .+/);
    expect(text).toContain("\n## Docs\n");
  });

  test("every link is on this instance and resolves", () => {
    expect(links.length).toBeGreaterThan(5);
    for (const href of links) {
      expect(href.startsWith(base), href).toBe(true);
      expect(resolves(href.slice(base.length)), href).toBe(true);
    }
  });

  test("names every task guide this build serves, and the API spec", () => {
    for (const slug of SKILL_DOC_SLUGS) expect(links).toContain(`${base}/skill/${slug}.md`);
    expect(links).toContain(`${base}/api/v2/openapi.json`);
    expect(links).toContain(`${base}/documentation.txt`);
  });

  test("is served as markdown", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe(text);
  });
});
