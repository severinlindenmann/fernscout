import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant, ledgerFor } from "@/lib/credits";
import type { Say } from "@/lib/helper/intents";
import { runTool } from "@/lib/helper/tools";
import { history } from "@/lib/helper/thread";
import { storeInboxFile } from "@/lib/inbox";
import { getTrips } from "@/lib/trips";

/**
 * The one door a sentence goes through — B685, B889, and B900.
 *
 * **Nothing here reaches a network**: `answerInThread` is stubbed, because
 * what a model answers is not assertable and everything that matters is on
 * either side of it. The *tools* are real — the stub calls `runTool` — so a
 * proposal in these assertions is the proposal the product makes.
 *
 * What is asserted is the discipline: a write proposes and the journal is
 * untouched, the press is a second call to a route that already existed, the
 * proposal is remembered so "no, the 14th" has something to correct, the whole
 * door is free, and a bearer token gets nowhere near it.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

// A read-only answer is a sentence in the reader's own language, so the route
// asks `requestLocale()`, which reads `next/headers` and throws outside a real
// request scope. An empty jar is enough: it falls back to English, which is
// what the assertions below read.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { answerInThread } = vi.hoisted(() => ({ answerInThread: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  answerInThread,
}));

/** A turn that says something and calls one real tool — which is how a
 *  proposal in this file is the product's own rather than a fixture's. */
function turnCalling(name: string, args: Record<string, string>, answer = "Here it is.") {
  return async (user: string, _said: string, _turns: unknown, today: string, say: Say) => {
    const ran = await runTool(user, name, args, say, today);
    return {
      answer,
      looked: [name],
      blocks: ran.blocks,
      proposals: ran.proposal ? [ran.proposal] : [],
    };
  };
}

const { POST } = await import("@/app/api/helper/[user]/ask/route");
const { POST: tripRoute } = await import("@/app/api/helper/[user]/trip/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");
const { POST: proposalRoute } = await import("@/app/api/helper/[user]/proposal/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function ask(said: string, headers: Record<string, string> = {}) {
  return POST(post("https://t.test/api/helper/alex/ask", { said, today: "2026-09-07" }, headers), params);
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ask-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-ask-secret-b685";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  answerInThread.mockReset();

  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
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
  await grant("alex", 10);
  await consentRoute(new Request("https://t.test/api/helper/alex/consent", { method: "POST" }), params);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * What is selected in the files pane — B902.
 *
 * The claim is not that a model does anything useful with it; that is the
 * model's. The claim is that the sentence going out carries what the person
 * pointed at, resolved from **disk** rather than from the request, and that
 * what is remembered afterwards is still only what they said.
 */
describe("a selection is referable from a sentence", () => {
  beforeEach(() => {
    // A fixed answer: what the model *says* is not the claim here, and an
    // echo would put the context line into the thread through the reply
    // rather than through the person's own turn.
    answerInThread.mockImplementation(async () => ({
      answer: "Right you are.",
      looked: [],
      blocks: [],
      proposals: [],
    }));
  });

  function askWith(said: string, selected: string[]) {
    return POST(
      post("https://t.test/api/helper/alex/ask", { said, today: "2026-09-07", selected }),
      params,
    );
  }

  test("what was selected goes to the model beside their words", async () => {
    const stored = storeInboxFile("alex", "files", "statement.csv", Buffer.from("a,b\n"), {});
    const routed = await read(await askWith("what is this", [`inbox:${stored.entry.id}`]));
    expect(routed.status).toBe(200);
    const sent = answerInThread.mock.calls[0][1] as string;
    expect(sent.startsWith("what is this\n[")).toBe(true);
    expect(sent).toContain("statement.csv");
  });

  test("an id nothing answers to reaches the model as nothing at all", async () => {
    await askWith("what is this", ["inbox:nope", "photo:no:such"]);
    expect(answerInThread.mock.calls[0][1]).toBe("what is this");
  });

  test("the thread remembers their sentence, not the selection", async () => {
    const stored = storeInboxFile("alex", "files", "statement.csv", Buffer.from("a,b\n"), {});
    await askWith("what is this", [`inbox:${stored.entry.id}`]);
    const said = history("alex").map((turn) => turn.text);
    expect(said[0]).toBe("what is this");
    expect(said.join("\n")).not.toContain("statement.csv");
  });
});

describe("a write tool proposes", () => {
  beforeEach(() => {
    answerInThread.mockImplementation(
      turnCalling("create_trip", { title: "Japan", start: "2027-03-01", end: "2027-03-31" }),
    );
  });

  test("it comes back as fields to press on, and writes nothing", async () => {
    const routed = await read(await ask("make a new trip to Japan in March"));
    expect(routed.status).toBe(200);
    const proposals = routed.body.proposals as Record<string, unknown>[];
    expect(proposals).toHaveLength(1);
    expect(proposals[0].tool).toBe("create_trip");
    expect(proposals[0].endpoint).toBe("/api/helper/alex/trip");
    expect(proposals[0].method).toBe("POST");
    expect(proposals[0].fields).toEqual([
      { name: "title", value: "Japan" },
      { name: "start", value: "2027-03-01", date: true },
      { name: "end", value: "2027-03-31", date: true },
      expect.objectContaining({ name: "visibility", value: "guest" }),
    ]);
    // The whole point: a turn ran and the journal is untouched.
    expect(getTrips("alex")).toHaveLength(0);
  });

  test("who may read it is asked in words, never defaulted silently", async () => {
    const routed = await read(await ask("new trip"));
    const fields = (routed.body.proposals as { fields: { name: string; options?: { label: string }[] }[] }[])[0]
      .fields;
    const visibility = fields.find((field) => field.name === "visibility");
    const labels = (visibility?.options ?? []).map((option) => option.label);
    expect(labels).toHaveLength(3);
    // The two closed ones are told apart by what they mean, not by their name.
    expect(labels.join(" ")).toContain("let into this journal");
    expect(labels.join(" ")).toContain("on the trip");
  });

  test("only the press writes it, at the route the proposal named", async () => {
    const routed = await read(await ask("make a new trip to Japan in March"));
    const proposal = (routed.body.proposals as { endpoint: string; fields: { name: string; value: string }[] }[])[0];
    const created = await read(
      await tripRoute(
        post(
          `https://t.test${proposal.endpoint}`,
          Object.fromEntries(proposal.fields.map((f) => [f.name, f.value])),
        ),
        params,
      ),
    );
    expect(created.status).toBe(201);
    expect(created.body.id).toBe("japan-2027");
    expect(getTrips("alex").map((t) => t.title)).toEqual(["Japan"]);
    expect(getTrips("alex")[0].visibility).toBe("guest");
  });

  test("the proposal is remembered, so a correction has something to correct", async () => {
    await ask("make a new trip to Japan in March");
    const remembered = history("alex")
      .map((turn) => turn.text)
      .join("\n");
    expect(remembered).toContain("create_trip");
    expect(remembered).toContain("2027-03-31");
    // And it is remembered as a proposal rather than as a fact.
    expect(remembered).toContain("not written");
  });

  test("an argument the tool never declared is dropped rather than shown", async () => {
    answerInThread.mockImplementation(
      turnCalling("create_trip", { title: "Japan", teaser: "true" } as Record<string, string>),
    );
    const routed = await read(await ask("new trip"));
    const proposed = (routed.body.proposals as { arguments: Record<string, string> }[])[0]
      .arguments;
    expect(proposed).not.toHaveProperty("teaser");
    // The declared ones are all there — since B935 the arguments are the whole
    // of what a press sends, fields and defaults included.
    expect(proposed).toEqual({ title: "Japan", start: "", end: "", visibility: "guest" });
  });
});

describe("a read tool runs", () => {
  test("it answers on the spot, with nothing to press", async () => {
    answerInThread.mockImplementation(turnCalling("trips", {}, "You have no trips yet."));
    const routed = await read(await ask("show me my trips"));
    expect(routed.body.answer).toBe("You have no trips yet.");
    expect(routed.body.proposals).toEqual([]);
  });
});

describe("what it costs", () => {
  test("nothing: no credit moves and no ledger row is written", async () => {
    answerInThread.mockImplementation(turnCalling("account", {}, "Ten credits."));
    await ask("how much storage do I have");
    await ask("and again");
    expect(await balanceOf("alex")).toBe(10);
    const rows = await ledgerFor("alex");
    expect(rows.filter((row) => row.reason === "helper")).toHaveLength(0);
    expect(rows).toHaveLength(1); // the grant, and nothing since
  });

  test("proposing a write costs nothing either, however many times", async () => {
    answerInThread.mockImplementation(
      turnCalling("draft_words", { notes: "we walked to the harbour" }),
    );
    await ask("write up yesterday");
    await ask("no, the day before");
    await ask("actually leave it");
    expect(await balanceOf("alex")).toBe(10);
  });
});

describe("the door", () => {
  test("a bearer token is refused — this is a cookie route", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const refused = await read(await ask("how much storage", { authorization: "Bearer whatever" }));
    expect(refused.status).toBe(404);
    expect(answerInThread).not.toHaveBeenCalled();
  });

  test("with the capability off the route refuses rather than failing", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true }, credits: { enabled: true } },
      }),
    );
    clearConfigCache();
    clearUserCache();
    const refused = await read(await ask("how much storage"));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(answerInThread).not.toHaveBeenCalled();
  });

  test("the sentence is not sent before somebody has consented", async () => {
    const { revokeHelperConsent } = await import("@/lib/helper/consent");
    revokeHelperConsent("alex", "words");
    const refused = await read(await ask("how much storage"));
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(answerInThread).not.toHaveBeenCalled();
  });
});

/**
 * The chain — B900.
 *
 * `draft_words` asks the model for prose and writes nothing; keeping those
 * words is a second proposal with a second button. What matters is that the
 * second half is an ordinary proposal on the same screen rather than a quieter
 * way to write: same fields, same route, same press.
 */
describe("one accepted write handing on to the next", () => {
  /**
   * The day has to be **there** — B940.
   *
   * This used to run against a journal with no trips at all, and got a
   * proposal anyway: `resolveTrip` fell through to the newest trip, found
   * none, and the trip field took the model's own word for it. So the
   * assertion below was passing on a proposal to rewrite a day that did not
   * exist, in a trip that did not exist. The chain is what is under test, and
   * a chain needs something to be chained to.
   */
  beforeEach(() => {
    const entries = path.join(dir, "alex", "trips", "reise", "entries");
    fs.mkdirSync(entries, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "trip.md"),
      ["---", "id: reise", "title: Die Reise", 'start: "2026-05-01"', 'end: "2026-05-10"', "visibility: private", "---", "", "Intro."].join("\n"),
    );
    fs.writeFileSync(
      path.join(entries, "2026-05-01-one.md"),
      ["---", 'date: "2026-05-01"', "slug: one", "title: Der erste Tag", "status: draft", "---", "", "Worte."].join("\n"),
    );
    clearUserCache();
  });

  test("the next proposal is asked for by name, and writes nothing itself", async () => {
    const answered = await read(
      await proposalRoute(
        post("https://t.test/api/helper/alex/proposal", {
          tool: "set_day_words",
          arguments: { trip: "reise", slug: "one", title: "Der erste Tag", content: "Worte." },
        }),
        params,
      ),
    );
    expect(answered.status).toBe(200);
    const proposal = answered.body.proposal as Record<string, unknown>;
    expect(proposal.endpoint).toBe("/api/helper/alex/day");
    expect(proposal.method).toBe("PATCH");
    expect(proposal.fields).toContainEqual({ name: "content", value: "Worte.", long: true });
  });

  test("a read tool has nothing to propose, and is refused rather than run", async () => {
    const refused = await read(
      await proposalRoute(
        post("https://t.test/api/helper/alex/proposal", { tool: "trips", arguments: {} }),
        params,
      ),
    );
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("unknown_tool");
  });

  test("saying a write happened puts it in the conversation and nothing else", async () => {
    const told = await read(
      await proposalRoute(
        post("https://t.test/api/helper/alex/proposal", {
          tool: "create_trip",
          arguments: { title: "Japan" },
          wrote: true,
        }),
        params,
      ),
    );
    expect(told.status).toBe(200);
    // The one the fixture wrote, and no Japan: this route says a write
    // happened, it does not make one.
    expect(getTrips("alex").map((trip) => trip.id)).toEqual(["reise"]);
    expect(history("alex").map((turn) => turn.text).join("\n")).toContain("written: create_trip");
  });
});
