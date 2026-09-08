import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { forget, history } from "@/lib/helper/thread";
import { TOOLS, runTool } from "@/lib/helper/tools";
import { threadSystemPrompt } from "@/lib/helper/model";

/**
 * The thread — B889, round 1 of `docs/plans/2026-09-07-helper-as-an-agent.md`.
 *
 * The owner said four of seven ordinary German sentences came back `unknown`,
 * and he was right: a registry answers what somebody wrote a row for. The four
 * are the first block here.
 *
 * **The model is scripted, not called.** What a model decides is not
 * assertable and never has been in this codebase; what *is* assertable is
 * everything on either side of it — that a tool the model asked for ran and
 * came back, that the answer reached the person, that the conversation was
 * still there on the second turn, that removal language never got as far as
 * the model at all, and that after all of it not one byte of the journal
 * changed. The last is the whole claim of round 1.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { routeAsk } = vi.hoisted(() => ({ routeAsk: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  routeAsk,
}));

/** Every request the thread made, and the scripted answers it got back. */
const { create, sent } = vi.hoisted(() => ({
  create: vi.fn(),
  sent: [] as Record<string, unknown>[],
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        return create(params);
      },
    };
  },
}));

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function ask(said: string) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ said, today: "2026-09-07" }),
    }),
    params,
  );
}

/** What the route hands `runTool`: the reader's own language. English here,
 *  because what is asserted is the shape and not the wording. */
const say = (key: string, vars?: Record<string, string>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key;

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** A scripted turn: the model says a sentence and calls nothing. */
function says(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 1200, output_tokens: 90 },
  };
}

/** A scripted turn: the model asks for one tool. */
function calls(name: string, input: Record<string, string> = {}) {
  return {
    content: [{ type: "tool_use", id: `t-${name}`, name, input }],
    usage: { input_tokens: 1200, output_tokens: 40 },
  };
}

/** Everything under this journal, path and bytes — the thing round 1 promises
 *  not to touch. The database is deliberately outside it: a turn does write a
 *  usage row, and that is the operator's bookkeeping rather than the journal. */
function journalOnDisk(): Record<string, string> {
  const root = path.join(dir, "alex");
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const item of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, item.name);
      if (item.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-thread-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-thread-secret-b889";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  routeAsk.mockReset();
  // Nothing in the registry fits, which is what took four of the owner's
  // seven sentences to `unknown` and is now what opens the thread.
  routeAsk.mockResolvedValue({ intent: "unknown", slots: {}, confidence: 0 });
  create.mockReset();
  sent.length = 0;
  forget("alex");

  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "de",
      locales: ["de"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      "title: Die Reise",
      'start: "2026-05-01"',
      'end: "2026-05-10"',
      "visibility: private",
      "---",
      "",
      "Intro.",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-eins.md"),
    ["---", "title: Eins", 'date: "2026-05-01"', "---", "", "Worte."].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "entries", "2026-05-02-zwei.md"),
    ["---", "title: Zwei", 'date: "2026-05-02"', "status: draft", "---", "", "Worte."].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
});

afterEach(async () => {
  await closeDatabase();
  forget("alex");
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

/* --------------------------------------------------- the four sentences --- */

describe("the four German sentences that used to come back unknown", () => {
  test('"wie geht das hier" is answered in prose, from the prompt, with no lookup', async () => {
    create.mockResolvedValueOnce(
      says("Du schreibst hier einen Tag über den Tages-Helfer. Ich kann nachschauen, aber nichts ändern."),
    );
    const answered = await read(await ask("wie geht das hier"));
    expect(answered.status).toBe(200);
    expect(answered.body.kind).toBe("read");
    expect(answered.body.intent).toBe("thread");
    expect(String(answered.body.answer)).toContain("Tages-Helfer");
    expect(answered.body.looked).toEqual([]);
  });

  test('"was kostet das" runs the credits tool and answers from what it read', async () => {
    create
      .mockResolvedValueOnce(calls("credits"))
      .mockResolvedValueOnce(says("Du hast noch 10 Credits. Fragen kostet nichts."));
    const answered = await read(await ask("was kostet das"));
    expect(answered.body.looked).toEqual(["credits"]);
    expect(String(answered.body.answer)).toContain("10 Credits");
    // The tool actually ran, and its answer went back to the model.
    const back = (sent[1].messages as { role: string; content: unknown }[])[2];
    const result = (back.content as { content: string }[])[0].content;
    expect(JSON.parse(result)).toEqual({ balance: 10 });
  });

  test('"ich war in lissabon" is answered without anything being written down', async () => {
    const before = journalOnDisk();
    create.mockResolvedValueOnce(
      says("Notiert habe ich das nicht — ich kann hier nichts schreiben. Im Tages-Helfer kommt es in den Tag."),
    );
    const answered = await read(await ask("ich war in lissabon"));
    expect(String(answered.body.answer)).toContain("Tages-Helfer");
    expect(journalOnDisk()).toEqual(before);
  });

  test('"füge ein foto hinzu" is answered with where photographs go', async () => {
    const before = journalOnDisk();
    create.mockResolvedValueOnce(
      says("Hochladen kann ich nicht. Fotos kommen im Tages-Helfer zum Tag dazu."),
    );
    const answered = await read(await ask("füge ein foto hinzu"));
    expect(answered.status).toBe(200);
    expect(answered.body.kind).toBe("read");
    expect(journalOnDisk()).toEqual(before);
  });

  test("a model that fails leaves the person on the answer that always works", async () => {
    create.mockRejectedValueOnce(new Error("nope"));
    const answered = await read(await ask("wie geht das hier"));
    expect(answered.status).toBe(200);
    expect(answered.body.kind).toBe("unknown");
  });
});

/* ------------------------------------------------------- the one guard --- */

describe("removal language never reaches the model — B817", () => {
  for (const said of ["lösche den Tag mit dem Foto von Anna", "delete my journal", "töröld a napot"]) {
    test(`"${said}" is refused before any model, and is not remembered`, async () => {
      const answered = await read(await ask(said));
      expect(answered.body.intent).toBe("refuse_remove");
      expect(routeAsk).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      // The other half, and the one the thread makes newly necessary: a
      // refused sentence written into the conversation would reach the model
      // on the *next* turn instead.
      expect(history("alex")).toEqual([]);
    });
  }
});

/* --------------------------------------------------------- the thread --- */

describe("the conversation", () => {
  test("survives a second turn without the person repeating the first", async () => {
    create
      .mockResolvedValueOnce(says("Die Reise heisst Die Reise."))
      .mockResolvedValueOnce(says("Sie dauert vom 1. bis zum 10. Mai."));
    await ask("wie heisst meine reise");
    await ask("und wie lange");

    // Four messages went with the second turn's one sentence: the exchange
    // before it, and the sentence itself.
    const second = sent[1].messages as { role: string; content: unknown }[];
    expect(second).toHaveLength(3);
    expect(second[0]).toEqual({ role: "user", content: "wie heisst meine reise" });
    expect(second[1]).toEqual({ role: "assistant", content: "Die Reise heisst Die Reise." });
    expect(second[2]).toEqual({ role: "user", content: "und wie lange" });
  });

  test("a row the registry does answer joins the conversation too", async () => {
    routeAsk.mockResolvedValue({ intent: "credits", slots: {}, confidence: 0.9 });
    await ask("how many credits");
    expect(history("alex").map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(history("alex")[1].text).toContain("10");
  });

  test("nothing carries over between journals", async () => {
    create.mockResolvedValueOnce(says("Hallo."));
    await ask("wie geht das hier");
    expect(history("alex")).toHaveLength(2);
    expect(history("somebody-else")).toEqual([]);
  });
});

/* ------------------------------------------------------------ the tools --- */

const READS = TOOLS.filter((tool) => tool.kind === "read");

describe("the tools", () => {
  test("are the seven reads the plan names, and B898's first write and link", () => {
    expect(READS.map((tool) => tool.name)).toEqual([
      "list_trips",
      "unfinished",
      "read_day",
      "trip_costs",
      "storage",
      "credits",
      "who_can_read",
    ]);
    expect(TOOLS.filter((tool) => tool.kind !== "read").map((tool) => tool.name)).toEqual([
      "new_trip",
      "day_helper",
    ]);
  });

  test("every one of them runs, and none of them changes anything", async () => {
    const before = journalOnDisk();
    for (const tool of TOOLS) {
      const { ok, result } = await runTool(
        "alex",
        tool.name,
        { trip: "reise", date: "2026-05-01" },
        say,
      );
      expect(ok, tool.name).toBe(true);
      expect(result, tool.name).toBeDefined();
    }
    expect(journalOnDisk()).toEqual(before);
  });

  test("a tool nobody has is a fact the model can read, not a crash", async () => {
    const { ok, result } = await runTool("alex", "publish", {}, say);
    expect(ok).toBe(false);
    expect(JSON.stringify(result)).toContain("no tool called publish");
  });

  test("nothing here reaches the position history", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib", "helper", "tools.ts"),
      "utf8",
    );
    // The comment above `TOOLS` says why, at length; what must not be
    // here is an import of the store or a path into the folder.
    expect(source).not.toMatch(/from "[^"]*gps|content[^"']*\/gps\//);
  });

  test("the model is shown every tool, and told what it cannot do", () => {
    const prompt = threadSystemPrompt("2026-09-07");
    for (const tool of TOOLS) expect(prompt).toContain(tool.name);
    expect(prompt).toContain("You cannot change this journal");
    // The three gates that outlive this round, said in the prompt as well as
    // enforced outside it.
    expect(prompt).toContain("weather");
    expect(prompt).toContain("email");
    expect(prompt).toContain("preview");
  });
});

/* ------------------------------------------------------------ the price --- */

describe("what a turn costs", () => {
  /**
   * The fixed part of every turn, estimated at four characters to the token —
   * there is no API key in this repository and an invented measurement would
   * be worse than an arithmetic one. It is here so that it cannot grow by half
   * again without somebody deciding to let it.
   *
   * B898 raised it from sixteen hundred: two more tools, and the sentence in
   * the prompt that says what a *write* tool does — proposes, and waits. Two
   * bullets of directions came out in exchange, because a tool that hands
   * somebody the day helper says what the paragraph describing it said.
   */
  test("the prompt and the tool list stay under eighteen hundred tokens", () => {
    const schemas = TOOLS.map((tool) => JSON.stringify(tool.properties) + tool.describe).join("");
    const characters = threadSystemPrompt("2026-09-07").length + schemas.length;
    expect(Math.round(characters / 4)).toBeLessThan(1800);
  });
});
