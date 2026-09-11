import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { issueCode, verifyCode, resolveSession, GUEST_COOKIE } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { grant } from "@/lib/credits";
import { refusalFor, type Say } from "@/lib/helper/intents";
import { TOOLS, runTool } from "@/lib/helper/tools";
import { getTrips } from "@/lib/trips";

/**
 * Round 1 of `docs/plans/2026-09-07-helper-everything.md` — the four ways this
 * box did the wrong thing confidently, or went quiet, at the moment somebody
 * most needed it not to. B817, B808, B783, B807.
 *
 * `answerInThread` is stubbed throughout and stubbed **hostile**: whatever is
 * said, it reaches for the tool that *creates* a day. That is the point of the
 * first block — a refusal a confident guess can talk its way past is not a
 * refusal, and the misroute B817 records carried more confidence than any
 * floor would have caught.
 *
 * B900 narrowed what is refused and it is worth being explicit about the line,
 * because it is the one thing here that moved. Words that mean **destroy**
 * are still refused before a model reads them, and there is no tool that
 * deletes anything. Words that mean **take it off the site** now reach the
 * conversation, where `unpublish_day` proposes and waits to be pressed — a
 * day taken down keeps its words and its photographs, and putting it back is
 * one press. A refusal in front of that would only have been telling somebody
 * to go and press an identical button somewhere else.
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

const { answerInThread } = vi.hoisted(() => ({ answerInThread: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  answerInThread,
}));

/** A turn that reaches for one real tool, whatever was said. */
function turnCalling(name: string, args: Record<string, string> = {}) {
  return async (user: string, _said: string, _turns: unknown, today: string, say: Say) => {
    const ran = await runTool(user, name, args, say, today);
    return {
      answer: "Here.",
      looked: [name],
      blocks: ran.blocks,
      proposals: ran.proposal ? [ran.proposal] : [],
    };
  };
}

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");
const { GET: dayRoute } = await import("@/app/api/helper/[user]/day/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function ask(said: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://t.test/api/helper/alex/ask", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ said, today: "2026-09-07" }),
    }),
    params,
  );
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-safe-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-safe-answers-secret";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  answerInThread.mockReset();
  // Hostile by default: it reaches for the tool that *creates* a day, which is
  // the exact wrong neighbour B817 is about.
  answerInThread.mockImplementation(turnCalling("start_day"));

  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
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
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  // B1091 — `ask` now spends `HELPER_TURN_CREDITS` before its one model
  // call, and this file's `credits: { enabled: true }` means it is on.
  await grant("alex", 1);
  await consentRoute(
    new Request("https://t.test/api/helper/alex/consent", { method: "POST" }),
    params,
  );
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeTrip() {
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "visibility: private", "---", "", "Intro."].join("\n"),
  );
  const day = (date: string, slug: string, draft: boolean) =>
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", `${date}-${slug}.md`),
      ["---", `title: ${slug}`, `date: "${date}"`, ...(draft ? ["status: draft"] : []), "---", "", "Words."].join("\n"),
    );
  day("2026-05-01", "one", false);
  day("2026-05-02", "two", false);
  day("2026-05-03", "three", true);
}

/* ---------------------------------------------------------------- B817 --- */

describe("destruction never reaches a model at all — B817", () => {
  const DESTRUCTION = [
    // en
    "delete my acc",
    "get rid of yesterday",
    "erase that day",
    // de
    "lösche den Tag mit dem Foto von Anna",
    // hu
    "töröld a napot Anna fényképével",
  ];

  // "remove the photo of anna" and "entferne bitte das Foto von Anna" were on
  // that list until `remove_photo` existed. They are on the list below now,
  // and the German day-with-a-photo sentence stayed above deliberately: it
  // names a picture and asks for a day.

  for (const said of DESTRUCTION) {
    test(`"${said}" is refused by name, and opens nothing`, async () => {
      const answered = await read(await ask(said));
      expect(answered.status).toBe(200);
      expect(answered.body.intent).toBe("refuse_remove");
      expect(answered.body.refused).toBe("remove");
      // Not a screen, and not a set of fields: a sentence.
      expect(answered.body.kind).toBe("read");
      expect(answered.body.href).toBeUndefined();
      expect(answered.body.proposals).toBeUndefined();
      // And the model was never asked, so no confidence can reach past it.
      expect(answerInThread).not.toHaveBeenCalled();
    });
  }

  test("the answer does not claim this box could delete something", async () => {
    const answered = await read(await ask("delete the day with the photo of anna"));
    const said = String(answered.body.answer);
    expect(said).toContain("Deleting is not something");
    // Where it actually happens: a mailbox, and a button in it.
    expect(said).toContain("email");
    expect(said).toContain("button");
  });

  test("and it says the gentler thing is available, rather than only refusing", async () => {
    const answered = await read(await ask("delete that day"));
    expect(String(answered.body.answer)).toContain("taking a day off the site");
  });

  test("no tool in the registry deletes anything, whatever a model asks for", () => {
    for (const tool of TOOLS) {
      expect(tool.name, tool.name).not.toMatch(/delete|destroy|erase/);
      if (tool.kind === "write") {
        expect(tool.endpoint("alex"), tool.name).not.toMatch(/delete/);
      }
    }
  });
});

describe("taking a day down is not destroying it — B816, B900", () => {
  const TAKEDOWNS = [
    "take down the day with the photo of anna",
    "unpublish the day about the ferry",
    "nimm den Tag mit dem Foto von Anna runter",
    "vedd le a napot az oldalról",
  ];

  for (const said of TAKEDOWNS) {
    test(`"${said}" reaches the conversation rather than a refusal`, async () => {
      const answered = await read(await ask(said));
      expect(answered.body.refused).toBeUndefined();
      expect(answerInThread).toHaveBeenCalledOnce();
    });
  }

  test("and what it lands on proposes, and takes nothing down by itself", async () => {
    writeTrip();
    answerInThread.mockImplementation(turnCalling("unpublish_day", { trip: "reise", slug: "one" }));
    const answered = await read(await ask("take the ferry day off the site"));
    const proposals = answered.body.proposals as { tool: string; endpoint: string }[];
    expect(proposals[0].tool).toBe("unpublish_day");
    expect(proposals[0].endpoint).toBe("/api/helper/alex/day/unpublish");
    // Still published: a proposal is not a takedown.
    const day = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-05-01-one.md"),
      "utf8",
    );
    expect(day).not.toContain("status: draft");
  });
});

/* ---------------------------------------------------------------- B783 --- */

describe("a named refusal instead of silence — B783", () => {
  test("publishing is a rendered day and then one press, not a refusal", async () => {
    writeTrip();
    answerInThread.mockImplementation(turnCalling("publish_day", { trip: "reise", slug: "three" }));
    const answered = await read(await ask("publish that day for me"));
    expect(answered.body.refused).toBeUndefined();
    const blocks = answered.body.blocks as { shape: string }[];
    // The day, and then the button — in that order, always.
    expect(blocks[0].shape).toBe("preview");
    expect(blocks[1].shape).toBe("confirm");
    // And it is still a draft, because nobody has pressed anything.
    const day = fs.readFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-05-03-three.md"),
      "utf8",
    );
    expect(day).toContain("status: draft");
  });

  /**
   * Postcards used to be refused by name here, on the same reasoning as
   * `delete` — there was no tool for them either. `propose_postcards` is one
   * now (`lib/helper/tools/areas/printed.ts`), so a sentence naming a card
   * reaches the conversation like any other write and proposes rather than
   * being turned away before a model reads it.
   */
  test("a postcard reaches the conversation rather than a refusal", async () => {
    writeTrip();
    answerInThread.mockImplementation(turnCalling("propose_postcards", { trip: "reise", slug: "one" }));
    const answered = await read(await ask("send a postcard to my mum"));
    expect(answered.body.refused).toBeUndefined();
    expect(answerInThread).toHaveBeenCalledOnce();
  });

  /* ------------------------------------------------------------ B914 --- */

  /**
   * The floor the owner put under B900.
   *
   * B900 let takedown and publish sentences reach a tool instead of being
   * refused, and the review kept that — with one exception: publishing may
   * only ever be proposed from a sentence that names a day. "Publish
   * everything now" is the single shape where a vague sentence touches the
   * path that puts things on the site, which is the dangerous direction.
   *
   * `proposeWith` already refuses a proposal whose `slug` came back empty
   * (B925), so a publish sentence the model *fails* to resolve was covered.
   * What was not is the model being helpful: asked to publish everything,
   * picking the first draft, and resolving it perfectly. Only a check on the
   * sentence closes that, and these are the sentences.
   */
  test("publishing everything is refused before a model reads it", async () => {
    for (const said of [
      "publish everything now",
      "veröffentliche alles",
      "tedd közzé mindet",
      "stell alles online",
      "put the whole trip online",
    ]) {
      expect(refusalFor(said)?.name, said).toBe("publish_all");
    }
    // And it is a refusal, not a route: the model is never asked.
    answerInThread.mockClear();
    const answered = await read(await ask("publish everything now"));
    expect(answered.body.intent).toBe("refuse_publish_all");
    expect(answered.body.proposals ?? []).toHaveLength(0);
    expect(answerInThread).not.toHaveBeenCalled();
  });

  test("a sentence that names a day still publishes, and taking everything down is untouched", () => {
    // The floor is narrow on purpose — this is the whole point of it.
    for (const said of [
      "publish that day for me",
      "publish the day about the pass",
      "veröffentliche den tag",
      "tedd közzé a keddi napot",
    ]) {
      expect(refusalFor(said), said).toBeNull();
    }
    // Down is the reversible direction and has no row.
    expect(refusalFor("unpublish everything")).toBeNull();
    expect(refusalFor("nimm alles runter")).toBeNull();
    // And a question about the same words is a question, not a refusal —
    // going quiet here is what B783 was about.
    expect(refusalFor("are all my days online?")).toBeNull();
    expect(refusalFor("how many days are unpublished")).toBeNull();
  });

  test("destruction still wins over it: \"delete everything\" is the remove refusal", () => {
    expect(refusalFor("delete everything")?.name).toBe("remove");
    expect(refusalFor("lösche alles")?.name).toBe("remove");
  });

  /**
   * A photograph and a staged file are the exception, and they became one on
   * the day `remove_photo` and `discard_file` were built.
   *
   * This row used to match "remove … photo" deliberately, because nothing
   * could do it and a refusal was the honest answer. Now something can, and a
   * refusal firing first would make both tools unreachable by the only
   * sentence anybody says out loud. What is still refused is everything the
   * helper genuinely cannot do: a day, a trip, a whole journal.
   */
  test("a picture or a file may be asked for; a day, a trip and a journal may not", () => {
    for (const said of [
      "remove that photo",
      "delete the photo of the harbour",
      "lösch das foto bitte",
      "entferne die datei",
      "töröld a képet",
    ]) {
      expect(refusalFor(said), said).toBeNull();
    }
    for (const said of [
      "delete the trip",
      "delete everything",
      "lösche die reise",
      "get rid of the journal",
      "törölj mindent",
    ]) {
      expect(refusalFor(said)?.name, said).toBe("remove");
    }
  });

  test("both refusals answer in German and Hungarian too", () => {
    for (const locale of ["de", "hu"]) {
      const dictionary = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "site", "locales", `${locale}.json`), "utf8"),
      ) as Record<string, string>;
      for (const name of ["Remove", "PublishAll"]) {
        expect(dictionary[`agent.askRefuse${name}`]?.length ?? 0).toBeGreaterThan(20);
      }
    }
  });

  test("a sentence nobody could map is not a refusal", () => {
    expect(refusalFor("asdf qwer zxcv")).toBeNull();
  });

  test("the trips a person has are answered as a list to pick from", async () => {
    writeTrip();
    answerInThread.mockImplementation(turnCalling("trips"));
    const answered = await read(await ask("zeig mir meine reisen"));
    const blocks = answered.body.blocks as { shape: string; options?: { label: string }[] }[];
    expect(blocks[0].shape).toBe("choose");
    expect(blocks[0].options?.map((option) => option.label)).toEqual(["Die Reise"]);
    // A read, so nothing was written to say it.
    expect(getTrips("alex")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- B808 --- */

describe("the storage answer stops catching sentences about stuff — B808", () => {
  test("its description is about bytes, and says it is not about where anything is", () => {
    const account = TOOLS.find((tool) => tool.name === "account");
    expect(account?.describe).toContain("disk space");
    expect(account?.describe).toMatch(/never where/i);
  });

  test("no tool offers to say where something is", () => {
    for (const tool of TOOLS) {
      expect(tool.describe).not.toMatch(/how much room this journal is using/i);
    }
  });
});

/* ---------------------------------------------------------------- B807 --- */

describe("a lapsed session says so — B807", () => {
  test("no session at all is told the session lapsed, not that this is not their journal", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(await ask("how much storage"));
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("session_lapsed");
    expect(answerInThread).not.toHaveBeenCalled();
  });

  test("every route in the family answers alike, not only the ask box", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(
      await dayRoute(new Request("https://t.test/api/helper/alex/day?trip=reise&slug=x"), params),
    );
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe("session_lapsed");
  });

  test("a session that is simply not the owner's keeps the bare 404", async () => {
    resolveAccess.mockResolvedValue({ email: "someone-else@example.test" });
    const refused = await read(await ask("how much storage"));
    // A helper URL must not confirm whose journal it is, so this one is not
    // told anything at all — not even that they are signed in as somebody else.
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
    expect(refused.body.message).toBeUndefined();
  });

  test("a bearer token keeps B779's answer and its 404", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(await ask("how much storage", { authorization: "Bearer whatever" }));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
    expect(String(refused.body.message)).toContain("/api/v1/<user>/");
  });

  /**
   * The half of B807 that had to be ruled out before anything was blamed: two
   * deploys landed during the tester's run, and a restart that signed people
   * out would have been the whole explanation.
   *
   * It is not. A session is a row, and the token is hashed with a plain
   * unsalted SHA-256 (`hashSecret`) rather than with `SESSION_SECRET`, so
   * nothing about it is held in a process. Closing the database and opening it
   * again is what a restart does to this code.
   */
  test("a session survives the process being restarted underneath it", async () => {
    const { code } = await issueCode("alex", OWNER_EMAIL, "guest");
    const verified = await verifyCode("alex", OWNER_EMAIL, code, "guest");
    if (!verified.ok) throw new Error("no session");
    expect(await resolveSession(verified.token, "guest")).not.toBeNull();
    expect(GUEST_COOKIE).toBe("fs_session");

    await closeDatabase();
    await migrateToLatest(await getDatabase());

    const after = await resolveSession(verified.token, "guest");
    expect(after?.email).toBe(OWNER_EMAIL);
  });
});
