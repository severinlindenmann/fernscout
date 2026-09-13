import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { instanceDocumentation, userDocumentation } from "@/lib/api/documentation";
import { skillDoc } from "@/lib/api/skillDocs";
import { SKILL_DOC_SLUGS, type SkillDocSlug } from "@/lib/api/skillDocMeta";
import { openApiDocument } from "@/lib/api/openapi";
import { openApiDocumentV2 } from "@/lib/api/v2/openapi";

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

describe("the nine v2 task guides (B311, step 6 of the v2 migration)", () => {
  test("every slug renders, and starts with an H1 and a blockquote", () => {
    for (const slug of SKILL_DOC_SLUGS) {
      const rendered = skillDoc(slug as SkillDocSlug);
      expect(rendered.startsWith("# "), slug).toBe(true);
      expect(rendered.split("\n")[2].startsWith(">"), slug).toBe(true);
    }
  });

  // The acceptance line: an agent that needs to write a day reads one
  // document under 10KB and can do it, without fetching the whole contract.
  test("add-a-day.md is under 10KB", () => {
    const bytes = Buffer.byteLength(skillDoc("add-a-day"), "utf8");
    expect(
      bytes,
      `add-a-day.md is ${bytes} bytes, over the 10KB ceiling. Trim a sentence rather than ` +
        "raising the ceiling, or move detail onto /api/v2/openapi.json's own request schema.",
    ).toBeLessThan(10 * 1024);
  });

  test("add-a-day.md names the required fields and the write/correct/publish calls", () => {
    const rendered = skillDoc("add-a-day");
    expect(rendered).toContain("title");
    expect(rendered).toContain("date");
    expect(rendered).toContain("content");
    expect(rendered).toMatch(/\(required\)/);
    expect(rendered).toContain("PUT");
    expect(rendered).toContain("PATCH");
    expect(rendered).toMatch(/\/publish/);
    // The v2 shape, not v1's: asked-or-declined, not `false`/`"unknown"`.
    expect(rendered).toMatch(/declined/);
  });

  test("every field name in add-a-day.md's table is generated from the real v2 request schema", () => {
    // Not a hand-typed copy: read the same JSON Schema the served
    // /api/v2/openapi.json carries, and check the guide names every key of
    // it. A field renamed in lib/api/v2/schemas/day.ts without this test
    // failing would mean the generator itself is broken, not this guide.
    const openapi = openApiDocumentV2() as unknown as {
      paths: Record<string, Record<string, { request?: { content?: { "application/json"?: { schema?: { properties?: Record<string, unknown> } } } } }>>;
    };
    const schema =
      openapi.paths["/api/v2/{user}/trips/{trip}/days/{slug}"].put.request!.content!["application/json"]!.schema!;
    const rendered = skillDoc("add-a-day");
    for (const field of Object.keys(schema.properties ?? {})) {
      expect(rendered, `add-a-day.md should name the field \`${field}\``).toContain(`\`${field}\``);
    }
  });

  test("add-a-trip.md carries every field name of the v2 trip PUT, generated from the schema", () => {
    const openapi = openApiDocumentV2() as unknown as {
      paths: Record<string, Record<string, { request?: { content?: { "application/json"?: { schema?: { properties?: Record<string, unknown> } } } } }>>;
    };
    const schema = openapi.paths["/api/v2/{user}/trips/{trip}"].put.request!.content!["application/json"]!.schema!;
    const rendered = skillDoc("add-a-trip");
    for (const field of Object.keys(schema.properties ?? {})) {
      expect(rendered, `add-a-trip.md should name the field \`${field}\``).toContain(`\`${field}\``);
    }
  });

  test("every v2 route document uses /api/v2, never /api/v1", () => {
    for (const slug of SKILL_DOC_SLUGS) {
      const rendered = skillDoc(slug as SkillDocSlug);
      expect(rendered, `${slug} should not mention /api/v1`).not.toMatch(/\/api\/v1\//);
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

  test("/documentation.txt points at the generated v2 machine contract, not a hand-written one", () => {
    const doc = instanceDocumentation();
    expect(doc).toContain("/api/v2/openapi.json");
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

  // B1459/B1621: a route that sends a `next` pointer at a skill document but
  // never says so in the contract is the exact failure AGENTS.md names — "a
  // field the code accepts and the document does not describe is a field
  // nobody outside will ever use", one hop earlier. Every route that sends a
  // `next` pointer is a v2 route now (B1624 moved the last of them), so this
  // checks the GENERATED v2 document rather than v1's hand-written one.
  test("every route that sends a next pointer documents it in the generated v2 contract", () => {
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

    // v1 no longer sends a `next` pointer at all — see 06-contract-deltas.md.
    // A v1 route growing one again is worth catching here rather than
    // silently documenting nothing.
    const v1WithNextPointer = withNextPointer.filter(
      (file) => !path.relative(process.cwd(), file).startsWith(path.join("app", "api", "v2")),
    );
    expect(v1WithNextPointer).toEqual([]);

    type Schema = { properties?: Record<string, unknown> };
    const doc = openApiDocumentV2() as unknown as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, { content?: { "application/json"?: { schema?: Schema } } }> }>
      >;
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
      // Grounded in the generated schema itself, not a prose description: the
      // response body schema (produced from the frozen Zod document) has to
      // list `next` as a property, or the field the route sends is one the
      // generated contract says nothing about.
      const anyOperationDocumentsNext = Object.values(methods ?? {}).some((op) =>
        Object.values(op.responses ?? {}).some((r) =>
          Object.prototype.hasOwnProperty.call(
            r.content?.["application/json"]?.schema?.properties ?? {},
            "next",
          ),
        ),
      );
      expect(
        anyOperationDocumentsNext,
        `${routePath} sends a next pointer via skillDocPath() but no response schema in ` +
          "lib/api/v2/openapi.ts lists a `next` field",
      ).toBe(true);
    }
  });

  test("the reply that creates a journal, a trip, and a day each names the next document", () => {
    const journalsSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/v2/journals/route.ts"),
      "utf8",
    );
    expect(journalsSrc).toContain('skillDocPath("add-a-trip")');

    const tripsSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/v2/[user]/trips/[trip]/route.ts"),
      "utf8",
    );
    expect(tripsSrc).toContain('skillDocPath("add-a-day")');

    const daysSrc = fs.readFileSync(
      path.join(process.cwd(), "app/api/v2/[user]/trips/[trip]/days/[slug]/route.ts"),
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

  // v1's own document is untouched by this ticket (rule 5) — a smoke check
  // that it still parses, so a change here cannot silently have reached it.
  // `/api/v1/{user}/invites` was the canary until B1632 retired that route
  // (and the v1 door it documented) along with several siblings; `import`
  // was the canary after that until its own v2 door arrived and it was
  // retired in turn; `trips/{trip}/track` has no v2 equivalent yet, so it is
  // the canary now.
  test("v1's own hand-written openapi document is unaffected", () => {
    const doc = openApiDocument() as unknown as { paths: Record<string, unknown> };
    expect(doc.paths["/api/v1/{user}/trips/{trip}/track"]).toBeTruthy();
  });
});
