import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * B1609, phase 2 step 3, parcel D — the figure library.
 *
 * Fixture shape copied from `test/api-v2-auth.test.ts`: a throwaway
 * CONTENT_DIR and sqlite db per test, a real `write` bearer token minted
 * through the actual `/api/auth/codes` + `/codes/redeem` doors rather than a
 * hand-rolled session row, so these tests exercise the same auth path a real
 * caller would.
 */

const OWNER = "roams";
const CODE = "123456";

let dir: string;
let calls = 0;
/** A fresh address per test, not one reused across the file — `emailCodeAllowed`
 * (`lib/rateLimit.ts`) caps an address at ten code requests a day in a
 * process-lifetime, in-memory bucket that nothing in this suite resets, and
 * `beforeEach` gives every test its own throwaway content root but not its
 * own process. Reusing one address across a dozen tests silently burns
 * through that cap and turns every `ask()` past the tenth into a 202 that
 * mints no real code — which reads, from here, as an inexplicable 401 on
 * every call downstream. */
let OWNER_EMAIL: string;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.1.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { POST: ask } = await import("@/app/api/auth/codes/route");
  await ask(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, for: "write" }),
    }),
  );
  const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
  const response = await redeem(
    new Request("https://example.test/api/auth/codes/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, code: CODE, for: "write" }),
    }),
  );
  const body = (await response.json()) as { token: string };
  return body.token;
}

function req(url: string, init: RequestInit & { token?: string } = {}): Request {
  const { token, ...rest } = init;
  const h = new Headers(rest.headers);
  h.set("content-type", "application/json");
  if (token) h.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...rest, headers: h });
}

/**
 * The route context Next hands a handler. Overloaded rather than returning a
 * union: `RouteContext<"/api/v2/[user]/figures/[id]">` and its `[user]`-only
 * sibling are different types, and one function answering both with a union
 * satisfies neither at the call site.
 */
function ctx(id: string): { params: Promise<{ user: string; id: string }> };
function ctx(): { params: Promise<{ user: string }> };
function ctx(id?: string) {
  return { params: Promise.resolve(id === undefined ? { user: OWNER } : { user: OWNER, id }) };
}

beforeEach(async () => {
  OWNER_EMAIL = `owner-${process.hrtime.bigint()}@example.test`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-v2-figures-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "44".repeat(32);
  process.env.AUTH_DEV_CODE = CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Roams's journal",
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("create, read back, retried create", () => {
  test("PUT with a client-chosen id, then GET reads it back identically", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/figures/[id]/route");
    const { GET } = await import("@/app/api/v2/[user]/figures/[id]/route");

    const doc = { skin: "deep", hairStyle: "coils", name: "Anna" };
    const created = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify(doc),
      }),
      ctx("anna"),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({ id: "anna", skin: "deep", hairStyle: "coils", name: "Anna" });

    const read = await GET(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, { token }),
      ctx("anna"),
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(createdBody);
    expect(read.headers.get("ETag")).toBeTruthy();
  });

  test("a retried PUT of the same id with no If-Match answers 409 with the stored document", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/figures/[id]/route");

    const first = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );
    expect(first.status).toBe(201);
    const stored = await first.json();

    const retried = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "rich" }), // even a genuinely different body...
      }),
      ctx("anna"),
    );
    expect(retried.status).toBe(409);
    const body = await retried.json();
    expect(body.error).toBe("stale_document");
    expect(body.details.current).toEqual(stored); // ...gets refused, carrying what's actually there
  });

  test("PUT with a matching If-Match replaces the stored figure", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/figures/[id]/route");

    const first = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );
    const etag = first.headers.get("ETag")!;

    const replaced = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        headers: { "if-match": etag },
        body: JSON.stringify({ skin: "rich" }),
      }),
      ctx("anna"),
    );
    expect(replaced.status).toBe(200);
    expect((await replaced.json()).skin).toBe("rich");
  });

  test("a stale If-Match answers 409 with the current document", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/figures/[id]/route");

    await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );

    const stale = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        headers: { "if-match": '"0000000000000000000000000000000000000000000000000000000000000000"' },
        body: JSON.stringify({ skin: "rich" }),
      }),
      ctx("anna"),
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("stale_document");
  });
});

describe("dryRun", () => {
  test("a dry-run PUT writes nothing", async () => {
    const token = await ownerToken();
    const { PUT, GET } = await import("@/app/api/v2/[user]/figures/[id]/route");

    const dry = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna?dryRun=true`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );
    expect(dry.status).toBe(201);

    const read = await GET(req(`https://example.test/api/v2/${OWNER}/figures/anna`, { token }), ctx("anna"));
    expect(read.status).toBe(404);
  });

  test("an unreadable dryRun value is refused, not written", async () => {
    const token = await ownerToken();
    const { PUT, GET } = await import("@/app/api/v2/[user]/figures/[id]/route");

    const bad = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna?dryRun=maybe`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_request");

    const read = await GET(req(`https://example.test/api/v2/${OWNER}/figures/anna`, { token }), ctx("anna"));
    expect(read.status).toBe(404);
  });
});

describe("delete", () => {
  test("refused while referenced by the journal, allowed once nothing points at it", async () => {
    const token = await ownerToken();
    const { PUT, DELETE } = await import("@/app/api/v2/[user]/figures/[id]/route");

    await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );

    // The journal's own default set names this figure.
    const configPath = path.join(dir, OWNER, "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.figures = { mode: "set", figures: ["anna"] };
    fs.writeFileSync(configPath, JSON.stringify(config));

    const refused = await DELETE(req(`https://example.test/api/v2/${OWNER}/figures/anna`, { method: "DELETE", token }), ctx("anna"));
    expect(refused.status).toBe(409);
    const refusedBody = await refused.json();
    expect(refusedBody.error).toBe("figure_referenced");
    expect(refusedBody.details.journal).toBe(true);

    // Remove the reference, then the same delete succeeds.
    config.figures = { mode: "off" };
    fs.writeFileSync(configPath, JSON.stringify(config));

    const allowed = await DELETE(req(`https://example.test/api/v2/${OWNER}/figures/anna`, { method: "DELETE", token }), ctx("anna"));
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).deleted).toBe("anna");
  });

  test("refused while referenced by a trip", async () => {
    const token = await ownerToken();
    const { PUT, DELETE } = await import("@/app/api/v2/[user]/figures/[id]/route");

    await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/anna`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("anna"),
    );

    fs.mkdirSync(path.join(dir, OWNER, "trips", "alps-2026", "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "trips", "alps-2026", "trip.md"),
      [
        "---",
        'id: "alps-2026"',
        'title: "Alps"',
        'start: "2026-08-25"',
        'end: "2026-08-26"',
        'status: "past"',
        'visibility: "private"',
        "people:",
        '  - name: "Robin"',
        `    email: "${OWNER_EMAIL}"`,
        "figures:",
        '  mode: "custom"',
        "  figures:",
        '    - "anna"',
        "---",
        "",
        "Intro.",
        "",
      ].join("\n"),
    );

    const refused = await DELETE(req(`https://example.test/api/v2/${OWNER}/figures/anna`, { method: "DELETE", token }), ctx("anna"));
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.details.trips).toEqual(["alps-2026"]);
  });

  test("not found answers 404", async () => {
    const token = await ownerToken();
    const { DELETE } = await import("@/app/api/v2/[user]/figures/[id]/route");
    const response = await DELETE(
      req(`https://example.test/api/v2/${OWNER}/figures/nobody`, { method: "DELETE", token }),
      ctx("nobody"),
    );
    expect(response.status).toBe(404);
  });
});

describe("listing", () => {
  test("?limit=&cursor= pages a list longer than one page", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/figures/[id]/route");
    const { GET: list } = await import("@/app/api/v2/[user]/figures/route");

    for (const id of ["ana", "ben", "cleo"]) {
      await PUT(
        req(`https://example.test/api/v2/${OWNER}/figures/${id}`, {
          method: "PUT",
          token,
          body: JSON.stringify({ skin: "deep" }),
        }),
        ctx(id),
      );
    }

    const first = await list(
      req(`https://example.test/api/v2/${OWNER}/figures?limit=2`, { token }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.figures.map((f: { id: string }) => f.id)).toEqual(["ana", "ben"]);
    expect(firstBody.next_cursor).toBe("ben");

    const second = await list(
      req(`https://example.test/api/v2/${OWNER}/figures?limit=2&cursor=${firstBody.next_cursor}`, { token }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const secondBody = await second.json();
    expect(secondBody.figures.map((f: { id: string }) => f.id)).toEqual(["cleo"]);
    expect(secondBody.next_cursor).toBeUndefined();
  });
});

describe("the presets/preview route precedence", () => {
  test("a figure literally named \"presets\" does not shadow the vocabulary route, and vice versa", async () => {
    const token = await ownerToken();
    const { PUT } = await import("@/app/api/v2/[user]/figures/[id]/route");
    const { GET: idGet } = await import("@/app/api/v2/[user]/figures/[id]/route");
    const { GET: presetsGet } = await import("@/app/api/v2/[user]/figures/presets/route");

    await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/presets`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("presets"),
    );

    // Next's own file-system router resolves the static "figures/presets"
    // segment before the dynamic "figures/[id]" one — a request for
    // /figures/presets is dispatched to presetsGet and never reaches idGet
    // at all. That routing guarantee cannot be exercised without a running
    // server; what this proves instead is the half a unit test *can* prove:
    // the two handlers are functionally independent, so if the routing
    // guarantee ever changed, a figure named "presets" could not silently
    // start answering as the vocabulary or the reverse.
    const presetsResponse = await presetsGet(
      req(`https://example.test/api/v2/${OWNER}/figures/presets`, { token }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const presetsBody = await presetsResponse.json();
    expect(presetsBody.vocabulary).toBeDefined();
    expect(presetsBody.id).toBeUndefined();

    const idResponse = await idGet(
      req(`https://example.test/api/v2/${OWNER}/figures/presets`, { token }),
      ctx("presets"),
    );
    const idBody = await idResponse.json();
    expect(idBody.id).toBe("presets");
    expect(idBody.vocabulary).toBeUndefined();
  });
});

describe("figure id validation", () => {
  test("an id that is not ID_RE is refused rather than written to a path", async () => {
    const token = await ownerToken();
    const { PUT, GET } = await import("@/app/api/v2/[user]/figures/[id]/route");

    const bad = await PUT(
      req(`https://example.test/api/v2/${OWNER}/figures/Not_Valid!`, {
        method: "PUT",
        token,
        body: JSON.stringify({ skin: "deep" }),
      }),
      ctx("Not_Valid!"),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_request");

    expect(fs.existsSync(path.join(dir, OWNER, "figures"))).toBe(false);

    const read = await GET(
      req(`https://example.test/api/v2/${OWNER}/figures/Not_Valid!`, { token }),
      ctx("Not_Valid!"),
    );
    expect(read.status).toBe(400);
  });
});

describe("auth", () => {
  test("no bearer token is refused", async () => {
    const { GET } = await import("@/app/api/v2/[user]/figures/[id]/route");
    const response = await GET(req(`https://example.test/api/v2/${OWNER}/figures/anna`), ctx("anna"));
    expect(response.status).toBe(401);
  });
});
