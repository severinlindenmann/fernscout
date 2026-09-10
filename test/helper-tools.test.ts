import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SHAPES, type Shape } from "@/lib/helper/blocks";
import { TOOLS, runTool, toolList, toolSchemas, writeTool } from "@/lib/helper/tools";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B906 — the catalogue and the model behind `find_day` are mocked the same
 * way `test/helper-search.test.ts` mocks them for the search box's own
 * fallback: what is under test is not whether a model matches a sentence
 * well, but what the tool does with its answer, including a bad one.
 */
const catalogue = vi.hoisted(() => ({
  rows: [] as { id: string; kind: "day" | "trip" | "page" | "doc"; title: string; where: string; url: string }[],
}));
vi.mock("@/lib/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/search")>();
  return { ...actual, searchCatalogueFor: async () => catalogue.rows };
});

const said = vi.hoisted(() => ({
  hits: [] as { id: string; why: string }[],
  suggestion: "",
}));
vi.mock("@/lib/helper/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/model")>();
  return {
    ...actual,
    findInJournal: async () => ({ hits: said.hits, suggestion: said.suggestion }),
  };
});

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
      // The whole call, resolved — B935: what `arguments` says is what a press
      // sends, so the visibility the field defaulted to is in here too.
      expect(ran.proposal?.arguments).toEqual({
        title: "Japan",
        start: "2026-03-01",
        end: "2026-03-14",
        visibility: "guest",
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
 * B906 — "the day with the photograph of Anna in it", which named a thing
 * rather than a date and used to land nowhere, because no tool could turn a
 * sentence like that into a day at all.
 */
describe("finding a day by what was in it, not by its date", () => {
  test("the registry carries it, as a read tool that renders a choice", () => {
    const tool = TOOLS.find((one) => one.name === "find_day");
    expect(tool?.kind).toBe("read");
    expect(tool?.renders).toBe("choose");
  });

  test("a sentence naming a thing resolves to a day, not a proposal", async () => {
    catalogue.rows = [
      { id: "italy-2026/anna-photo", kind: "day", title: "Lake shore", where: "Italy 2026 · 2026-06-02", url: "/alex/day/anna-photo" },
    ];
    said.hits = [{ id: "italy-2026/anna-photo", why: "the photo of Anna" }];
    const ran = await runTool("alex", "find_day", { said: "the day with the photo of Anna" }, say, "2026-09-07");
    expect(ran.ok).toBe(true);
    expect(ran.proposal).toBeUndefined();
    expect(ran.blocks[0]).toMatchObject({
      shape: "choose",
      options: [{ value: "italy-2026/anna-photo", label: "Lake shore" }],
    });
  });

  /**
   * The same discipline `app/api/helper/[user]/search/route.ts` enforces with
   * its own `byId.get(hit.id)` filter: an id the catalogue never carried —
   * another journal's day, or a trip this reader is not on — is dropped
   * rather than resolved. A model that invented a row would otherwise be
   * inventing a page.
   */
  test("an id the catalogue never sent it is dropped, not resolved", async () => {
    catalogue.rows = [
      { id: "italy-2026/anna-photo", kind: "day", title: "Lake shore", where: "Italy 2026", url: "/alex/day/anna-photo" },
    ];
    said.hits = [
      { id: "italy-2026/anna-photo", why: "real" },
      { id: "someone-elses/private-day", why: "invented, or another journal's" },
    ];
    const ran = await runTool("alex", "find_day", { said: "anna" }, say, "2026-09-07");
    const options = (ran.blocks[0] as { options: { value: string }[] }).options;
    expect(options.map((one) => one.value)).toEqual(["italy-2026/anna-photo"]);
  });

  test("nothing found says so honestly, and does not fall through to a proposal", async () => {
    catalogue.rows = [
      { id: "italy-2026/anna-photo", kind: "day", title: "Lake shore", where: "Italy 2026", url: "/alex/day/anna-photo" },
    ];
    said.hits = [];
    const ran = await runTool("alex", "find_day", { said: "the day we got lost" }, say, "2026-09-07");
    expect(ran.ok).toBe(true);
    expect(ran.blocks).toEqual([]);
    expect(ran.proposal).toBeUndefined();
    expect(ran.result).toMatchObject({ found: false });
    expect((ran.result as { why: string }).why).toMatch(/not.*start a new day|nothing.*matches/i);
  });

  test("an empty journal says so, rather than searching nothing", async () => {
    catalogue.rows = [];
    const ran = await runTool("alex", "find_day", { said: "anna" }, say, "2026-09-07");
    expect(ran.blocks).toEqual([]);
    expect(ran.result).toMatchObject({ found: false });
  });
});

/**
 * The one thing that must not become a chat action, and is not even a `link`:
 * matched by the refusal table in `lib/helper/intents.ts` before the model is
 * called at all (B817), which is stricter than a tool the model could choose.
 * Deleting finishes in a mailbox. A postcard used to be refused the same way,
 * on the same reasoning — there was no tool for it — but `propose_postcards`
 * is one now (`lib/helper/tools/areas/printed.ts`): it writes a real order
 * and hands over a URL, and pressing still happens only on the owner's own
 * postcards page, which is what the tool's own `describe` and `done` say.
 */
describe("what has no tool at all", () => {
  for (const forbidden of ["delete", "erase", "destroy", "send", "upload"]) {
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
    "/api/helper/alex/trip/visibility",
    "/api/helper/alex/trip/reminder",
    "/api/helper/alex/trip/people",
    "/api/helper/alex/trip/tracks",
    "/api/helper/alex/day",
    "/api/helper/alex/day/write-day",
    "/api/helper/alex/day/costs",
    "/api/helper/alex/day/publish",
    "/api/helper/alex/day/unpublish",
    "/api/helper/alex/day/attach",
    "/api/helper/alex/day/remove-photo",
    "/api/helper/alex/inbox/discard",
    "/api/helper/alex/invite",
    "/api/helper/alex/trip/rates",
    "/api/helper/alex/trip/budget",
    "/api/helper/alex/invite/revoke",
    "/api/helper/alex/day/tell-readers",
    "/api/helper/alex/channels",
    "/api/helper/alex/journal",
    "/api/helper/alex/storage/cleanup",
    "/api/helper/alex/storage",
    "/api/helper/alex/keys",
    "/api/helper/alex/postcard",
    "/api/helper/alex/photobook",
    "/api/helper/alex/day/undo",
    "/api/helper/alex/day/weather",
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

/**
 * Who may read it, and the value that shuts out the person they named — B923.
 *
 * *"nur meine Tochter soll das lesen können"* proposed `privat — nur die
 * Leute, die dabei waren`. Her daughter was not at the lake, so the setting
 * offered would have hidden it from the one reader she asked for, and the
 * model's own sentence beside the field claimed the opposite of the label.
 * AGENTS.md names this exact trap: **guest means the people I let into this
 * journal; private means only the people who were there.** A person named is
 * a guest.
 *
 * The choice itself is the model's and is not assertable. What is assertable
 * is everything around it: the sentence it reads before choosing, the closed
 * list the person reads before pressing, and where an unsaid or misspelt
 * value lands.
 */
describe("who may read a trip is read before it is chosen", () => {
  const visibility = TOOLS.find((tool) => tool.name === "create_trip");

  test("the model is told which of the two closed values a named person is", () => {
    const said = visibility?.properties.visibility?.description ?? "";
    expect(said).toContain("only my daughter");
    expect(said).toMatch(/guest/i);
    expect(said).toMatch(/only the people who were on the trip/i);
    // And it is told not to answer the question in prose of its own, which is
    // how the contradiction reached her screen.
    expect(visibility?.describe).toMatch(/never say in your own words who/i);
  });

  async function proposed(args: Record<string, string>) {
    const ran = await runTool("someone", "create_trip", args, say, "2026-09-07");
    const field = ran.proposal?.fields.find((one) => one.name === "visibility");
    if (!field) throw new Error("create_trip proposed no visibility");
    return field;
  }

  test("it is a closed list, and each option says who it lets in", async () => {
    const field = await proposed({ title: "Am See", start: "2026-05-01", end: "2026-05-03" });
    expect(field.options?.map((one) => one.value)).toEqual(["public", "guest", "private"]);
    // The labels are the safety: they are the words she read and corrected.
    expect(field.options?.map((one) => one.label)).toEqual([
      "agent.tool.visibilityPublic",
      "agent.tool.visibilityGuest",
      "agent.tool.visibilityPrivate",
    ]);
  });

  test("said nothing, or said nonsense, it opens on guest and never on private", async () => {
    expect((await proposed({ title: "Am See" })).value).toBe("guest");
    expect((await proposed({ title: "Am See", visibility: "familie" })).value).toBe("guest");
  });

  test("the card points at the label rather than paraphrasing it", async () => {
    const ran = await runTool("someone", "create_trip", { title: "Am See" }, say, "2026-09-07");
    expect(ran.proposal?.sentence).toContain("agent.tool.createTripVisibility");
  });
});

/**
 * Letting the person they named actually read it — B931.
 *
 * The tool is the half of that ticket that makes the honest answer sayable.
 * What is assertable here is its shape: it is the *guest* link and only that,
 * it proposes rather than issues, and the sentence a person reads before and
 * after the press says they can now **ask** rather than that they are in.
 */
describe("inviting somebody to read", () => {
  const invite = TOOLS.find((tool) => tool.name === "invite_guest");

  test("it is a write tool, so it issues nothing by itself", () => {
    expect(invite?.kind).toBe("write");
    expect(invite).not.toHaveProperty("run");
    expect(invite && invite.kind === "write" && invite.endpoint("alex")).toBe(
      "/api/helper/alex/invite",
    );
  });

  test("there is no buddy link here, and no way to ask for one", () => {
    // A buddy link is write access to a trip and belongs on the contacts
    // page. No `kind`, no `trip`: nothing a model could get wrong.
    expect(Object.keys(invite?.properties ?? {})).toEqual(["name"]);
    expect(TOOLS.map((tool) => tool.name).filter((name) => name.includes("buddy"))).toEqual([]);
    expect(invite?.describe).not.toMatch(/buddy/i);
  });

  test("the model is told it grants nothing", () => {
    expect(invite?.describe).toMatch(/ask to read/i);
    expect(invite?.describe).toMatch(/grants nothing/i);
  });

  test("it proposes a link and touches no disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-"));
    const before = process.env.CONTENT_DIR;
    process.env.CONTENT_DIR = dir;
    try {
      const ran = await runTool("alex", "invite_guest", { name: "meine Tochter" }, say, "2026-09-07");
      expect(ran.proposal?.tool).toBe("invite_guest");
      expect(ran.proposal?.fields).toEqual([{ name: "name", value: "meine Tochter" }]);
      expect(ran.result).toMatchObject({ proposed: true, wrote: false });
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.CONTENT_DIR;
      else process.env.CONTENT_DIR = before;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The sentence after the press, in all three languages: **they can ask.**
   * "They have access" is the same false claim B931 is about, moved one step
   * later, so the words are checked rather than left to a translator's ear.
   */
  for (const locale of MAINTAINED_LOCALES) {
    test(`${locale}: what is said after the press is that they can ask, never that they are in`, () => {
      const dictionary = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "site", "locales", `${locale}.json`), "utf8"),
      ) as Record<string, string>;
      const done = dictionary["agent.tool.inviteGuestDone"];
      const asks = {
        en: /ask to be let in/i,
        de: /um Zugang bitten/i,
        hu: /kérheti/i,
      }[locale];
      const approve = { en: /approve/i, de: /bestätigst/i, hu: /jóvá nem hagyod/i }[locale];
      expect(done).toMatch(asks);
      expect(done).toMatch(approve);
    });
  }
});

describe("every string a tool says exists in every maintained locale", () => {
  // B1042 — the registry is a directory now; reading one file would check a
  // sixth of it.
  const root = path.join(process.cwd(), "lib", "helper", "tools");
  const source = fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => fs.readFileSync(path.join(root, name), "utf8"))
    .join("\n");
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
