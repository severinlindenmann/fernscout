import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { AREAS, TOOLS, WHATSAPP_AREAS, WHATSAPP_TOOLS, runTool } from "@/lib/helper/tools";
import { writeTripFixture } from "./fixtures/content";
import { WEB_CALLER, WHATSAPP_CALLER } from "./support/callers";

/** Every request `answerInThread` made, and the scripted answers it got
 *  back — the same harness `test/helper-thread.test.ts` uses. */
const { create, sent } = vi.hoisted(() => ({
  create: vi.fn(),
  sent: [] as Record<string, unknown>[],
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => {
        // The area-pick round, answered structurally so it never lands in
        // `sent` (which this describe block reads as "the turn's own
        // request") or consumes a scripted `create` reply — same discipline
        // as `test/helper-thread.test.ts`.
        const format = (params.output_config as { format?: { schema?: { properties?: Record<string, unknown> } } })
          ?.format;
        if (format?.schema?.properties?.area) {
          return { content: [{ type: "text", text: '{"area":"days"}' }], usage: { input_tokens: 40, output_tokens: 5 } };
        }
        sent.push(params);
        return create(params);
      },
    };
  },
}));

/**
 * B1891 — nothing refused a tool call on the caller's kind, so a WhatsApp
 * turn could reach every area. Three things are asserted here, in the order
 * the ticket puts them:
 *
 * 1. `runTool` itself refuses a tool outside the WhatsApp allowance, on the
 *    caller it is given — proven with the tool name passed directly, no
 *    model in the loop at all.
 * 2. An absent, unknown or malformed caller kind gets the narrow allowance,
 *    never the wide one — fail closed.
 * 3. A WhatsApp-channel turn's actual request to the model never carries
 *    `printed`, `journal`, `readers` or `money` schemas, and `switch_area`'s
 *    own enum lists only what this channel can reach.
 */

const say = (key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

describe("runTool refuses on the caller's kind — the boundary itself", () => {
  let dir: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tool-refusal-"));
    process.env.CONTENT_DIR = dir;
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
    process.env.SESSION_SECRET = "0".repeat(64);
    fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "config.json"),
      JSON.stringify({
        title: "Alex",
        owner: { name: "A B", nickname: "A", email: "alex@example.test" },
        defaultLocale: "en",
        locales: ["en"],
      }),
    );
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { helper: { enabled: true } } }),
    );
    clearConfigCache();
    clearUserCache();
    await migrateToLatest(await getDatabase());
    await grant("alex", 1);
  });

  afterEach(async () => {
    await closeDatabase();
    delete process.env.CONTENT_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a WhatsApp caller cannot run a tool outside its allowance — no model, the tool name passed directly", async () => {
    // journal_settings is a "read" tool (kind: "read"), so a successful
    // call would run immediately and return a value — there is no press to
    // separately gate. It is nowhere in WHATSAPP_TOOLS.
    const ran = await runTool("alex", "journal_settings", {}, say, "2026-09-20", [], "", WHATSAPP_CALLER);
    expect(ran.ok).toBe(false);
    expect(JSON.stringify(ran.result)).toContain("no tool called journal_settings");
  });

  test("a WhatsApp caller cannot even get a proposal for a write tool outside its allowance", async () => {
    const ran = await runTool("alex", "buy_room", {}, say, "2026-09-20", [], "", WHATSAPP_CALLER);
    expect(ran.ok).toBe(false);
    expect(ran.proposal).toBeUndefined();
  });

  test("a web (cookie) caller still reaches the whole registry — unchanged", async () => {
    const ran = await runTool("alex", "journal_settings", {}, say, "2026-09-20", [], "", WEB_CALLER);
    expect(ran.ok).toBe(true);
  });

  test("every WHATSAPP_TOOLS entry actually runs for a WhatsApp caller", async () => {
    writeTripFixture("alex", { id: "reise", title: "Die Reise", start: "2026-05-01", end: "2026-05-10" });
    for (const name of WHATSAPP_TOOLS) {
      const ran = await runTool("alex", name, { trip: "reise" }, say, "2026-09-20", [], "", WHATSAPP_CALLER);
      expect(ran.ok, name).toBe(true);
    }
  });

  test("every tool outside WHATSAPP_TOOLS is refused for a WhatsApp caller", async () => {
    const outside = TOOLS.filter((tool) => !WHATSAPP_TOOLS.has(tool.name));
    expect(outside.length).toBeGreaterThan(0);
    for (const tool of outside) {
      const ran = await runTool("alex", tool.name, {}, say, "2026-09-20", [], "", WHATSAPP_CALLER);
      expect(ran.ok, tool.name).toBe(false);
      expect(JSON.stringify(ran.result), tool.name).toContain(`no tool called ${tool.name}`);
    }
  });

  test("fails closed: no caller argument at all gets the narrow allowance", async () => {
    const ran = await runTool("alex", "journal_settings", {}, say, "2026-09-20");
    expect(ran.ok).toBe(false);
  });

  test("fails closed: null gets the narrow allowance", async () => {
    const ran = await runTool("alex", "journal_settings", {}, say, "2026-09-20", [], "", null);
    expect(ran.ok).toBe(false);
  });

  test("fails closed: an unrecognised caller kind gets the narrow allowance, not the wide one", async () => {
    // A malformed/forged caller — anything that is not exactly
    // `{ how: "cookie" }` — must not be read as permission.
    const forged = { username: "alex", how: "owner" } as unknown as Parameters<typeof runTool>[7];
    const ran = await runTool("alex", "journal_settings", {}, say, "2026-09-20", [], "", forged);
    expect(ran.ok).toBe(false);
  });

  test("fails closed: a caller object with no `how` at all gets the narrow allowance", async () => {
    const malformed = { username: "alex" } as unknown as Parameters<typeof runTool>[7];
    const ran = await runTool("alex", "journal_settings", {}, say, "2026-09-20", [], "", malformed);
    expect(ran.ok).toBe(false);
  });

  test("the refusal is legible: the log names the tool and the caller kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runTool("alex", "journal_settings", {}, say, "2026-09-20", [], "", WHATSAPP_CALLER);
    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0] as [string];
    expect(line).toContain("journal_settings");
    expect(line).toContain("whatsapp");
    warn.mockRestore();
  });

  test("the refusal log names an unknown caller kind as such, not as a channel it never claimed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runTool("alex", "journal_settings", {}, say, "2026-09-20");
    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0] as [string];
    expect(line).toContain("journal_settings");
    expect(line).toContain("unknown");
    warn.mockRestore();
  });

  test("a genuinely unknown tool name still answers as an unknown tool, not a refusal — no log line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ran = await runTool("alex", "delete_everything", {}, say, "2026-09-20", [], "", WHATSAPP_CALLER);
    expect(ran.ok).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the areas a channel is offered — B1891's prompt-size half", () => {
  test("WHATSAPP_AREAS excludes printed, journal, readers and money", () => {
    const excluded = ["printed", "journal", "readers", "money"];
    for (const key of excluded) {
      expect(WHATSAPP_AREAS).not.toContain(key);
    }
    expect(WHATSAPP_AREAS).toEqual(["trips", "days", "files"]);
  });

  test("every WHATSAPP_TOOLS entry lives inside a WHATSAPP_AREAS area", () => {
    const areasByTool = new Map(AREAS.flatMap((area) => area.tools.map((tool) => [tool.name, area.key])));
    for (const name of WHATSAPP_TOOLS) {
      expect(WHATSAPP_AREAS, name).toContain(areasByTool.get(name));
    }
  });
});

/**
 * The actual request built for the model — not a helper's return value, per
 * the ticket's own acceptance line. `answerInThread` is exercised for real
 * (only the Anthropic SDK is scripted), and `sent[0].tools` is read exactly
 * as the model would have received it.
 */
describe("a WhatsApp turn's own request to the model — B1891", () => {
  let dir: string;

  function says(text: string) {
    return { content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 20 } };
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-tool-refusal-request-"));
    process.env.CONTENT_DIR = dir;
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
    process.env.SESSION_SECRET = "1".repeat(64);
    process.env.ANTHROPIC_API_KEY = "not-a-real-key";
    fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "config.json"),
      JSON.stringify({
        title: "Alex",
        owner: { name: "A B", nickname: "A", email: "alex@example.test" },
        defaultLocale: "en",
        locales: ["en"],
      }),
    );
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { helper: { enabled: true } } }),
    );
    clearConfigCache();
    clearUserCache();
    await migrateToLatest(await getDatabase());
    create.mockReset();
    sent.length = 0;
  });

  afterEach(async () => {
    await closeDatabase();
    delete process.env.CONTENT_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("never carries printed, journal, readers or money schemas — asserted on the request itself", async () => {
    const { answerInThread } = await import("@/lib/helper/model");
    create.mockResolvedValueOnce(says("Sure."));
    await answerInThread("alex", "hi", [], "2026-09-20", say, [], undefined, "whatsapp");

    expect(sent).toHaveLength(1);
    const tools = sent[0].tools as { name: string }[];
    const names = new Set(tools.map((tool) => tool.name));
    const excludedAreaTools = AREAS.filter((area) => !WHATSAPP_AREAS.includes(area.key)).flatMap(
      (area) => area.tools,
    );
    expect(excludedAreaTools.length).toBeGreaterThan(0);
    for (const tool of excludedAreaTools) {
      expect(names.has(tool.name), tool.name).toBe(false);
    }
  });

  test("switch_area's own enum lists only trips, days and files", async () => {
    const { answerInThread } = await import("@/lib/helper/model");
    create.mockResolvedValueOnce(says("Sure."));
    await answerInThread("alex", "hi", [], "2026-09-20", say, [], undefined, "whatsapp");

    const tools = sent[0].tools as { name: string; input_schema: { properties: { area: { enum: string[] } } } }[];
    const switchArea = tools.find((tool) => tool.name === "switch_area");
    expect(switchArea).toBeDefined();
    expect(switchArea?.input_schema.properties.area.enum.sort()).toEqual(["days", "files", "trips"]);
  });

  test("the web door is unchanged: switch_area's enum still lists every area", async () => {
    const { answerInThread } = await import("@/lib/helper/model");
    create.mockResolvedValueOnce(says("Sure."));
    await answerInThread("alex", "hi", [], "2026-09-20", say, [], undefined, "web");

    const tools = sent[0].tools as { name: string; input_schema: { properties: { area: { enum: string[] } } } }[];
    const switchArea = tools.find((tool) => tool.name === "switch_area");
    expect(switchArea?.input_schema.properties.area.enum.sort()).toEqual(
      [...AREAS.map((area) => area.key)].sort(),
    );
  });

  test("a switch_area call naming an area outside this channel's own list is refused, not honoured", async () => {
    const { answerInThread } = await import("@/lib/helper/model");
    create
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t-1", name: "switch_area", input: { area: "printed" } }],
        usage: { input_tokens: 100, output_tokens: 10 },
      })
      .mockResolvedValueOnce(says("Right, here's what the web can do."));
    await answerInThread("alex", "order a postcard", [], "2026-09-20", say, [], undefined, "whatsapp");

    // Round two's own request still excludes `printed` — the widening never
    // took, even though the model asked for it by a real area name.
    expect(sent).toHaveLength(2);
    const secondRoundTools = sent[1].tools as { name: string }[];
    const printedTools = AREAS.find((area) => area.key === "printed")!.tools;
    for (const tool of printedTools) {
      expect(secondRoundTools.some((t) => t.name === tool.name), tool.name).toBe(false);
    }
  });
});
