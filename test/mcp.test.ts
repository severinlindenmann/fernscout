import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode } from "@/lib/auth";
import { getAllEntries } from "@/lib/entries";
import { handleMcpPost, handleMcpUnsupportedMethod, protectedResourceMetadata } from "@/lib/mcp/http";
import { clearIdempotencyStore } from "@/lib/mcp/idempotency";

/**
 * The MCP endpoint, exercised the way a client does: JSON-RPC over POST,
 * through the same handler the route exports.
 *
 * The two properties worth a test suite of their own are the ones a mistake in
 * would be invisible: a token for one journal must not reach another, and
 * nothing an agent writes may appear on the site.
 */

let dir: string;
let anaToken: string;
let beaToken: string;

const SITE = "https://example.test";

function writeTrip(username: string, tripId: string, extra: string[] = []) {
  const tripPath = path.join(dir, username, "trips", tripId);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripPath, "trip.md"),
    [
      "---",
      `id: ${tripId}`,
      `title: "${tripId}"`,
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: current",
      ...extra,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

function writeEntry(username: string, tripId: string, date: string, slug: string, body: string) {
  fs.writeFileSync(
    path.join(dir, username, "trips", tripId, "entries", `${date}-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      'location: "Hoi An"',
      'country: "Vietnam"',
      "---",
      "",
      body,
      "",
    ].join("\n"),
  );
}

async function tokenFor(username: string, email: string): Promise<string> {
  await issueCode(username, email, "agent");
  const result = await verifyCode(username, email, "123456", "agent");
  if (!result.ok) throw new Error(`could not mint a token: ${result.reason}`);
  return result.token;
}

/** One JSON-RPC call, exactly as a client would make it. */
async function rpc(
  token: string | null,
  method: string,
  params?: unknown,
  init: { id?: number | string | null; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...init.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (init.id !== null) payload.id = init.id ?? 1;
  if (params !== undefined) payload.params = params;

  const response = await handleMcpPost(
    new Request(`${SITE}/api/mcp`, { method: "POST", headers, body: JSON.stringify(payload) }),
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : {},
    headers: response.headers,
  };
}

/** `tools/call`, unwrapped to the tool's own result. */
async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  return (body.result ?? body.error) as Record<string, unknown>;
}

function textOf(result: Record<string, unknown>): string {
  const content = result.content as { type: string; text: string }[] | undefined;
  return content?.map((c) => c.text).join("\n") ?? "";
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mcp-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "mcp.db")}`;
  process.env.SESSION_SECRET = "test-secret";
  process.env.AUTH_DEV_CODE = "123456";
  delete process.env.NEXT_PUBLIC_SITE_URL;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: SITE, defaultUser: "ana" },
      users: { reserved: [] },
      // Auth on: the MCP endpoint is absent without it, which is its own test.
      features: { auth: { enabled: true } },
    }),
  );

  for (const username of ["ana", "bea"]) {
    fs.mkdirSync(path.join(dir, username), { recursive: true });
    fs.writeFileSync(
      path.join(dir, username, "config.json"),
      JSON.stringify({
        title: `${username}'s journal`,
        tagline: "A tagline",
        owner: { name: "A B", nickname: "A" },
        startLocation: "X",
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        units: "metric",
        features: {},
      }),
    );
  }

  writeTrip("ana", "ana-trip");
  writeTrip("ana", "ana-secret", ["visibility: unlisted"]);
  writeTrip("bea", "bea-trip");
  writeEntry("ana", "ana-trip", "2026-01-02", "lanterns", "The old town hangs with lanterns.");
  writeEntry("ana", "ana-secret", "2026-01-03", "quiet-island", "A quiet island nobody was told about.");
  writeEntry("bea", "bea-trip", "2026-01-04", "bea-day", "Bea's own day, in Bea's own journal.");

  clearConfigCache();
  clearUserCache();
  clearIdempotencyStore();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  anaToken = await tokenFor("ana", "ana@example.test");
  beaToken = await tokenFor("bea", "bea@example.test");
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.AUTH_DEV_CODE;
  clearConfigCache();
  clearUserCache();
  clearIdempotencyStore();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("authorisation", () => {
  test("an unauthenticated call is refused, and says how to authenticate", async () => {
    const { status, body, headers } = await rpc(null, "tools/list");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_request");
    // RFC 9728 §5.1: the challenge names where the resource describes itself.
    expect(headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${SITE}/.well-known/oauth-protected-resource"`,
    );
  });

  test("a made-up token is refused", async () => {
    const { status, body } = await rpc("fs_agent_not-a-real-token", "tools/list");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  test("a guest session presented as a bearer token is refused", async () => {
    await issueCode("ana", "ana@example.test", "guest");
    const guest = await verifyCode("ana", "ana@example.test", "123456", "guest");
    if (!guest.ok) throw new Error("expected a guest session");

    // It is a live, valid session — just not one of the class that may write.
    const { status, body } = await rpc(guest.token, "tools/list");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  /**
   * The MCP half of B98. `resolveTrip` used to ask `scopeAllows` — the scope
   * string minted with the token — and nothing else, so a person taken off a
   * trip kept writing to it through this door for the rest of the week.
   */
  test("a trip-scoped token stops working once the person is off the trip", async () => {
    // Somebody named in people:, holding a token scoped to that trip alone.
    writeTrip("ana", "shared-trip", ["people:", '  - name: "Robin"', '    email: "robin@example.test"']);
    clearConfigCache();

    await issueCode("ana", "robin@example.test", "agent");
    const minted = await verifyCode(
      "ana",
      "robin@example.test",
      "123456",
      "agent",
      "write:trip:shared-trip",
    );
    if (!minted.ok) throw new Error("expected a trip-scoped token");

    const before = await call(minted.token, "list_trips");
    expect(textOf(before)).toContain("shared-trip");

    // The owner deletes the people: block.
    writeTrip("ana", "shared-trip");
    clearConfigCache();

    const after = await call(minted.token, "get_day", { trip: "shared-trip", slug: "anything" });
    expect(textOf(after)).toContain("access_revoked");
    // And the trip stops being listed at all, rather than being listed and
    // then refused.
    expect(textOf(await call(minted.token, "list_trips"))).not.toContain("shared-trip");
  });

  test("guessing tokens is bounded, and a good token is not", async () => {
    // Its own address, so this test cannot spend another test's budget.
    const from = { "X-Forwarded-For": "203.0.113.7" };
    let refusals = 0;
    for (let i = 0; i < 40; i++) {
      const { status } = await rpc(`fs_agent_guess-${i}`, "ping", undefined, { headers: from });
      if (status === 429) refusals++;
    }
    expect(refusals).toBeGreaterThan(0);

    // The limiter counts failures only: a valid token still works from the
    // same address, which is the whole point of putting it after the lookup.
    const { status } = await rpc(anaToken, "ping", undefined, { headers: from });
    expect(status).toBe(200);
  });

  test("with auth switched off the endpoint is absent, not permanently 401", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "Fernscout", url: SITE, defaultUser: "ana" },
        users: { reserved: [] },
        features: {},
      }),
    );
    clearConfigCache();

    const { status, body } = await rpc(anaToken, "tools/list");
    expect(status).toBe(404);
    expect(body.error).toBe("auth_disabled");
  });

  test("a cross-origin browser request is refused", async () => {
    const { status } = await rpc(anaToken, "tools/list", undefined, {
      headers: { Origin: "https://not-this-site.example" },
    });
    expect(status).toBe(403);
  });

  test("the site's own origin is fine", async () => {
    const { status } = await rpc(anaToken, "tools/list", undefined, {
      headers: { Origin: SITE },
    });
    expect(status).toBe(200);
  });
});

describe("one token cannot reach another journal", () => {
  test("list_trips returns only the token holder's trips", async () => {
    const ana = await call(anaToken, "list_trips");
    const anaTrips = (ana.structuredContent as { trips: { id: string }[] }).trips.map((t) => t.id);
    expect(anaTrips.sort()).toEqual(["ana-secret", "ana-trip"]);

    const bea = await call(beaToken, "list_trips");
    const beaTrips = (bea.structuredContent as { trips: { id: string }[] }).trips.map((t) => t.id);
    expect(beaTrips).toEqual(["bea-trip"]);
  });

  test("a trip argument naming another journal is refused by name", async () => {
    const result = await call(beaToken, "get_day", { trip: "ana/ana-trip", slug: "lanterns" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/scoped to the journal "bea"/);
  });

  test("a traversal attempt reaches nothing", async () => {
    for (const trip of ["../ana/ana-trip", "..%2Fana%2Fana-trip", "../../ana/ana-trip"]) {
      const result = await call(beaToken, "get_day", { trip, slug: "lanterns" });
      expect(result.isError, `trip=${trip}`).toBe(true);
      expect(textOf(result)).not.toContain("lanterns hang");
    }
  });

  test("search never crosses the boundary", async () => {
    const mine = await call(anaToken, "search_entries", { query: "lanterns" });
    expect((mine.structuredContent as { count: number }).count).toBe(1);

    const theirs = await call(beaToken, "search_entries", { query: "lanterns" });
    expect((theirs.structuredContent as { count: number }).count).toBe(0);
  });

  test("a write with the wrong token lands nowhere", async () => {
    const result = await call(beaToken, "create_day", {
      trip: "ana-trip",
      title: "Not mine to write",
      date: "2026-01-09",
      content: "This must not exist.",
    });
    expect(result.isError).toBe(true);
    expect(
      fs.readdirSync(path.join(dir, "ana", "trips", "ana-trip", "entries")),
    ).toEqual(["2026-01-02-lanterns.md"]);
  });
});

describe("the protocol", () => {
  test("initialize negotiates a version and states the draft rule up front", async () => {
    const { status, body } = await rpc(anaToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0" },
    });
    expect(status).toBe(200);

    const result = body.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect((result.capabilities as { tools: unknown }).tools).toBeDefined();
    expect((result.serverInfo as { name: string }).name).toBe("fernscout");
    expect(result.instructions).toMatch(/DRAFT/);
  });

  test("an unknown requested version is answered with one this server speaks", async () => {
    const { body } = await rpc(anaToken, "initialize", { protocolVersion: "1999-01-01" });
    expect((body.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
  });

  test("an unsupported MCP-Protocol-Version header is a 400", async () => {
    const { status } = await rpc(anaToken, "tools/list", undefined, {
      headers: { "MCP-Protocol-Version": "1999-01-01" },
    });
    expect(status).toBe(400);
  });

  test("tools/list names every tool an agent may call, with a schema", async () => {
    const { body } = await rpc(anaToken, "tools/list");
    const tools = (body.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_media",
      "create_day",
      "create_invite",
      "create_trip",
      "delete_day",
      "delete_journal",
      "delete_trip",
      "get_day",
      "list_drafts",
      "list_invites",
      "list_trips",
      "publish_day",
      "revoke_invite",
      "search_entries",
    ]);
    // Not `create_journal`. This token belongs to a journal, and a journal's
    // token must not be able to mint more journals beside it — offering the
    // tool and then refusing the call would be a worse way to say so.
    expect(tools.map((t) => t.name)).not.toContain("create_journal");
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.name).toMatch(/^[a-z_]+$/);
    }
  });

  test("ping answers", async () => {
    const { body } = await rpc(anaToken, "ping");
    expect(body.result).toEqual({});
  });

  test("a notification gets a 202 and no body", async () => {
    const { status, body } = await rpc(anaToken, "notifications/initialized", undefined, {
      id: null,
    });
    expect(status).toBe(202);
    expect(body).toEqual({});
  });

  test("an unknown method is -32601", async () => {
    const { body } = await rpc(anaToken, "resources/list");
    expect((body.error as { code: number }).code).toBe(-32601);
  });

  test("an unknown tool is -32602, not a missing method", async () => {
    const { body } = await rpc(anaToken, "tools/call", { name: "publish_everything" });
    expect((body.error as { code: number }).code).toBe(-32602);
  });

  test("batching is refused by name — it was removed in 2025-06-18", async () => {
    const response = await handleMcpPost(
      new Request(`${SITE}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anaToken}` },
        body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.message).toMatch(/batching/i);
  });

  test("a body that is not JSON is a parse error", async () => {
    const response = await handleMcpPost(
      new Request(`${SITE}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anaToken}` },
        body: "{not json",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
  });

  test("GET is 405 — no server-initiated stream is offered", () => {
    const response = handleMcpUnsupportedMethod();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});

describe("the read tools", () => {
  test("get_day returns the markdown that made the page", async () => {
    const result = await call(anaToken, "get_day", { trip: "ana-trip", slug: "lanterns" });
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("The old town hangs with lanterns.");
    expect((result.structuredContent as { slug: string }).slug).toBe("lanterns");
  });

  test("get_day on a day that is not there says so, as a tool error", async () => {
    const result = await call(anaToken, "get_day", { trip: "ana-trip", slug: "nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/unknown_day/);
  });

  test("search reaches the holder's own unlisted trip", async () => {
    // Wider than /<user>/search-index.json on purpose: the caller owns it.
    const result = await call(anaToken, "search_entries", { query: "island" });
    const hits = (result.structuredContent as { results: { trip: string }[] }).results;
    expect(hits.map((h) => h.trip)).toContain("ana-secret");
  });

  test("search is bounded", async () => {
    const result = await call(anaToken, "search_entries", { query: "a", limit: 1 });
    expect((result.structuredContent as { results: unknown[] }).results.length).toBeLessThanOrEqual(1);
  });
});

describe("create_day writes a draft, and only a draft", () => {
  const DAY = {
    trip: "ana-trip",
    title: "Lanterns of Hoi An",
    date: "2026-01-05",
    time: "16:45",
    location: "Hoi An",
    country: "Vietnam",
    lat: 15.8801,
    lng: 108.338,
    content: "The whole old town hangs with lanterns.",
    tags: ["vietnam"],
  };

  test("the file exists and carries status: draft", async () => {
    const result = await call(anaToken, "create_day", DAY);
    expect(result.isError).toBe(false);

    const file = path.join(
      dir, "ana", "trips", "ana-trip", "entries", "2026-01-05-lanterns-of-hoi-an.md",
    );
    expect(fs.readFileSync(file, "utf8")).toContain("status: draft");
  });

  test("and does not appear on the site", async () => {
    const before = getAllEntries("ana/ana-trip").length;
    await call(anaToken, "create_day", DAY);
    expect(getAllEntries("ana/ana-trip")).toHaveLength(before);
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).not.toContain("lanterns-of-hoi-an");
  });

  test("but is listed as waiting for a person", async () => {
    await call(anaToken, "create_day", DAY);
    const drafts = await call(anaToken, "list_drafts");
    const listed = (drafts.structuredContent as { drafts: { slug: string }[] }).drafts;
    expect(listed.map((d) => d.slug)).toContain("lanterns-of-hoi-an");
  });

  /**
   * This used to assert that no tool published at all. B28 gave publishing an
   * endpoint, because the person the rule reserves it for often has no text
   * editor and no folder — so the guarantee is no longer "it cannot be done"
   * but "it cannot be done *here*". That is a real narrowing and it is the
   * thing worth pinning: the tool that writes must never be the tool that
   * publishes, whatever arguments it is handed.
   */
  test("the tool that writes cannot publish, whatever it is given", async () => {
    const { body } = await rpc(anaToken, "tools/list");
    const tools = (body.result as { tools: { name: string; description: string }[] }).tools;
    const create = tools.find((t) => t.name === "create_day");
    expect(JSON.stringify(create)).not.toMatch(/"publish"|"status"/);
  });

  test("publishing is a separate tool, and it refuses the first time", async () => {
    await call(anaToken, "create_day", DAY);
    const first = await call(anaToken, "publish_day", {
      trip: "ana-trip",
      slug: "lanterns-of-hoi-an",
    });
    // Refused, with the code and the question — not published.
    expect(first.isError).toBe(true);
    expect(JSON.stringify(first)).toMatch(/confirm/);
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).not.toContain("lanterns-of-hoi-an");
  });

  test("and goes through on the second, with the code", async () => {
    await call(anaToken, "create_day", DAY);
    const first = await call(anaToken, "publish_day", {
      trip: "ana-trip",
      slug: "lanterns-of-hoi-an",
    });
    const code = /cf_[A-Za-z0-9_-]+/.exec(JSON.stringify(first))?.[0];
    expect(code).toBeTruthy();

    const second = await call(anaToken, "publish_day", {
      trip: "ana-trip",
      slug: "lanterns-of-hoi-an",
      confirm: code,
    });
    expect(second.isError).toBeFalsy();
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).toContain("lanterns-of-hoi-an");
  });

  test("an invented confirmation does not publish anything", async () => {
    await call(anaToken, "create_day", DAY);
    const result = await call(anaToken, "publish_day", {
      trip: "ana-trip",
      slug: "lanterns-of-hoi-an",
      confirm: "cf_zzzz_imadethisup",
    });
    expect(result.isError).toBe(true);
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).not.toContain("lanterns-of-hoi-an");
  });

  test("a `status` argument is not a way in", async () => {
    await call(anaToken, "create_day", { ...DAY, status: "published" });
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).not.toContain("lanterns-of-hoi-an");
  });

  test("a missing required field is a tool error, not a written file", async () => {
    const result = await call(anaToken, "create_day", { trip: "ana-trip", title: "No date" });
    expect(result.isError).toBe(true);
    expect(
      fs.readdirSync(path.join(dir, "ana", "trips", "ana-trip", "entries")),
    ).toEqual(["2026-01-02-lanterns.md"]);
  });

  test("writing the same day twice is a conflict, not an overwrite", async () => {
    await call(anaToken, "create_day", DAY);
    const again = await call(anaToken, "create_day", { ...DAY, content: "different words" });
    expect(again.isError).toBe(true);

    const file = path.join(
      dir, "ana", "trips", "ana-trip", "entries", "2026-01-05-lanterns-of-hoi-an.md",
    );
    expect(fs.readFileSync(file, "utf8")).toContain("The whole old town hangs with lanterns.");
  });

  test("an idempotency_key turns a retry into a replay rather than a conflict", async () => {
    const first = await call(anaToken, "create_day", { ...DAY, idempotency_key: "abc-123" });
    expect(first.isError).toBe(false);
    expect((first.structuredContent as { replayed: boolean }).replayed).toBe(false);

    const retry = await call(anaToken, "create_day", { ...DAY, idempotency_key: "abc-123" });
    expect(retry.isError).toBe(false);
    expect((retry.structuredContent as { replayed: boolean }).replayed).toBe(true);
    expect(textOf(retry)).toMatch(/Replayed/);

    // And exactly one file was written.
    expect(fs.readdirSync(path.join(dir, "ana", "trips", "ana-trip", "entries"))).toHaveLength(2);
  });

  /**
   * The key names one write, not one agent.
   *
   * It was namespaced by journal and tool but not by what was being written,
   * so an agent that treated `idempotency_key` as a session identifier — a
   * reasonable reading of the name — had its second, different day answered
   * with the first day's result and a cheerful "nothing was written again".
   * The words it had just composed were dropped and it was told it had
   * succeeded, which is the one outcome nobody can detect.
   */
  test("the same key with a different day is refused, not replayed", async () => {
    const first = await call(anaToken, "create_day", { ...DAY, idempotency_key: "same-key" });
    expect(first.isError).toBe(false);

    const second = await call(anaToken, "create_day", {
      ...DAY,
      title: "A different day entirely",
      content: "Different words, which must not be quietly thrown away.",
      idempotency_key: "same-key",
    });
    expect(second.isError).toBe(true);
    expect(textOf(second)).toMatch(/already used for a different day/);

    // Neither replayed nor written: the day count is unchanged.
    expect(fs.readdirSync(path.join(dir, "ana", "trips", "ana-trip", "entries"))).toHaveLength(2);
  });

  test("argument order is not part of the call's identity", async () => {
    await call(anaToken, "create_day", { ...DAY, idempotency_key: "ordering" });
    // The same arguments, listed the other way round.
    const reordered = Object.fromEntries(
      Object.entries({ ...DAY, idempotency_key: "ordering" }).reverse(),
    );
    const retry = await call(anaToken, "create_day", reordered);
    expect(retry.isError).toBe(false);
    expect((retry.structuredContent as { replayed: boolean }).replayed).toBe(true);
  });

  test("one journal's idempotency key is not another's", async () => {
    await call(anaToken, "create_day", { ...DAY, idempotency_key: "shared" });
    const bea = await call(beaToken, "create_day", {
      ...DAY,
      trip: "bea-trip",
      idempotency_key: "shared",
    });
    expect((bea.structuredContent as { replayed: boolean }).replayed).toBe(false);
    expect((bea.structuredContent as { trip: string }).trip).toBe("bea/bea-trip");
  });
});

describe("the protected-resource document", () => {
  test("names this endpoint as the resource", () => {
    const meta = protectedResourceMetadata();
    expect(meta.resource).toBe(`${SITE}/api/mcp`);
    expect(meta.bearer_methods_supported).toEqual(["header"]);
    expect(meta.scopes_supported).toEqual(["write:content"]);
  });

  /** The honest part. There is no authorization server, so none is claimed. */
  test("claims no authorization server, because there is not one", () => {
    expect(protectedResourceMetadata()).not.toHaveProperty("authorization_servers");
  });

  test("points at the guide a person can actually read", () => {
    expect(protectedResourceMetadata().resource_documentation).toBe(`${SITE}/agent.md`);
  });
});

/**
 * Reading back what you just wrote.
 *
 * There was no way to. `list_drafts` gives slugs, titles and dates;
 * `get_day` refused anything unpublished; the markdown twin is gated like the
 * public page. So an agent asked to check its work before telling a person it
 * is ready had nowhere to look — and both the owner and the companion asked
 * for this in testing.
 *
 * Withholding it protected nobody: this session already holds a token that may
 * write to the trip.
 */
describe("reading a draft back", () => {
  const DAY = {
    trip: "ana-trip",
    title: "Lanterns of Hoi An",
    date: "2026-01-05",
    location: "Hoi An",
    country: "Vietnam",
    content: "Words enough to be a day.",
  };

  test("get_day returns the draft an agent has just written", async () => {
    const created = await call(anaToken, "create_day", {
      ...DAY,
      title: "Something to check",
      content: "The words as written, which must come back exactly.",
    });
    expect(created.isError).toBe(false);
    const { slug } = created.structuredContent as { slug: string };

    const read = await call(anaToken, "get_day", { trip: "ana-trip", slug });
    expect(read.isError).toBe(false);
    expect(textOf(read)).toContain("The words as written, which must come back exactly.");
  });

  test("and says, in the text, that it is not on the site", async () => {
    const created = await call(anaToken, "create_day", { ...DAY, title: "Unpublished" });
    const { slug } = created.structuredContent as { slug: string };

    const read = await call(anaToken, "get_day", { trip: "ana-trip", slug });
    expect(textOf(read)).toMatch(/Draft — not on the site/);
    expect((read.structuredContent as { status: string }).status).toBe("draft");
  });

  test("a published day still reads as published", async () => {
    const read = await call(anaToken, "get_day", { trip: "ana-trip", slug: "lanterns" });
    expect(read.isError).toBe(false);
    expect((read.structuredContent as { status: string }).status).toBe("published");
    expect(textOf(read)).not.toMatch(/Draft/);
  });

  /** A token for one journal must not read another's drafts. */
  test("but not another journal's", async () => {
    const created = await call(anaToken, "create_day", { ...DAY, title: "Ana's own" });
    const { slug } = created.structuredContent as { slug: string };
    const read = await call(beaToken, "get_day", { trip: "ana-trip", slug });
    expect(read.isError).toBe(true);
  });
});
