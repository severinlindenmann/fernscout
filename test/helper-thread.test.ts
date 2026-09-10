import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant, spend } from "@/lib/credits";
import { forget, history, remember } from "@/lib/helper/thread";
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
const { POST: proposalRoute } = await import("@/app/api/helper/[user]/proposal/route");
const { POST: writeDayRoute } = await import("@/app/api/helper/[user]/day/write-day/route");

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

/** A scripted turn: the model asks for the SAME tool twice, identically —
 *  B1202's live finding, and B1212 (D23)'s dedupe is what these exercise. */
function callsTwice(name: string, input: Record<string, string> = {}) {
  return {
    content: [
      { type: "tool_use", id: `t-${name}-1`, name, input },
      { type: "tool_use", id: `t-${name}-2`, name, input },
    ],
    usage: { input_tokens: 1200, output_tokens: 60 },
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
    expect(String(answered.body.answer)).toContain("Tages-Helfer");
    expect(answered.body.looked).toEqual([]);
  });

  test('"was kostet das" runs the account tool and answers from what it read', async () => {
    create
      .mockResolvedValueOnce(calls("account"))
      .mockResolvedValueOnce(says("Du hast noch 10 Credits. Fragen kostet nichts."));
    const answered = await read(await ask("was kostet das"));
    expect(answered.body.looked).toEqual(["account"]);
    expect(String(answered.body.answer)).toContain("10 Credits");
    // The tool actually ran, and its answer went back to the model.
    const back = (sent[1].messages as { role: string; content: unknown }[])[2];
    const result = (back.content as { content: string }[])[0].content;
    expect(JSON.parse(result)).toMatchObject({ credits: 10 });
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

  test("a model that fails says so, and their own words are still in the box", async () => {
    create.mockRejectedValueOnce(new Error("nope"));
    const answered = await read(await ask("wie geht das hier"));
    expect(answered.status).toBe(502);
    expect(answered.body.error).toBe("model_failed");
    // Nothing half-said was remembered either.
    expect((await history("alex"))).toEqual([]);
  });
});

/* ------------------------------------------------------- the one guard --- */

describe("removal language never reaches the model — B817", () => {
  for (const said of ["lösche den Tag mit dem Foto von Anna", "delete my journal", "töröld a napot"]) {
    test(`"${said}" is refused before any model, and is not remembered`, async () => {
      const answered = await read(await ask(said));
      expect(answered.body.intent).toBe("refuse_remove");
      expect(create).not.toHaveBeenCalled();
      // The other half, and the one the thread makes newly necessary: a
      // refused sentence written into the conversation would reach the model
      // on the *next* turn instead.
      expect((await history("alex"))).toEqual([]);
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

  test("a proposal is remembered as a note, so a correction can be made", async () => {
    create
      .mockResolvedValueOnce(calls("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-14" }))
      .mockResolvedValueOnce(says("Fertig zum Drücken."));
    await ask("neue reise nach japan");

    /**
     * **The marker is a note, and the answer is the answer** — B924.
     *
     * It used to be glued onto the end of the assistant's own text, and a
     * designer watched it render as literal prose with no card and no button.
     * The model reading its own last answer back as something containing a
     * bracketed line is how that happened, so the assistant turn is now the
     * words and nothing else.
     */
    const turns = (await history("alex"));
    expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "note"]);
    expect(turns[1].text).toBe("Fertig zum Drücken.");
    expect(turns[1].text).not.toContain("create_trip");
    expect(turns[2].text).toContain("create_trip");
    expect(turns[2].text).toContain("2027-03-14");
    expect(turns[2].text).toContain("not written");

    // And the correction goes out with that context alongside it — on the
    // person's own next message, where the selection line already rides.
    create.mockResolvedValueOnce(says("Geändert."));
    await ask("nein, der 14.");
    const second = sent[2].messages as { role: string; content: string }[];
    expect(second[1].content).toBe("Fertig zum Drücken.");
    expect(second[2].content).toContain("nein, der 14.");
    expect(second[2].content).toContain("create_trip");
  });

  test("nothing carries over between journals", async () => {
    create.mockResolvedValueOnce(says("Hallo."));
    await ask("wie geht das hier");
    expect((await history("alex"))).toHaveLength(2);
    expect((await history("somebody-else"))).toEqual([]);
  });
});

/* ---------------------------------------------- a proposal with no model --- */

/**
 * B926 — the notes given three turns ago are still usable when the write is
 * retried.
 *
 * `start_day` chaining straight to `draft_words` (B969) never asks the model
 * again: `POST /api/helper/<user>/proposal` builds that second card the way
 * the browser's own `next` mechanism describes it, with the notes riding
 * along in `arguments.notes`. That route never told the thread, so a person
 * whose chained `draft_words` press then failed — no credits, a transient
 * model error, anything — was on their next turn with only a *stale* note
 * about `start_day`, already superseded by its own `[written: …]` note, and
 * the model asked for their notes over again.
 */
function proposeChained(tool: string, args: Record<string, string>) {
  return proposalRoute(
    new Request("https://t.test/api/helper/alex/proposal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, arguments: args, today: "2026-09-07" }),
    }),
    params,
  );
}

function pressWriteDay(body: Record<string, unknown>) {
  return writeDayRoute(
    new Request("https://t.test/api/helper/alex/day/write-day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

const NOTES =
  "Drove up to Kazbegi in the morning, the pass was closed by fog so we waited two hours at a roadside stall, then walked up to Gergeti Trinity Church once it cleared.";

describe("a proposal chained without the model — B926", () => {
  test("enters the conversation, same as one the model proposed itself", async () => {
    const answered = await proposeChained("draft_words", {
      trip: "reise",
      slug: "kazbegi-tag",
      date: "2026-05-01",
      notes: NOTES,
    });
    expect(answered.status).toBe(200);

    const turns = (await history("alex"));
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("note");
    expect(turns[0].text).toContain("draft_words");
    expect(turns[0].text).toContain(NOTES);
    expect(turns[0].text).toContain("not written");
  });

  test("survives a failed press, and the next turn can still use it", async () => {
    await proposeChained("draft_words", {
      trip: "reise",
      slug: "kazbegi-tag",
      date: "2026-05-01",
      notes: NOTES,
    });

    // The press that fails: no credits, the same shape a transient model
    // error or a lapsed balance produces. `refused()` deliberately never
    // touches the thread — the route's own answer already says what
    // happened — so this must not remove what the proposal already put there.
    await spend("alex", 10, "helper", "drain-for-test");
    const pressed = await pressWriteDay({
      trip: "reise",
      slug: "kazbegi-tag",
      date: "2026-05-01",
      notes: NOTES,
    });
    expect(pressed.status).toBe(402);
    expect((await pressed.json()).error).toBe("no_credits");

    // The notes the failed press carried are still the ones the next turn's
    // model call is handed.
    create.mockResolvedValueOnce(says("Which day would you like written up?"));
    await ask("please write up the Kazbegi day");
    const last = sent.at(-1)!.messages as { role: string; content: string }[];
    const combined = last.map((m) => m.content).join("\n");
    expect(combined).toContain("draft_words");
    expect(combined).toContain(NOTES);
  });
});

/* ------------------------------------------------------------ the tools --- */

const READS = TOOLS.filter((tool) => tool.kind === "read");

describe("the tools", () => {
  /**
   * **The set, not the sequence** — B1042.
   *
   * This pinned the exact order of every read, which was worth having while
   * the registry was one array somebody appended to. It is now assembled from
   * areas, so the order is a property of how the areas are stacked — trips,
   * days, money, files, readers, journal — and pinning the flat sequence would
   * mean a test failing every time a capability is added in the middle of an
   * area rather than at the end of the file.
   *
   * What is worth protecting is unchanged: *these* tools exist, and no other.
   * A tool appearing here that nobody meant to add is the thing to catch.
   */
  test("are the reads the plan names, and B900's writes and one link", () => {
    expect([...READS.map((tool) => tool.name)].sort()).toEqual([
      "account",
      "days",
      // B906 — a sentence that names a thing rather than a date used to land
      // on the screen that starts a new day.
      "find_day",
      "inbox",
      // B1051 — the other half of `invite_guest`: what links exist, never
      // the live token that would let a reader in.
      "invites",
      // B1042 — the keys that can write here, and this owner's own past
      // conversations (B1022).
      "keys",
      "past_conversations",
      "postcard_recipients",
      "postcard_texts",
      "print_order",
      "read_day",
      "trip_costs",
      "trips",
      "unfinished",
      "who_can_read",
    ]);
    expect(
      TOOLS.filter((tool) => tool.kind === "write")
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([
      "add_cost",
      "attach_files",
      // B1042 — the journal's own account, read out and now writable too.
      "buy_room",
      // B1051 — the two switches that decide whether either channel below
      // can send anything at all.
      "channels",
      "cleanup",
      "create_trip",
      "discard_file",
      "draft_words",
      // The trip's own settings, reached from the conversation instead of a
      // shell — this round's four.
      "edit_trip",
      // B931 — the only way somebody who was not on a trip can ever read it.
      "invite_guest",
      "journal_settings",
      // The printed-things area: a postcard proposal that writes a real,
      // pending order, and a photobook hand-over that writes nothing at all.
      "photobook",
      "propose_postcards",
      "publish_day",
      "remove_photo",
      // B1051 — take one link back; everybody already approved stays in.
      "revoke_invite",
      "revoke_key",
      "set_budget",
      "set_day_words",
      "set_rate",
      "set_visibility",
      "start_day",
      // B1051 — one tool for the two routes that announce a published day.
      "tell_readers",
      "trip_people",
      "trip_tracks",
      "unpublish_day",
    ]);
    expect(
      TOOLS.filter((tool) => tool.kind === "link")
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["add_photos", "buy_credits"]);
  });

  /**
   * B782 — "how much have I spent" answered with the app's own credit
   * balance, no different from a question about a trip's money. Both tools'
   * own descriptions now say which question they answer and name the other,
   * so the model asked about a journey's spend is pointed at trip_costs
   * rather than left to guess from "credits" alone.
   */
  test("account and trip_costs each say which question they answer, and name the other — B782", () => {
    const account = TOOLS.find((tool) => tool.name === "account")!;
    const tripCosts = TOOLS.find((tool) => tool.name === "trip_costs")!;
    expect(account.describe).toContain("trip_costs");
    expect(account.describe.toLowerCase()).toContain("not a trip's money");
    expect(tripCosts.describe).toContain("account");
    expect(tripCosts.describe.toLowerCase()).toContain("not the journal's own credits");
  });

  test("every one of them runs, and none of them changes anything", async () => {
    const before = journalOnDisk();
    for (const tool of TOOLS) {
      const { ok, result } = await runTool(
        "alex",
        tool.name,
        { trip: "reise", date: "2026-05-01" },
        say,
        "2026-09-07",
      );
      expect(ok, tool.name).toBe(true);
      expect(result, tool.name).toBeDefined();
    }
    expect(journalOnDisk()).toEqual(before);
  });

  test("a tool nobody has is a fact the model can read, not a crash", async () => {
    const { ok, result } = await runTool("alex", "delete_day", {}, say, "2026-09-07");
    expect(ok).toBe(false);
    expect(JSON.stringify(result)).toContain("no tool called delete_day");
  });

  /**
   * **Every file in the registry, not one file** — B1042.
   *
   * This read `lib/helper/tools.ts` when there was one. The registry is a
   * directory now, and a guard that reads a single file while capabilities are
   * added in six others is a guard that has quietly stopped guarding — which
   * matters more here than almost anywhere: `gps/` is the most sensitive
   * folder in the repository, and `test/gps-store.test.ts` asserts the import
   * graph precisely because nothing else would notice.
   */
  test("nothing in the registry reaches the position history", () => {
    const root = path.join(process.cwd(), "lib", "helper", "tools");
    const files = fs
      .readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts"));
    // The split is what makes this worth asserting: if it ever reads one file
    // again, it is checking a sixth of the registry.
    expect(files.length).toBeGreaterThan(6);
    for (const name of files) {
      const source = fs.readFileSync(path.join(root, name), "utf8");
      // What must not be here is an import of the store or a path into the
      // folder. `resolve.ts` explains why at length.
      expect(source, name).not.toMatch(/from "[^"]*gps|content[^"']*\/gps\//);
    }
  });

  test("the model is shown every tool, and told what it cannot do", () => {
    const prompt = threadSystemPrompt("2026-09-07");
    for (const tool of TOOLS) expect(prompt).toContain(tool.name);
    // A write proposes and waits; the press is the person's.
    expect(prompt).toContain("only their press changes anything");
    expect(prompt).toContain("no tool for it");
    // The three gates that outlive this round, said in the prompt as well as
    // enforced outside it.
    expect(prompt).toContain("weather");
    expect(prompt).toContain("email");
    expect(prompt).toContain("It never happens because of a sentence");
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
   * B898 raised it from sixteen hundred to eighteen. **B900 raised it to
   * thirty-four hundred, and that is a decision rather than a drift:** the
   * conversation is the only surface now, so the registry carries seven write
   * tools where it carried one, and the prompt has to say what a proposal is
   * and what still has no tool at all. At Haiku's input price that is a
   * fraction of a rappen a turn, against a wizard's six screens; the number is
   * here so the next person adding a tool sees what it costs rather than
   * finding out from a bill.
   */
  /**
   * **Thirty-seven hundred since B920**, and what the three hundred bought.
   *
   * A 71-year-old was told "Der Text ist gespeichert." on a turn that wrote
   * nothing, and then sent scrolling for a button that was not there. Two
   * paragraphs of the prompt now say that only her press saves anything and
   * that a turn with no proposal has nothing on her screen; the trip argument
   * says the trip is named rather than identified, because the model was
   * inventing `georgia` for `georgia-2026` (B927). At Haiku's input price the
   * three hundred tokens are a fraction of a rappen a turn, and the sentence
   * they replace was one somebody believed.
   */
  /**
   * **Forty-one hundred since B931 and B932**, raised deliberately by four
   * hundred from 3,700 — where it sat at 3,699, with no room left for a
   * sentence (B930 is open on exactly that, and this does not close it).
   *
   * What the four hundred bought: the `invite_guest` tool, which is the only
   * way in this product for somebody who was not on a trip to ever read it,
   * and two paragraphs — that naming a person does not let them in, and that
   * a day's contents are read before they are described. The sentence they
   * replace is "nur Sie und Ihre Tochter können sie sehen", said about a trip
   * her daughter could not open. At Haiku's input price a hundred tokens is a
   * fraction of a rappen a turn.
   */
  /**
   * **Six thousand five hundred since B1043**, raised from 4,100 — and this
   * one is a different kind of raise from the last two, so it is worth saying
   * what it is and what it is not.
   *
   * The last two were paid for by a sentence: a paragraph earned its place, a
   * hundred tokens went with it. This is structural. The registry covers
   * seventeen of the seventy-four operations in the published contract, and
   * the round this raise opens brings that to roughly forty — trip settings,
   * exchange rates, telling readers a day is up, postcards, the photobook,
   * every one of them a capability that exists in the API and has never been
   * offered to anybody.
   *
   * The arithmetic, measured rather than guessed: a tool costs about 459
   * characters of schema and description, so 115 tokens.
   *
   *     18 tools  ~4,200 tokens    38 tools  ~6,500 tokens
   *
   * At Haiku's input price that is $0.0042 a turn against $0.0065 — a quarter
   * of a rappen, on a turn that already spends a credit's worth of output.
   * **The money is not the constraint and pretending otherwise would be the
   * dishonest reading**; the real cost of a long list is that a model choosing
   * among forty tools chooses worse than one choosing among seventeen, and
   * that is a thing to watch in the honesty counters rather than to prevent
   * with a byte budget.
   *
   * So: raised once, deliberately, with room for the whole round rather than
   * a raise per capability. **If this fails again, the answer is almost
   * certainly not another raise** — it is that the list has grown past what a
   * model can choose well from, and the fix is grouping, not budget. B930 is
   * still open and this does not close it.
   *
   * Named once so the number in the message and the number in the assertion
   * cannot disagree — the shape of every other "written down twice" bug here.
   */
  // Raised to 8000 on 2026-09-09, and this is the paragraph the list above
  // asks for. Sixteen tools arrived in one run — the conversation was given
  // the rest of what the API door already had: a trip's settings and its
  // money, who hears about a day, the journal's own account and keys, the
  // printed things, and taking a photograph back off a day. Forty-three tools
  // now, against twenty-seven.
  //
  // Steps 1 and 2 were run first and are in this commit: three of the five
  // "what you still cannot do" bullets had become false — postcards, adding a
  // fellow traveller, and changing a trip after it exists all have tools now —
  // and telling the model it cannot do them was both wrong and paid for. That
  // recovered forty tokens.
  //
  // Forty, against a thousand needed, and the shape of the number is the
  // point: **the schemas are now the larger half.** 3205 tokens of prompt
  // against 4372 of tool descriptions, about a hundred a tool. There is no
  // longer a paragraph in the prompt worth the trade, and trimming
  // descriptions is the one thing the list above rules out.
  //
  // So what the tokens buy is the capability itself, and at Haiku's input
  // price the difference is well under a rappen a turn. Money was never the
  // constraint here and is less of one now.
  //
  // **The constraint that is real is not in this test.** A model choosing
  // among forty-three tools chooses worse than one choosing among seventeen,
  // and no assertion here would notice. B1049 is that question, and the
  // answer when it binds is grouping the tools — not another raise. If this
  // ceiling is met again by adding tools rather than words, read B1049 before
  // changing this number.
  const CEILING = 8000;

  /**
   * **What to do when this fails** — B930, and it is the half the number never
   * carried.
   *
   * The ceiling was met five times on 2026-09-08. Four of those five were paid
   * for out of description quality — a phrase trimmed, an example dropped —
   * because the alternative looked like raising a number a person had set. The
   * fifth found the actual fat, and it is the one worth repeating, because it
   * grows back:
   *
   * **The prompt states the rule; the retry makes the case.** The prompt
   * argued each rule at length, and then each honesty retry in
   * `lib/helper/model.ts` argued the same rule again at the moment it was
   * needed — seven retries, several of them almost a paragraph of the prompt
   * word for word. Four paragraphs came down to four sentences and the ceiling
   * stopped binding, with nothing the model needs upfront removed: the
   * argument still reaches it, later, and only when it matters.
   *
   * So, in order:
   *
   * 1. **Is the same thing said twice** — once here and once in a retry, a
   *    tool `describe`, or a refusal in `lib/helper/intents.ts`? Cut it here
   *    and leave it where it fires.
   * 2. **Is it an argument rather than a rule?** A rule is a sentence. The
   *    reasons behind it belong in the retry the model sees when it breaks
   *    the rule, or in a comment for the next person.
   * 3. **Only then raise the number** — deliberately, in its own commit, with
   *    a paragraph above saying what the tokens bought and what sentence they
   *    replace. Every raise here has one; the history above is those
   *    paragraphs and it is why the number is trustworthy.
   *
   * What is *not* an acceptable trade is cutting a description until a tool is
   * chosen wrongly. At Haiku's input price four hundred tokens is a fraction
   * of a rappen a turn, against a wrong write in somebody's journal.
   */
  test("the prompt and the tool list stay under the ceiling", () => {
    const schemas = TOOLS.map((tool) => JSON.stringify(tool.properties) + tool.describe).join("");
    const characters = threadSystemPrompt("2026-09-07").length + schemas.length;
    const tokens = Math.round(characters / 4);
    expect(
      tokens,
      `The prompt and tool list are ~${tokens} tokens against a ceiling of ${CEILING}. ` +
        "Before raising it: is the same thing said here and again in an honesty retry, a " +
        "tool's `describe`, or a refusal in lib/helper/intents.ts? The prompt states the " +
        "rule; the retry makes the case. Raising is legitimate — in its own commit, with a " +
        "paragraph above this test saying what the tokens bought. See B930.",
    ).toBeLessThan(CEILING);
  });
});

/**
 * The conversation knows when it dropped something — B957.
 *
 * Twelve turns, and the oldest go. That is a cost decision and it stays. What
 * was wrong is that it was invisible: the model could not tell a short
 * conversation from a long one it had lost the beginning of, and it does not
 * behave as though it might be either.
 *
 * Somebody twenty-four turns into writing up a fifteen-day trip asked whether
 * they had said who they were travelling with. They had, in their first
 * message. Rather than say it was out of reach, the model read an unrelated
 * day, called it "the first day", and answered from its prose — confidently,
 * and wrongly.
 */
describe("a conversation long enough to forget its own beginning", () => {
  test("says so, once, to the model and never to the person", async () => {
    forget("alex");
    for (let n = 0; n < 10; n += 1) remember("alex", `said ${n}`, `answered ${n}`);

    const turns = (await history("alex"));
    const notes = turns.filter((turn) => turn.role === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain("no longer in front of you");
    // It is the first thing in the window, where the dropped turns were.
    expect(turns[0].role).toBe("note");
  });

  test("a conversation short enough to remember everything says nothing", async () => {
    forget("alex");
    remember("alex", "eins", "zwei");
    remember("alex", "drei", "vier");
    expect((await history("alex")).some((turn) => turn.role === "note")).toBe(false);
  });

  test("the note does not accumulate as the conversation goes on", async () => {
    forget("alex");
    for (let n = 0; n < 40; n += 1) remember("alex", `said ${n}`, `answered ${n}`);
    expect((await history("alex")).filter((turn) => turn.role === "note")).toHaveLength(1);
  });

  test("and it does not crowd out what is still remembered", async () => {
    forget("alex");
    for (let n = 0; n < 40; n += 1) remember("alex", `said ${n}`, `answered ${n}`);
    const turns = (await history("alex"));
    expect(turns).toHaveLength(16);
    // The most recent exchange survives, which is the whole point of keeping
    // the newest sixteen (B1198 widened it from twelve — seven exchanges of
    // one sitting used to fall off the front).
    expect(turns.at(-2)?.text).toBe("said 39");
    expect(turns.at(-1)?.text).toBe("answered 39");
  });
});

/**
 * Which language an answer is in — B972.
 *
 * One German question, and the rest of the conversation came back in German,
 * including the narration of a day the person had just described in an English
 * paragraph. The prompt said *"in the language they used"*, and with a thread
 * "they" is ambiguous: this message, or the conversation. The model chose the
 * conversation.
 *
 * B921 settled the furniture — every string the server says follows the
 * journal rather than the phone. This is the half only the model can decide,
 * because only the model has the text of what was just said, and detecting a
 * language from one sentence in code would be worse than its reading of it.
 *
 * Asserted on the prompt rather than on behaviour, which is the honest limit:
 * what a model does with an instruction is not a thing a test can hold.
 */
describe("the language rule the model is given", () => {
  test("is about the latest message, not the conversation", () => {
    const prompt = threadSystemPrompt("2026-09-08");
    expect(prompt).toMatch(/latest message/i);
    expect(prompt).toMatch(/not the language of the conversation/i);
    // And the rule it must not lose: their words stay in their words.
    expect(prompt).toMatch(/never translate/i);
  });
});

describe("the same proposal twice in one turn — B1202, D23", () => {
  test("draws once, and the second identical call leaves no second card", async () => {
    create.mockReset();
    create
      .mockResolvedValueOnce(callsTwice("start_day", { trip: "reise", date: "2026-05-03" }))
      .mockResolvedValueOnce(says("Ein Tag für den 3. Mai."));
    const response = await ask("start the third of may");
    const body = (await response.json()) as { blocks: { shape: string }[] };
    const cards = body.blocks.filter(
      (block) => block.shape === "form" || block.shape === "confirm",
    );
    expect(cards).toHaveLength(1);
  });

  test("two calls with different arguments still both draw", async () => {
    create.mockReset();
    create
      .mockResolvedValueOnce({
        content: [
          { type: "tool_use", id: "t-a", name: "start_day", input: { trip: "reise", date: "2026-05-03" } },
          { type: "tool_use", id: "t-b", name: "start_day", input: { trip: "reise", date: "2026-05-04" } },
        ],
        usage: { input_tokens: 1200, output_tokens: 60 },
      })
      .mockResolvedValueOnce(says("Zwei Tage."));
    const response = await ask("start both days");
    const body = (await response.json()) as { blocks: { shape: string }[] };
    const cards = body.blocks.filter(
      (block) => block.shape === "form" || block.shape === "confirm",
    );
    expect(cards).toHaveLength(2);
  });
});
