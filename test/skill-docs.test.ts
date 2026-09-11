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
import { openApiDocument } from "@/lib/api/openapi";

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
    // This has failed with under 100 bytes to spare before (B311). If it just
    // failed on you: a day field was added or a sentence grew, and the fix is
    // not to raise the 10KB ceiling (that is the acceptance line itself) —
    // trim a sentence out of `add-a-day`'s slices in `lib/api/skillDocs.ts`,
    // or move the new field's description onto /openapi.json's Draft schema
    // instead of inlining it here (dayFieldNames() already only lists names).
    expect(
      bytes,
      `add-a-day.md is ${bytes} bytes, over the 10KB ceiling. Do not raise the ceiling — ` +
        "trim a sentence out of its slices in lib/api/skillDocs.ts, or describe the new " +
        "field on /openapi.json's Draft schema instead of inlining it here.",
    ).toBeLessThan(10 * 1024);
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

  // B311 follow-up: an API reply's `next` field names the skill document for
  // the step that follows — a response is not a fetched page, so this is
  // reachable even for a caller that refuses a link discovered inside a
  // document (B259). This walks every route source file for the literal
  // pattern that names one, both through the typed helper and as a raw
  // string, so a rename that only fixed the type but not a stray literal —
  // or a slug typed by hand instead of through skillDocPath() — still fails
  // here rather than shipping a next: aimed at a 404.
  test("every /skill/<name>.md named in a route file is a real slug", () => {
    const roots = ["app/api", "lib/api"].map((d) => path.join(process.cwd(), d));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    for (const root of roots) walk(root);

    const found = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/\/skill\/([a-z-]+)\.md/g)) found.add(m[1]);
      for (const m of text.matchAll(/skillDocPath\(\s*["'`]([a-z-]+)["'`]\s*\)/g)) found.add(m[1]);
    }
    expect(found.size).toBeGreaterThan(0);
    for (const slug of found) {
      expect(SKILL_DOC_SLUGS as string[], `${slug} named in route source`).toContain(slug);
    }
  });

  // B1459: a route that sends a `next` pointer at a skill document but never
  // says so in the contract is the exact failure AGENTS.md names — "a field
  // the code accepts and the document does not describe is a field nobody
  // outside will ever use", one hop earlier. This derives each route file's
  // OpenAPI path from its position under app/api (Next.js file routing:
  // app/api/v1/journals/route.ts -> /api/v1/journals, [user] -> {user}) and
  // fails if the operation whose handler calls skillDocPath() has no `201`
  // response description mentioning `next`.
  test("every route that sends a next pointer documents it", () => {
    const apiRoot = path.join(process.cwd(), "app/api");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") files.push(full);
      }
    };
    walk(apiRoot);

    const withNextPointer = files.filter((file) =>
      /skillDocPath\(/.test(fs.readFileSync(file, "utf8")),
    );
    expect(withNextPointer.length).toBeGreaterThan(0);

    const doc = openApiDocument() as unknown as {
      paths: Record<string, Record<string, { responses?: Record<string, { description?: string }> }>>;
    };
    for (const file of withNextPointer) {
      const routePath =
        "/" +
        path
          .relative(process.cwd(), file)
          .replace(/\\/g, "/")
          .replace(/^app\//, "")
          .replace(/\/route\.ts$/, "")
          .replace(/\[([^\]]+)\]/g, "{$1}");
      const methods = doc.paths[routePath];
      expect(methods, `${routePath} (from ${file}) should be a documented path`).toBeTruthy();
      const anyOperationDocumentsNext = Object.values(methods ?? {}).some((op) =>
        Object.values(op.responses ?? {}).some((r) => r.description?.includes("`next`")),
      );
      expect(
        anyOperationDocumentsNext,
        `${routePath} sends a next pointer via skillDocPath() but no response ` +
          "description in lib/api/openapi.ts mentions `next`",
      ).toBe(true);
    }
  });

  test("the reply that creates a journal, a trip, and a day each names the next document", () => {
    const journalsSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/v1/journals/route.ts"),
      "utf8",
    );
    expect(journalsSrc).toContain('skillDocPath("add-a-trip")');

    const tripsSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/v1/[user]/trips/route.ts"),
      "utf8",
    );
    expect(tripsSrc).toContain('skillDocPath("add-a-day")');

    const daysSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/v1/[user]/trips/[trip]/days/route.ts"),
      "utf8",
    );
    expect(daysSrc).toContain('skillDocPath("ingest-photos")');
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
