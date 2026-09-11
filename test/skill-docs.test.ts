import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { agentGuide, instanceDocumentation, userDocumentation } from "@/lib/api/documentation";
import { skillDoc } from "@/lib/api/skillDocs";
import { SKILL_DOC_SLUGS, type SkillDocSlug } from "@/lib/api/skillDocMeta";
import { PERFECT_DAY_EXAMPLE, PERFECT_TRIP_EXAMPLE } from "@/lib/api/agentCopy";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-skilldocs-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "ana"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "ana's journal",
      tagline: "A tagline",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the guide split by task (B311)", () => {
  test("every slug renders, and starts with an H1 and a blockquote", () => {
    for (const slug of SKILL_DOC_SLUGS) {
      const rendered = skillDoc(slug as SkillDocSlug);
      expect(rendered.startsWith("# "), slug).toBe(true);
      expect(rendered.split("\n")[2].startsWith(">"), slug).toBe(true);
    }
  });

  // The acceptance line: an agent that needs to write a day reads one
  // document under 10KB and can do it, without fetching the whole guide.
  test("add-a-day.md is under 10KB", () => {
    const bytes = Buffer.byteLength(skillDoc("add-a-day"), "utf8");
    expect(bytes).toBeLessThan(10 * 1024);
  });

  test("add-a-day.md carries the fields a day needs and the worked example", () => {
    const rendered = skillDoc("add-a-day");
    expect(rendered).toContain("title");
    expect(rendered).toContain("date");
    expect(rendered).toContain("content");
    expect(rendered).toMatch(/\(required\)/);
    for (const line of PERFECT_DAY_EXAMPLE) expect(rendered).toContain(line);
    expect(rendered).toMatch(/PATCH/);
    expect(rendered).toMatch(/\/publish/);
  });

  test("add-a-trip.md carries the worked example from the same constant the guide uses", () => {
    const rendered = skillDoc("add-a-trip");
    for (const line of PERFECT_TRIP_EXAMPLE) expect(rendered).toContain(line);
  });

  // No fact about the API lives in two documents from two sources: every
  // skill document is built mostly from slices of `agentGuide()`'s own
  // rendered text — so a sentence sliced into a skill document appears in
  // the guide byte for byte — plus a handful of hand-written connective
  // sentences that name no fact of their own (they point at `dayFieldNames()`
  // and `/openapi.json`, the same schema the guide's own table reads).
  test("known slices reappear in the guide verbatim", () => {
    const guide = agentGuide();
    const knownSlices: Record<SkillDocSlug, string> = {
      "new-account": "## Starting from nothing",
      "add-journal": "### Deleting a trip, or the whole journal",
      "add-a-trip": PERFECT_TRIP_EXAMPLE[0],
      "add-a-day": "The slug comes from the title",
      "ingest-photos": "### Photographs and video",
      "invite-someone": "## Letting other people in",
      costs: "### The trip's budget",
      "send-postcards": "## Real postcards, in the post",
      "make-a-photobook": "## Printing a photobook",
    };
    for (const slug of SKILL_DOC_SLUGS) {
      const rendered = skillDoc(slug as SkillDocSlug);
      const needle = knownSlices[slug];
      expect(rendered, `${slug} should carry ${needle}`).toContain(needle);
      expect(guide, `${needle} should come from agentGuide()`).toContain(needle);
    }
  });

  test("/documentation.txt no longer points at the retired /agent.md", () => {
    expect(instanceDocumentation()).not.toContain("/agent.md");
    expect(userDocumentation("ana")).not.toContain("/agent.md");
  });

  test("/documentation.txt indexes the nine skill documents", () => {
    const doc = instanceDocumentation();
    for (const slug of SKILL_DOC_SLUGS) {
      expect(doc, slug).toContain(`/skill/${slug}.md`);
    }
  });

  test("/agent.md is retired: a 301 to /documentation.txt, not the guide", async () => {
    const { GET } = await import("@/app/agent.md/route");
    const res = GET();
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://example.test/documentation.txt");
  });

  test("every /skill/<name>.md route answers with its own document", async () => {
    for (const slug of SKILL_DOC_SLUGS) {
      const { GET } = await import(`@/app/skill/${slug}.md/route`);
      const res = GET();
      const body = await res.text();
      expect(body, slug).toBe(skillDoc(slug as SkillDocSlug));
      expect(res.headers.get("content-type")).toContain("text/markdown");
    }
  });
});
