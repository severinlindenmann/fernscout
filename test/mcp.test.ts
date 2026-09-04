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

/**
 * A trip.md that will not load, from the writing end (B83).
 *
 * The REST list has reported these since B83 landed; MCP was the one caller
 * still being told the folder simply was not there. That matters because MCP
 * is how an agent works when it is not making raw HTTP calls, and writing a
 * `trip.md` by hand — which `add-a-trip` does — succeeds against the
 * filesystem whatever is in the file. Without this, the write reports success
 * and every read afterwards is indistinguishable from never having tried.
 */
describe("list_trips reports a trip that will not load", () => {
  /** Replaces a trip's frontmatter with something the reader will refuse. */
  function wreck(username: string, tripId: string) {
    fs.writeFileSync(
      path.join(dir, username, "trips", tripId, "trip.md"),
      ["---", `id: ${tripId}`, 'start: "the first of April"', "---", "", "Body."].join("\n"),
    );
  }

  test("naming the folder and what is wrong with it", async () => {
    wreck("ana", "ana-secret");
    const result = await call(anaToken, "list_trips");

    const { trips, malformed } = result.structuredContent as {
      trips: { id: string }[];
      malformed: { folder: string; reason: string; problem: string }[];
    };
    // Gone from the list, as it has always been — and now accounted for.
    expect(trips.map((t) => t.id)).toEqual(["ana-trip"]);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]).toMatchObject({ folder: "ana-secret", reason: "missing-fields" });

    // And in the prose. A tool result is read far more often than it is parsed.
    expect(textOf(result)).toContain("ana-secret/trip.md");
    expect(textOf(result)).toContain("call list_trips again to confirm");
  });

  test("and says nothing at all when every trip reads", async () => {
    const result = await call(anaToken, "list_trips");
    expect(result.structuredContent).not.toHaveProperty("malformed");
    expect(textOf(result)).not.toContain("broken trip.md");
  });

  /**
   * A trip-scoped token is told about its own trip and nothing else in the
   * journal — the same rule `reachableTrips` and the REST route both follow. A
   * folder name is a fact about somebody's other journeys.
   */
  test("but tells a trip-scoped token nothing about the rest of the journal", async () => {
    wreck("ana", "ana-secret");
    const { tripWriteScope } = await import("@/lib/tripPeople");
    await issueCode("ana", "buddy@example.test", "agent");
    const verified = await verifyCode(
      "ana",
      "buddy@example.test",
      "123456",
      "agent",
      tripWriteScope("ana-trip"),
    );
    if (!verified.ok) throw new Error("could not mint a trip-scoped token");

    const listed = await call(verified.token, "list_trips");
    expect(listed.structuredContent).not.toHaveProperty("malformed");
    expect(textOf(listed)).not.toContain("ana-secret");
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
    // No invite tools: this instance has contacts off, and since B183 a tool
    // whose capability is off is absent rather than advertised and refused.
    // The case where they *are* listed has its own test below.
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_media",
      "create_day",
      "create_trip",
      "delete_day",
      "delete_journal",
      "delete_trip",
      "get_day",
      "list_drafts",
      "list_trips",
      "publish_day",
      "search_entries",
      "set_journal_features",
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

/**
 * Both doors write days, so both have to refuse a slug that is taken (B119).
 *
 * The unit case is `test/slug-collision.test.ts`; this is the pair of surfaces
 * an agent actually calls, and the status code REST answers with — 409 rather
 * than 400, because the request was well-formed and the trip's contents are
 * what make it impossible.
 */
describe("a slug already taken in the trip", () => {
  // Two titles that differ only by an invisible codepoint: U+0110 and U+00D0.
  // Both fold to `da-lat`, deliberately — B77 settled the transliteration.
  const FIRST = { trip: "ana-trip", title: "Đà Lạt", date: "2026-01-11", content: "Pines." };
  const SECOND = { trip: "ana-trip", title: "Ðà Lạt", date: "2026-01-12", content: "Cold." };

  test("MCP refuses the second day rather than writing a shadow", async () => {
    expect((await call(anaToken, "create_day", FIRST)).isError).toBe(false);

    const second = await call(anaToken, "create_day", SECOND);
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain('slug "da-lat"');
    expect(textOf(second)).toContain("2026-01-11-da-lat.md");

    // One file, not two. The second used to be written and then never served.
    const entries = fs
      .readdirSync(path.join(dir, "ana", "trips", "ana-trip", "entries"))
      .filter((f) => f.includes("da-lat"));
    expect(entries).toEqual(["2026-01-11-da-lat.md"]);
  });

  test("REST answers 409, not 201 with a slug that belongs to something else", async () => {
    const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
    const post = (body: Record<string, unknown>) =>
      POST(
        new Request(`${SITE}/api/v1/ana/trips/ana-trip/days`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anaToken}`,
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ user: "ana", trip: "ana-trip" }) },
      );

    const first = await post(FIRST);
    expect(first.status).toBe(201);
    expect((await first.json()).slug).toBe("da-lat");

    const second = await post(SECOND);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain('slug "da-lat"');
  });

  test("but a day whose title really is different still writes", async () => {
    await call(anaToken, "create_day", FIRST);
    const other = await call(anaToken, "create_day", { ...SECOND, title: "Nha Trang" });
    expect(other.isError).toBe(false);
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
   * B156. The reply used to end "a person publishes it by removing the
   * `status: draft` line from the file — there is no tool, argument or flag
   * here that does", which stopped being true the moment B28 added
   * `publish_day` two entries away in the same `tools/list` response.
   *
   * It is not a stale sentence, it is a false one, and it is the exact wall
   * B28 exists to remove: an agent driving a journal over MCP alone cannot
   * show anybody a file, so "edit the file" is advice with nowhere to go.
   */
  test("the reply names publish_day rather than telling the agent to edit a file", async () => {
    const result = await call(anaToken, "create_day", DAY);
    const text = textOf(result);

    expect(text).toContain("publish_day");
    expect(text).toMatch(/not on the site/i);
    // The retired rule, in any of the forms it was written in.
    expect(text).not.toMatch(/status: draft/);
    expect(text).not.toMatch(/from the file/i);
    expect(text).not.toMatch(/no tool[^.]*that does/i);
  });

  /**
   * The rule is stated in six places across this door — the server's own
   * instructions, two tool descriptions, a doc comment, the markdown a draft
   * renders as, and this reply. B28 updated four of them. This asserts on the
   * two an agent is actually handed, so the next divergence fails here rather
   * than reaching somebody's family.
   */
  test("nothing the server hands an agent claims publishing has no tool", async () => {
    const { body: init } = await rpc(anaToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0" },
    });
    const instructions = (init.result as { instructions: string }).instructions;

    const { body: listed } = await rpc(anaToken, "tools/list");
    const tools = (listed.result as { tools: unknown[] }).tools;

    const everythingSaid = [instructions, JSON.stringify(tools)].join("\n");

    expect(everythingSaid).not.toMatch(/no tool[^.]*(publish|does)/i);
    expect(everythingSaid).not.toMatch(/no second tool/i);
    expect(everythingSaid).not.toMatch(/removing the `?status: draft/i);
    // And the half that must still be said.
    expect(instructions).toMatch(/publish_day/);
    expect(instructions).toMatch(/DRAFT/);
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

  /**
   * B224. There was a confirmation handshake here until then: the first call
   * was refused with a code and the second carried it back. It never
   * established that a person had consented — the agent held both calls — so
   * once publishing stopped being reserved for a person it was a round trip
   * buying nothing, and a refusal shape on the success path that a strict
   * client reads as failure. The write still cannot publish; that is the part
   * that was ever structural.
   */
  test("publishing is a separate tool, and one call does it", async () => {
    await call(anaToken, "create_day", DAY);
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).not.toContain("lanterns-of-hoi-an");

    const result = await call(anaToken, "publish_day", {
      trip: "ana-trip",
      slug: "lanterns-of-hoi-an",
    });
    expect(result.isError).toBeFalsy();
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).toContain("lanterns-of-hoi-an");
  });

  test("and the tool no longer advertises a confirmation argument", async () => {
    const { body } = await rpc(anaToken, "tools/list");
    const tools = (body.result as { tools: { name: string }[] }).tools;
    const publish = tools.find((t) => t.name === "publish_day");
    expect(publish).toBeTruthy();
    expect(JSON.stringify(publish)).not.toMatch(/confirm/i);
  });

  /**
   * The one thing that must not happen to an agent still working from the
   * pre-B224 guide: it sends the `confirm` it thinks is required, and the day
   * goes up anyway with the argument quietly ignored. `additionalProperties:
   * false` on the tool means it is refused instead — the agent learns the
   * protocol changed rather than succeeding by accident and reporting a
   * handshake that never happened.
   */
  test("a leftover confirmation argument is refused, not ignored", async () => {
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
    const result = await call(anaToken, "create_day", { ...DAY, status: "published" });
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).not.toContain("lanterns-of-hoi-an");
    // B157: it used to be dropped in silence and the draft written anyway. The
    // guarantee never changed — no argument publishes — but the agent now
    // learns its argument was wrong instead of being told it succeeded.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/"status"/);
  });

  /**
   * B157. `AGENTS.md` offers exactly one way to write something that did not
   * happen, and calls the alternative out by name:
   *
   * > Writing "this is a test" into the prose instead is a convention, not a
   * > guarantee — the next reader has no way to know whether you bothered.
   *
   * The REST door took `test` on both a trip and a day. This one took it on
   * neither, so an MCP-only agent asked to invent a single day inside a real
   * trip had only the fallback that paragraph rejects.
   */
  test("one day can be marked as content nobody lived, inside a trip that is real", async () => {
    const result = await call(anaToken, "create_day", { ...DAY, test: true });
    expect(result.isError).toBe(false);

    const file = path.join(
      dir, "ana", "trips", "ana-trip", "entries", "2026-01-05-lanterns-of-hoi-an.md",
    );
    expect(fs.readFileSync(file, "utf8")).toContain("test: true");

    // The trip itself is untouched — the flag is the day's own, not inherited.
    expect(fs.readFileSync(path.join(dir, "ana", "trips", "ana-trip", "trip.md"), "utf8"))
      .not.toContain("test: true");
  });

  test("an ordinary day carries no test line at all", async () => {
    await call(anaToken, "create_day", DAY);
    const file = path.join(
      dir, "ana", "trips", "ana-trip", "entries", "2026-01-05-lanterns-of-hoi-an.md",
    );
    // `test: false` on every real day would be noise in every file.
    expect(fs.readFileSync(file, "utf8")).not.toContain("test:");
  });

  test("an unknown property is refused, not ignored", async () => {
    const result = await call(anaToken, "create_day", { ...DAY, tset: true });
    expect(result.isError).toBe(true);
    // It names what it did not understand, so a typo is a question rather than
    // a silent no-op.
    expect(textOf(result)).toMatch(/"tset"/);
    expect(textOf(result)).toMatch(/test/);

    expect(fs.existsSync(path.join(
      dir, "ana", "trips", "ana-trip", "entries", "2026-01-05-lanterns-of-hoi-an.md",
    ))).toBe(false);
  });

  /**
   * The two doors are "the same markdown files, not a second system", so the
   * same input has to produce the same file. This is the assertion that keeps
   * that true for the one field B157 found missing.
   */
  test("REST and MCP write identical frontmatter for the same test day", async () => {
    const entries = path.join(dir, "ana", "trips", "ana-trip", "entries");

    await call(anaToken, "create_day", { ...DAY, test: true });
    const viaMcp = fs.readFileSync(
      path.join(entries, "2026-01-05-lanterns-of-hoi-an.md"), "utf8",
    );
    fs.rmSync(path.join(entries, "2026-01-05-lanterns-of-hoi-an.md"));

    const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/days/route");
    const response = await POST(
      new Request(`${SITE}/api/v1/ana/trips/ana-trip/days`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anaToken}` },
        body: JSON.stringify({ ...DAY, test: true }),
      }),
      { params: Promise.resolve({ user: "ana", trip: "ana-trip" }) },
    );
    expect(response.status).toBe(201);
    const viaRest = fs.readFileSync(
      path.join(entries, "2026-01-05-lanterns-of-hoi-an.md"), "utf8",
    );

    expect(viaMcp).toBe(viaRest);
  });

  test("create_trip can mark a whole trip as content nobody lived", async () => {
    const result = await call(anaToken, "create_trip", {
      id: "pipeline-check",
      title: "Pipeline check",
      start: "2026-03-01",
      end: "2026-03-02",
      test: true,
    });
    expect(result.isError).toBe(false);
    expect(fs.readFileSync(path.join(dir, "ana", "trips", "pipeline-check", "trip.md"), "utf8"))
      .toContain("test: true");
  });

  /**
   * B178 — the two doors, on the field neither of them could write until now.
   * A trip whose money is guests-only had no way of being created, so
   * `maySeeCosts` had nothing to act on anywhere outside the unit suite.
   */
  test("create_trip and REST write identical frontmatter for guests-only costs", async () => {
    const body = {
      id: "quiet-money",
      title: "Quiet money",
      start: "2026-03-01",
      end: "2026-03-02",
      visibility: "public",
      costsVisibility: "guests",
    };
    const file = path.join(dir, "ana", "trips", "quiet-money", "trip.md");

    const result = await call(anaToken, "create_trip", body);
    expect(result.isError).toBe(false);
    const viaMcp = fs.readFileSync(file, "utf8");
    expect(viaMcp).toContain("costsVisibility: guests");
    fs.rmSync(path.join(dir, "ana", "trips", "quiet-money"), { recursive: true });

    const { POST } = await import("@/app/api/v1/[user]/trips/route");
    const response = await POST(
      new Request(`${SITE}/api/v1/ana/trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anaToken}` },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "ana" }) },
    );
    expect(response.status).toBe(201);
    expect(fs.readFileSync(file, "utf8")).toBe(viaMcp);
  });

  /**
   * B204 — the same call that bricked a trip id on the live instance, through
   * the other door. What matters is not only the refusal but that the folder
   * is gone: every delete path resolves the trip first, so a trip left behind
   * that does not read is a trip nothing in the product can remove.
   */
  test("a title that would break the frontmatter is refused and leaves no folder", async () => {
    const result = await call(anaToken, "create_trip", {
      id: "b204-broken",
      title: `Broken\n---\nnot: [yaml`,
      start: "2026-03-01",
      end: "2026-03-02",
    });
    expect(result.isError).toBe(true);
    expect(fs.existsSync(path.join(dir, "ana", "trips", "b204-broken"))).toBe(false);

    // And the id is still free.
    const again = await call(anaToken, "create_trip", {
      id: "b204-broken",
      title: "Second try",
      start: "2026-03-01",
      end: "2026-03-02",
    });
    expect(again.isError).toBe(false);
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

/**
 * B116 — a trip nobody took has to say so in the text, not only in the data.
 *
 * `list_trips` answers in two channels: `structuredContent` for a parser, and
 * a text block for everything else. The flag reached the first and not the
 * second, so an agent reading the summary — which is the channel the format
 * exists to be read through — saw a trip that looked lived. `get_day` had it
 * right; the two now share one sentence.
 */
describe("test content is stated in the readable text", () => {
  const NOTICE = "did not happen.** It exists to check the software.";

  beforeEach(() => {
    // The day carries no flag of its own: the operator marked the trip once,
    // which is the case that was silent.
    writeTrip("ana", "ana-proving", ["test: true"]);
    writeEntry("ana", "ana-proving", "2026-01-06", "proving-day", "Nobody was here.");
  });

  test("list_trips says it on the trip's own line, and not on a real trip's", async () => {
    const result = await call(anaToken, "list_trips");
    const lines = textOf(result).split("\n");
    const proving = lines.find((l) => l.startsWith("ana-proving"))!;
    const real = lines.find((l) => l.startsWith("ana-trip"))!;

    expect(proving).toContain(`**Test content — this trip ${NOTICE}`);
    expect(real).not.toContain("did not happen");
  });

  test("and still says it in the structured data", async () => {
    const result = await call(anaToken, "list_trips");
    const trips = (result.structuredContent as { trips: { id: string; test?: boolean }[] }).trips;
    expect(trips.find((t) => t.id === "ana-proving")?.test).toBe(true);
    expect(trips.find((t) => t.id === "ana-trip")).not.toHaveProperty("test");
  });

  test("get_day says it in the same words, for a day that inherits the flag", async () => {
    const result = await call(anaToken, "get_day", { trip: "ana-proving", slug: "proving-day" });
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain(`**Test content — this day ${NOTICE}`);
    // Inherited: `test: true` is on the trip, and nowhere in the entry file.
    expect(getAllEntries("ana/ana-proving")[0].test).toBeUndefined();
    expect((result.structuredContent as { test?: boolean }).test).toBe(true);
  });
});

/**
 * B134, B158 — the two surfaces that still described invented content as
 * though somebody had lived it, and the one that has now decided.
 *
 * `list_drafts` is read out to a person at the moment they choose what goes on
 * the site; the publish confirmation is the last sentence they hear before
 * saying yes, and it promised the feed and the search index to a day that is
 * kept out of both. `search_entries` was the last surface where the structured
 * answer and the public one disagreed without anybody having decided.
 */
describe("what a person is told about content nobody lived", () => {
  const NOTICE = "did not happen.** It exists to check the software.";

  beforeEach(() => {
    writeTrip("ana", "ana-proving", ["test: true"]);
    writeEntry("ana", "ana-proving", "2026-01-06", "proving-day", "Lanterns nobody saw.");
    // A draft inside it, carrying nothing of its own — the inherited case.
    fs.writeFileSync(
      path.join(dir, "ana", "trips", "ana-proving", "entries", "2026-01-07-proving-draft.md"),
      [
        "---",
        'title: "Proving draft"',
        'date: "2026-01-07"',
        'location: "Hoi An"',
        "status: draft",
        "---",
        "",
        "Not yet on the site, and never happened.",
        "",
      ].join("\n"),
    );
    // And an ordinary draft in the real trip, for the contrast.
    fs.writeFileSync(
      path.join(dir, "ana", "trips", "ana-trip", "entries", "2026-01-08-real-draft.md"),
      [
        "---",
        'title: "Real draft"',
        'date: "2026-01-08"',
        'location: "Hoi An"',
        "status: draft",
        "---",
        "",
        "A day that happened, waiting for a person.",
        "",
      ].join("\n"),
    );
  });

  test("list_drafts says which of them nobody lived, in the same words", async () => {
    const result = await call(anaToken, "list_drafts");
    const lines = textOf(result).split("\n");
    const proving = lines.find((l) => l.includes("proving-draft"))!;
    const real = lines.find((l) => l.includes("real-draft"))!;

    expect(proving).toContain(`**Test content — this day ${NOTICE}`);
    expect(real).not.toContain("did not happen");

    const drafts = (result.structuredContent as { drafts: { slug: string; test?: boolean }[] })
      .drafts;
    expect(drafts.find((d) => d.slug === "proving-draft")?.test).toBe(true);
    expect(drafts.find((d) => d.slug === "real-draft")).not.toHaveProperty("test");
  });

  /**
   * The sentence was the confirmation's question until B224 and is the
   * receipt now — a change of tense, not of duty. It is still what the agent
   * reads out to the person, so it must still describe the day in front of
   * them rather than days in general (B158).
   */
  test("the publish receipt describes the exclusions rather than promising the opposite", async () => {
    const done = await call(anaToken, "publish_day", {
      trip: "ana-proving",
      slug: "proving-draft",
    });
    expect(done.isError).toBeFalsy();
    const message = textOf(done);
    expect(message).toContain("kept out of the feed, the search index and the sitemap");
    expect(message).not.toContain("It is in the journal, the feed and the search index");
  });

  test("publishing an ordinary day still names the feed and the search index", async () => {
    const done = await call(anaToken, "publish_day", {
      trip: "ana-trip",
      slug: "real-draft",
    });
    expect(done.isError).toBeFalsy();
    expect(textOf(done)).toContain("It is in the journal, the feed and the search index");
  });

  test("and both doors read out the same sentence", async () => {
    // One function behind two calls (`publishNotice`). Two copies of the
    // sentence is how the REST one came to promise something the MCP one did
    // not, and this is the assertion that stops it happening again.
    const viaMcp = textOf(
      await call(anaToken, "publish_day", { trip: "ana-proving", slug: "proving-draft" }),
    );

    // The REST door publishes the *other* draft, because a day can only be
    // published once now that neither call is refused first.
    const { POST } = await import(
      "@/app/api/v1/[user]/trips/[trip]/days/[slug]/publish/route"
    );
    const response = await POST(
      new Request(`${SITE}/api/v1/ana/trips/ana-trip/days/real-draft/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anaToken}` },
        body: "{}",
      }),
      {
        params: Promise.resolve({ user: "ana", trip: "ana-trip", slug: "real-draft" }),
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { note: string };

    // Same wording, differing only in the day each is about: both end on the
    // clause `publishNotice` appends to every day alike.
    const tail = "not from the people who have already read it.";
    expect(viaMcp).toContain(tail);
    expect(body.note).toContain(tail);
    expect(body.note).toContain("It is in the journal, the feed and the search index");

    // And both actually published.
    expect(getAllEntries("ana/ana-proving").map((e) => e.slug)).toContain("proving-draft");
    expect(getAllEntries("ana/ana-trip").map((e) => e.slug)).toContain("real-draft");
  });

  test("search_entries finds a test day and says on its line that it is one", async () => {
    // The decision B158 asked for, made and now asserted: this is the agent's
    // own journal, so its test content is findable here — unlike the public
    // index — and every result that is fiction says so.
    const result = await call(anaToken, "search_entries", { query: "lanterns" });
    const lines = textOf(result).split("\n");
    const invented = lines.find((l) => l.includes("proving-day"))!;
    expect(invented).toContain(`**Test content — this day ${NOTICE}`);

    const hits = (result.structuredContent as { results: { slug: string; test?: boolean }[] })
      .results;
    expect(hits.find((h) => h.slug === "proving-day")?.test).toBe(true);
    expect(hits.find((h) => h.slug === "lanterns")).not.toHaveProperty("test");
  });
});

/**
 * B183 — a disabled capability is absent, not broken.
 *
 * The three invite tools were advertised to every journal, including one with
 * contacts switched off, where calling any of them is refused. Nothing leaked
 * and nothing broke; it was a list that had to be corrected by trying it, in a
 * codebase that is otherwise consistent about the opposite (AGENTS.md, and B74
 * for the same shape in the UI).
 */
describe("tools/list is filtered by what this journal can actually do", () => {
  const INVITE_TOOLS = ["create_invite", "list_invites", "revoke_invite"];

  async function toolNames(token: string): Promise<string[]> {
    const { body } = await rpc(token, "tools/list");
    return (body.result as { tools: { name: string }[] }).tools.map((t) => t.name);
  }

  /** Contacts on, both halves: the server can provide it, and ana asks for it. */
  function enableContacts() {
    process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "Fernscout", url: SITE, defaultUser: "ana" },
        users: { reserved: [] },
        features: { auth: { enabled: true }, contacts: { enabled: true } },
      }),
    );
    const userConfig = path.join(dir, "ana", "config.json");
    const raw = JSON.parse(fs.readFileSync(userConfig, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(
      userConfig,
      JSON.stringify({ ...raw, features: { contacts: { enabled: true } } }),
    );
    clearConfigCache();
    clearUserCache();
  }

  afterEach(() => {
    delete process.env.CONTACTS_ENCRYPTION_KEY;
  });

  test("a journal with contacts off is not offered the invite tools", async () => {
    const names = await toolNames(anaToken);
    for (const tool of INVITE_TOOLS) expect(names).not.toContain(tool);
  });

  test("the same journal with contacts on is", async () => {
    enableContacts();
    const names = await toolNames(anaToken);
    for (const tool of INVITE_TOOLS) expect(names).toContain(tool);
  });

  test("and calling one anyway is still refused, in the handler's own words", async () => {
    // The filter is honesty; the handler is the enforcement. A client may hold
    // a list it fetched before the capability changed.
    const result = await call(anaToken, "create_invite", { kind: "guest" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/contacts/i);
  });
});

/**
 * B175 (and B206, the same finding from the other side) — the two doors on
 * `listed`.
 *
 * `POST /api/v1/<user>/trips` has taken `listed` since W27 and `/openapi.json`
 * documents it; MCP's `create_trip` had no such property and, with
 * `additionalProperties: false`, refused one. So an agent working over MCP
 * could not create the setting AGENTS.md calls the old `unlisted` — public,
 * readable by anybody with the link, advertised nowhere — which is the honest
 * setting for a trip somebody will mail to their family. The workaround was to
 * create the trip and ask a person to edit `trip.md`, which is the advice B28
 * says has nowhere to go.
 */
describe("create_trip can ask for a trip that is readable but not advertised", () => {
  test("a public trip narrowed to unlisted reads back that way, and both doors write it identically", async () => {
    const body = {
      id: "for-the-family",
      title: "For the family",
      start: "2026-04-01",
      end: "2026-04-10",
      visibility: "public",
      listed: false,
    };
    const file = path.join(dir, "ana", "trips", "for-the-family", "trip.md");

    const result = await call(anaToken, "create_trip", body);
    expect(result.isError).toBe(false);
    const viaMcp = fs.readFileSync(file, "utf8");
    expect(viaMcp).toContain("listed: false");

    // The reply says so, in the text and in the data — an agent that asked for
    // this needs to see that it took.
    expect(textOf(result)).toContain("unlisted");
    expect(result.structuredContent).toMatchObject({ visibility: "public", listed: false });

    fs.rmSync(path.join(dir, "ana", "trips", "for-the-family"), { recursive: true });
    const { POST } = await import("@/app/api/v1/[user]/trips/route");
    const response = await POST(
      new Request(`${SITE}/api/v1/ana/trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anaToken}` },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "ana" }) },
    );
    expect(response.status).toBe(201);
    expect(fs.readFileSync(file, "utf8")).toBe(viaMcp);
  });

  test("listed: true on a private trip is refused in the words createTrip uses", async () => {
    const result = await call(anaToken, "create_trip", {
      id: "nowhere-trip",
      title: "Nowhere",
      start: "2026-04-01",
      end: "2026-04-10",
      visibility: "private",
      listed: true,
    });
    expect(result.isError).toBe(true);
    // The `invalid_listed` message, not a generic failure: it teaches the axis.
    expect(textOf(result)).toContain("Only a public trip is advertised");
    expect(fs.existsSync(path.join(dir, "ana", "trips", "nowhere-trip"))).toBe(false);
  });

  test("an ordinary public trip is still advertised, and its file says nothing about it", async () => {
    const result = await call(anaToken, "create_trip", {
      id: "open-trip",
      title: "Open",
      start: "2026-04-01",
      end: "2026-04-10",
      visibility: "public",
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ listed: true });
    // Written only when it narrows — an absent key reads as advertised.
    expect(fs.readFileSync(path.join(dir, "ana", "trips", "open-trip", "trip.md"), "utf8"))
      .not.toContain("listed:");
  });
});
