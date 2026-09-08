import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SHAPES, type Shape } from "@/lib/helper/blocks";
import { TOOLS, runTool, toolList, toolSchemas, writeTool } from "@/lib/helper/tools";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * The tool contract — B898 and B900, checklist A of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * The claim is not that the tools are useful; `test/helper-thread.test.ts`
 * already drives them through a scripted conversation. The claim here is
 * structural, and it is the safety argument: **every tool declares a shape the
 * client can render, no write tool can reach disk, and the only routes a
 * proposal can be pressed into are the helper's own.** All three are
 * properties of the registry rather than of any one row, so all three survive
 * the next dozen rows somebody adds.
 */

const say = (key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${Object.values(vars).join(" ")}` : key;

describe("every tool declares a shape the client can render", () => {
  test("`renders` is one of the seven, on every row", () => {
    for (const tool of TOOLS) {
      expect(SHAPES as readonly Shape[], tool.name).toContain(tool.renders);
    }
  });

  test("a tool that renders anything but prose says how", () => {
    for (const tool of TOOLS) {
      if (tool.kind !== "read") continue;
      // `say` is the exception, and the only one: its content reaches the
      // person as the model's own sentence, so there is nothing extra to draw.
      if (tool.renders === "say") continue;
      expect(tool.block, tool.name).toBeTypeOf("function");
    }
  });

  test("a write renders a proposal shape, a link renders a link", () => {
    for (const tool of TOOLS) {
      if (tool.kind === "write") expect(["form", "confirm"]).toContain(tool.renders);
      if (tool.kind === "link") expect(tool.renders).toBe("link");
    }
  });
});

describe("the model's list is generated from the registry, never typed", () => {
  test("the prose menu names every tool and nothing else", () => {
    const named = toolList()
      .split("\n")
      .map((line) => line.replace(/^- /, "").split(":")[0]);
    expect(named).toEqual(TOOLS.map((tool) => tool.name));
  });

  test("the schemas the SDK is handed are the registry's own", () => {
    const schemas = toolSchemas();
    expect(schemas.map((one) => one.name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const [index, schema] of schemas.entries()) {
      expect(schema.description).toBe(TOOLS[index].describe);
      expect(schema.input_schema.properties).toEqual(TOOLS[index].properties);
    }
  });
});

describe("a write tool never writes", () => {
  /**
   * The structural half, and the one that outlives any particular row: a
   * write tool is a different member of the union and has no `run` on it at
   * all. It is handed the arguments and a translator, and returns a value.
   * A row that wanted to write would have to grow a member the type does not
   * have, which is a change somebody reviews rather than a change that slips.
   */
  test("there is nothing on a write tool to execute", () => {
    const writes = TOOLS.filter((tool) => tool.kind === "write");
    expect(writes.length).toBeGreaterThan(0);
    for (const tool of writes) {
      expect(tool, tool.name).not.toHaveProperty("run");
      expect((tool as { propose: unknown }).propose, tool.name).toBeTypeOf("function");
    }
  });

  test("it returns a proposal, a sentence and the fields, and touches no disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tools-"));
    const before = process.env.CONTENT_DIR;
    process.env.CONTENT_DIR = dir;
    try {
      const ran = await runTool(
        "alex",
        "create_trip",
        { title: "Japan", start: "2026-03-01", end: "2026-03-14" },
        say,
        "2026-09-07",
      );
      expect(ran.ok).toBe(true);
      expect(ran.proposal?.tool).toBe("create_trip");
      expect(ran.proposal?.arguments).toEqual({
        title: "Japan",
        start: "2026-03-01",
        end: "2026-03-14",
      });
      expect(ran.proposal?.sentence).toContain("Japan");
      // Where the press goes, chosen by the registry — the client composes no
      // URL of its own, which is what keeps a new tool from needing one.
      expect(ran.proposal?.endpoint).toBe("/api/helper/alex/trip");
      expect(ran.proposal?.method).toBe("POST");
      expect(ran.blocks).toHaveLength(1);
      expect(ran.blocks[0]).toMatchObject({ shape: "form", text: ran.proposal?.sentence });
      expect((ran.blocks[0] as { fields: unknown[] }).fields.slice(0, 3)).toEqual([
        { name: "title", value: "Japan" },
        { name: "start", value: "2026-03-01", date: true },
        { name: "end", value: "2026-03-14", date: true },
      ]);
      // What goes back to the model says so too, so its own sentence cannot
      // claim the trip exists.
      expect(ran.result).toMatchObject({ proposed: true, wrote: false });
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.CONTENT_DIR;
      else process.env.CONTENT_DIR = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a link tool returns a sentence and a URL and touches nothing", () => {
  test("the day helper is handed over, not imitated", async () => {
    const ran = await runTool("alex", "add_photos", {}, say, "2026-09-07");
    expect(ran.ok).toBe(true);
    expect(ran.blocks[0]).toMatchObject({ shape: "link", href: "/agent/alex" });
    expect(ran.result).toMatchObject({ wrote: false });
    expect(ran.proposal).toBeUndefined();
  });
});

/**
 * The two things that must not become chat actions — and neither is a `link`
 * either. Both are matched by the refusal table in `lib/helper/intents.ts`
 * before the model is called at all (B817), which is stricter than a tool the
 * model could choose: deleting finishes in a mailbox, and a postcard finishes
 * on the owner's own preview page where the addresses are.
 */
describe("what has no tool at all", () => {
  for (const forbidden of ["delete", "erase", "destroy", "postcard", "send", "upload"]) {
    test(`nothing in the registry is called anything like "${forbidden}"`, () => {
      expect(TOOLS.map((tool) => tool.name).filter((name) => name.includes(forbidden))).toEqual([]);
    });
  }

  /**
   * `publish` and `unpublish` **are** here, and the pair is the point: one
   * puts a day on the site after rendering it, the other takes it off and
   * leaves everything on disk. Neither is a delete, and B900 is where the
   * refusal table stopped standing in front of them — see
   * `lib/helper/intents.ts` for the reasoning.
   */
  test("taking a day down exists, and is not a delete", () => {
    const down = TOOLS.find((tool) => tool.name === "unpublish_day");
    expect(down?.kind).toBe("write");
    expect(down && down.kind === "write" && down.endpoint("alex")).toBe(
      "/api/helper/alex/day/unpublish",
    );
    expect(down?.describe).toContain("nothing is deleted");
  });
});

/**
 * Where a press can land — B900.
 *
 * A proposal names the route it posts to, and the client posts there without
 * looking. That is only safe because the set of routes it can name is closed
 * and is checked here: the helper's own family, which is cookie-only, owner-
 * only and validates every field. A tool pointing at `/api/v1` would be
 * putting a write token where a page can reach it; one pointing at a deletion
 * would be an agent satisfying its own confirmation.
 */
describe("a proposal can only be pressed into the helper's own routes", () => {
  const ALLOWED = [
    "/api/helper/alex/trip",
    "/api/helper/alex/day",
    "/api/helper/alex/day/write-day",
    "/api/helper/alex/day/costs",
    "/api/helper/alex/day/publish",
    "/api/helper/alex/day/unpublish",
  ];

  test("every write tool names one of them, and nothing else", () => {
    for (const tool of TOOLS) {
      if (tool.kind !== "write") continue;
      expect(ALLOWED, tool.name).toContain(tool.endpoint("alex"));
      expect(tool.method ?? "POST", tool.name).toMatch(/^(POST|PATCH)$/);
    }
  });

  test("a chained proposal names a write tool that exists", () => {
    for (const tool of TOOLS) {
      if (tool.kind !== "write" || !tool.next) continue;
      expect(writeTool(tool.next.tool), tool.name).not.toBeNull();
    }
  });

  test("publishing renders the day first, and then the press", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-"));
    const before = process.env.CONTENT_DIR;
    process.env.CONTENT_DIR = dir;
    try {
      fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "alex", "config.json"),
        JSON.stringify({
          title: "Alex",
          tagline: "t",
          owner: { name: "A B", nickname: "A", email: "a@example.test" },
          defaultLocale: "en",
          locales: ["en"],
          baseCurrency: "CHF",
        }),
      );
      fs.writeFileSync(
        path.join(dir, "alex", "trips", "reise", "trip.md"),
        ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro."].join("\n"),
      );
      fs.writeFileSync(
        path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-one.md"),
        ["---", "title: Der erste Tag", 'date: "2026-05-01"', "status: draft", "---", "", "Worte."].join("\n"),
      );
      const ran = await runTool("alex", "publish_day", { trip: "reise" }, say, "2026-09-07");
      expect(ran.blocks.map((block) => block.shape)).toEqual(["preview", "confirm"]);
      expect((ran.blocks[0] as { lines: string[] }).lines).toContain("Der erste Tag");
      // And it is still a draft: proposing is not publishing.
      expect(
        fs.readFileSync(
          path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-one.md"),
          "utf8",
        ),
      ).toContain("status: draft");
    } finally {
      if (before === undefined) delete process.env.CONTENT_DIR;
      else process.env.CONTENT_DIR = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("every string a tool says exists in every maintained locale", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib", "helper", "tools.ts"), "utf8");
  const keys = [...new Set([...source.matchAll(/say\("([^"]+)"/g)].map((match) => match[1]))];

  test("there are some to check", () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  for (const locale of MAINTAINED_LOCALES) {
    const dictionary = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "site", "locales", `${locale}.json`), "utf8"),
    ) as Record<string, string>;
    for (const key of keys) {
      test(`${locale}: ${key}`, () => {
        expect(dictionary[key]).toBeTypeOf("string");
        expect(dictionary[key]?.length).toBeGreaterThan(0);
      });
    }
  }
});
