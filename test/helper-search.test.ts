import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B904 — the agent search, and the one property that makes it safe to show a
 * model a person's journal at all: **it answers with ids from the list it was
 * given, and the route resolves them against that same list.**
 *
 * The model is mocked. What is under test is not whether a model matches a
 * sentence well — nothing here can assert that — but what the route does with
 * an answer, including a bad one: an id nobody sent it, and an id belonging to
 * a row this reader may not see, both have to land nowhere.
 */
const said = vi.hoisted(() => ({ hits: [] as { id: string; why: string }[] }));
vi.mock("@/lib/helper/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/model")>();
  return { ...actual, findInJournal: async () => said.hits };
});

const owner = vi.hoisted(() => ({ yes: true }));
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => owner.yes };
});

vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: () => true };
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const params = { params: Promise.resolve({ user: "alex" }) };
let dir = "";

function ask(body: unknown): Request {
  return new Request("https://t.test/api/helper/alex/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  owner.yes = true;
  said.hits = [];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-search-"));
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" } }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "open-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "open-2026", "trip.md"),
    [
      "---",
      "id: open-2026",
      'title: "An Open Trip"',
      'start: "2026-08-24"',
      'end: "2026-08-26"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "An open trip.",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "open-2026", "entries", "2026-08-25-day.md"),
    [
      "---",
      'title: "A day"',
      'date: "2026-08-25"',
      'location: "Bellinzona"',
      'country: "Switzerland"',
      "status: published",
      "---",
      "",
      "Something happened.",
    ].join("\n"),
  );
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/helper/[user]/search", () => {
  test("resolves the model's ids against the catalogue it was sent", async () => {
    said.hits = [{ id: "open-2026/day", why: "the day in Bellinzona" }];
    const { POST } = await import("@/app/api/helper/[user]/search/route");
    const res = await POST(ask({ said: "the day we crossed into Ticino" }), params);
    const body = (await res.json()) as { hits: { url: string; title: string; why: string }[] };
    expect(res.status).toBe(200);
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0].url).toBe("/alex/day/day");
    expect(body.hits[0].title).toBe("A day");
    expect(body.hits[0].why).toBe("the day in Bellinzona");
  });

  test("an id nobody sent it is dropped, not resolved", async () => {
    said.hits = [
      { id: "open-2026/day", why: "real" },
      { id: "invented-2026/venice", why: "invented" },
    ];
    const { POST } = await import("@/app/api/helper/[user]/search/route");
    const res = await POST(ask({ said: "venice" }), params);
    const body = (await res.json()) as { hits: { id: string }[] };
    expect(body.hits.map((h) => h.id)).toEqual(["open-2026/day"]);
  });

  test("an empty question is refused before any model is asked", async () => {
    const { POST } = await import("@/app/api/helper/[user]/search/route");
    const res = await POST(ask({ said: "   " }), params);
    expect(res.status).toBe(400);
  });

  test("a caller who is not the owner is refused by the family's own answer", async () => {
    // `notYourJournal` is 404 for somebody else's journal and 401 for a
    // session that has lapsed — no cookie ever arrives here, so this is the
    // 401 branch. What matters is that neither is a 200: the route itself
    // never decides, it delegates to the one refusal the whole family shares.
    owner.yes = false;
    const { GET, POST } = await import("@/app/api/helper/[user]/search/route");
    expect((await POST(ask({ said: "anything" }), params)).status).toBe(401);
    expect((await GET(new Request("https://t.test/api/helper/alex/search"), params)).status).toBe(
      401,
    );
  });
});
