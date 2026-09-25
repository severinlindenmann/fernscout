import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * `write:gps` — B2204. A phone that only uploads positions must hold a
 * credential that can do exactly that, and nothing else this journal offers.
 *
 * Two halves, the same shape `test/owner-gate.test.ts` and
 * `test/handover.test.ts` each use for their own credential: **behaviour**,
 * for the one door this scope means to open and the handful of doors worth
 * naming individually — and a **derived scan**, because "every other route
 * refuses it" is a claim about the whole of `app/api/v2`, not about the
 * three or four routes any one person thought to try. The scan walks the
 * filesystem rather than a list typed by hand, so it still means something
 * once B1843 and B2203 land their own gps routes.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "algarve-2026";

let dir: string;
let cookie: string | undefined;

// Only `POST /api/auth/{user}/gps-token` (owner cookie only) reads the
// cookie jar through `next/headers` — every other call under test
// authenticates with a bearer token instead.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined) }),
}));

let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.11.0.${calls % 250}`, ...extra };
}

function fixesJsonl(count = 10, day = "2026-06-22"): string {
  const start = Date.parse(`${day}T09:00:00Z`) / 1000;
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify([start + i * 60, Number((37.1 + i * 0.004).toFixed(5)), -8.5]),
  ).join("\n");
}

async function ownerAgentToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function ownerGuestCookie(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no owner cookie");
  return result.token;
}

async function mintGpsToken(
  auth?: string,
  origin?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/auth/[user]/gps-token/route");
  const response = await POST(
    new Request(`https://example.test/api/auth/${OWNER}/gps-token`, {
      method: "POST",
      headers: headers({
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(origin ? { origin } : {}),
      }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function importGps(
  token: string,
  options: { kind?: string; dryRun?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/v2/[user]/import/route");
  const dryRun = options.dryRun ?? false;
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/import${dryRun ? "?dryRun=true" : ""}`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify({ kind: options.kind ?? "gps", text: fixesJsonl() }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function call(
  importPath: string,
  token: string,
  init: RequestInit,
  params: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const mod = (await import(importPath)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
  const verb = (init.method ?? "GET").toUpperCase();
  const handler = mod[verb];
  const response = await handler(
    new Request(`https://example.test${params.__url ?? "/x"}`, {
      ...init,
      headers: { ...headers({ authorization: `Bearer ${token}` }), ...(init.headers as Record<string, string> | undefined) },
    }),
    { params: Promise.resolve(params) },
  );
  return { status: response.status, body: await response.json().catch(() => null) };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-scope-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "The Algarve",
    start: "2026-06-22",
    end: "2026-06-24",
    status: "past",
    visibility: "private",
    intro: "Intro.",
  });
  // A draft day, for the story.json/draftsVisibleTo checks below.
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "first",
    date: "2026-06-22",
    content: "Unfinished notes nobody but the owner should see yet.",
    status: "draft",
  });

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("minting", () => {
  test("owner cookie mints a 30-day write:gps token", async () => {
    cookie = await ownerGuestCookie();
    const { status, body } = await mintGpsToken();
    cookie = undefined;
    expect(status).toBe(200);
    expect(body.scope).toBe("write:gps");
    expect(body.days).toBe(30);
    expect(typeof body.token).toBe("string");
  });

  test("the owner's own journal-wide bearer token cannot mint one — cookie only", async () => {
    const { status, body } = await mintGpsToken(await ownerAgentToken());
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  test("no credential at all is refused the same way", async () => {
    const { status } = await mintGpsToken();
    expect(status).toBe(403);
  });

  test("minting a second time revokes the first", async () => {
    cookie = await ownerGuestCookie();
    const first = await mintGpsToken();
    const second = await mintGpsToken();
    cookie = undefined;
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.token).not.toBe(second.body.token);

    const oldStillWorks = await importGps(first.body.token as string);
    expect(oldStillWorks.status).toBe(401);

    const newWorks = await importGps(second.body.token as string);
    expect(newWorks.status).toBe(200);
  });
});

describe("the one door it opens", () => {
  test("imports gps, and the response is counts only — no extent", async () => {
    cookie = await ownerGuestCookie();
    const { body: minted } = await mintGpsToken();
    cookie = undefined;
    const token = minted.token as string;

    const { status, body } = await importGps(token);
    expect(status).toBe(200);
    expect(body.kind).toBe("gps");
    expect(body.dryRun).toBe(false);
    expect(typeof body.read).toBe("number");
    expect(body).not.toHaveProperty("extent");
    // Nor how many positions the owner already held for that month.
    const stored = body.stored as Record<string, unknown> | undefined;
    expect(stored && Object.keys(stored).sort()).toEqual(["months", "read"]);
  });

  test("refused for kind: contacts", async () => {
    cookie = await ownerGuestCookie();
    const { body: minted } = await mintGpsToken();
    cookie = undefined;
    const { status, body } = await importGps(minted.token as string, { kind: "contacts" });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  test("refused for dryRun", async () => {
    cookie = await ownerGuestCookie();
    const { body: minted } = await mintGpsToken();
    cookie = undefined;
    const { status, body } = await importGps(minted.token as string, { dryRun: true });
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });

  test("refused for GET /import (the formats listing)", async () => {
    cookie = await ownerGuestCookie();
    const { body: minted } = await mintGpsToken();
    cookie = undefined;
    const { GET } = await import("@/app/api/v2/[user]/import/route");
    const response = await GET(
      new Request(`https://example.test/api/v2/${OWNER}/import`, {
        headers: headers({ authorization: `Bearer ${minted.token as string}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(403);
  });
});

async function gpsToken(): Promise<string> {
  cookie = await ownerGuestCookie();
  const { body: minted } = await mintGpsToken();
  cookie = undefined;
  return minted.token as string;
}

describe("everywhere else, named", () => {
  const token = gpsToken;

  test("GET /status refuses it rather than mislabel it 'owner'", async () => {
    const { status, body } = await call(
      "@/app/api/v2/[user]/status/route",
      await token(),
      { method: "GET" },
      { user: OWNER, __url: `/api/v2/${OWNER}/status` },
    );
    expect(status).toBe(403);
    expect((body as { error?: string }).error).toBe("forbidden");
  });

  test("POST .../track is refused", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/trips/[trip]/track/route",
      await token(),
      { method: "POST" },
      { user: OWNER, trip: TRIP, __url: `/api/v2/${OWNER}/trips/${TRIP}/track` },
    );
    expect(status).toBe(403);
  });

  test("GET the journal document is refused", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/route",
      await token(),
      { method: "GET" },
      { user: OWNER, __url: `/api/v2/${OWNER}` },
    );
    expect(status).toBe(403);
  });

  test("DELETE the journal is refused", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/route",
      await token(),
      { method: "DELETE" },
      { user: OWNER, __url: `/api/v2/${OWNER}` },
    );
    expect(status).toBe(403);
  });

  // Was "200 with an empty list" until the second merge review moved the
  // refusal into `authenticate` itself: now nothing but the import door
  // answers this token at all.
  test("GET the trips list is refused", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/trips/route",
      await token(),
      { method: "GET" },
      { user: OWNER, __url: `/api/v2/${OWNER}/trips` },
    );
    expect(status).toBe(403);
  });

  test("GET /storage is refused — its breakdown names every trip, private ones too", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/storage/route",
      await token(),
      { method: "GET" },
      { user: OWNER, __url: `/api/v2/${OWNER}/storage` },
    );
    expect(status).toBe(403);
  });

  test("POST .../publish is refused", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route",
      await token(),
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      { user: OWNER, trip: TRIP, slug: "2026-06-22-whatever", __url: `/api/v2/${OWNER}/trips/${TRIP}/days/x/publish` },
    );
    // `mayWriteTrip` is checked before `mayActAsOwner` here, and a scope
    // that matches neither `write:content` nor this trip's own
    // `write:trip:` prefix answers the same 404 `unknown_trip` a
    // wrong-journal trip id would — B117's rule against letting a refusal's
    // shape enumerate what exists. Either way, nothing is published.
    expect([403, 404]).toContain(status);
  });

  test("POST /api/auth/handover (the exchange door) refuses it — wrong session kind", async () => {
    const t = await token();
    const { POST } = await import("@/app/api/auth/handover/route");
    const response = await POST(
      new Request("https://example.test/api/auth/handover", {
        method: "POST",
        headers: headers({ authorization: `Bearer ${t}` }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("POST /api/auth/{user}/handover (minting a wider credential) refuses it", async () => {
    const t = await token();
    const { POST } = await import("@/app/api/auth/[user]/handover/route");
    const response = await POST(
      new Request(`https://example.test/api/auth/${OWNER}/handover`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${t}`, "content-type": "application/json" }),
        body: "{}",
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(403);
  });

  test("a revoked write:gps token is 401 on its one door", async () => {
    cookie = await ownerGuestCookie();
    const { body: minted } = await mintGpsToken();
    cookie = undefined;

    cookie = await ownerGuestCookie();
    const { GET, POST } = await import("@/app/api/auth/[user]/keys/route");
    const list = await GET(
      new Request(`https://example.test/api/auth/${OWNER}/keys`, { headers: headers() }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const { keys } = (await list.json()) as { keys: { id: string; scope: string }[] };
    const row = keys.find((k) => k.scope === "gps");
    expect(row, "the minted token should be listed, labelled 'gps'").toBeTruthy();

    await POST(
      new Request(`https://example.test/api/auth/${OWNER}/keys`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ revoke: row!.id }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    cookie = undefined;

    const { status } = await importGps(minted.token as string);
    expect(status).toBe(401);
  });
});

describe("the merge-time security review's findings (B2204, 2026-09-24)", () => {
  test("GET /api/auth/{user}/keys refuses it — a write:gps bearer is not the owner", async () => {
    const { GET } = await import("@/app/api/auth/[user]/keys/route");
    const response = await GET(
      new Request(`https://example.test/api/auth/${OWNER}/keys`, {
        headers: headers({ authorization: `Bearer ${await gpsToken()}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    // Not the owner's full list: `isOwner` used to widen on the address
    // match alone with no scope check, so this bearer answered every row on
    // the journal. Refused outright here, since `write:gps` proves no
    // address `callerEmail` recognises either (its own address never had a
    // contact row of its own).
    expect(response.status).toBe(403);
  });

  test("POST /api/auth/{user}/keys (revoke) refuses it the same way", async () => {
    const { POST } = await import("@/app/api/auth/[user]/keys/route");
    const response = await POST(
      new Request(`https://example.test/api/auth/${OWNER}/keys`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${await gpsToken()}`, "content-type": "application/json" }),
        body: JSON.stringify({ revoke: "whatever" }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(403);
  });

  test("GET /api/contacts/admin refuses it — names, addresses, home addresses stay shut", async () => {
    const { GET } = await import("@/app/api/contacts/admin/route");
    const response = await GET(
      new Request(`https://example.test/api/contacts/admin?user=${OWNER}`, {
        headers: headers({ authorization: `Bearer ${await gpsToken()}` }),
      }),
    );
    expect(response.status).toBe(403);
  });

  test("POST /api/contacts/admin (approve) refuses it", async () => {
    const { POST } = await import("@/app/api/contacts/admin/route");
    const response = await POST(
      new Request("https://example.test/api/contacts/admin", {
        method: "POST",
        headers: headers({ authorization: `Bearer ${await gpsToken()}`, "content-type": "application/json" }),
        body: JSON.stringify({ user: OWNER, action: "approve", id: "whatever" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  test("story.json does not widen draft visibility for it — no draft day, no canPublish", async () => {
    const { draftsVisibleTo } = await import("@/lib/tripGate");
    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(OWNER, TRIP))!;
    const request = new Request(`https://example.test/api/v2/${OWNER}/import`, {
      headers: headers({ authorization: `Bearer ${await gpsToken()}` }),
    });
    const access = await draftsVisibleTo(trip, request);
    expect(access).toEqual({ visible: false, canPublish: false });
  });

  test("GET /{user}/story.json?trip=... shows no draft day for it (403, private trip)", async () => {
    const { GET } = await import("@/app/[user]/story.json/route");
    const response = await GET(
      new Request(`https://example.test/${OWNER}/story.json?trip=${TRIP}&from=0&to=1`, {
        headers: headers({ authorization: `Bearer ${await gpsToken()}` }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    // `algarve-2026` is `private`: neither `isOwner` nor `isTravellerOn`
    // answers yes for this scope, so the trip gate itself refuses it —
    // proving the widening is gone rather than merely that the draft is
    // hidden inside a 200.
    expect(response.status).toBe(403);
  });

  test("GET /api/v2/{user}/trips/{trip} refuses it — B2218's other half stays out of scope", async () => {
    const { status } = await call(
      "@/app/api/v2/[user]/trips/[trip]/route",
      await gpsToken(),
      { method: "GET" },
      { user: OWNER, trip: TRIP, __url: `/api/v2/${OWNER}/trips/${TRIP}` },
    );
    expect(status).toBe(403);
  });

  test("import refuses `inbox` for this scope — the phone sends `text`", async () => {
    const { POST } = await import("@/app/api/v2/[user]/import/route");
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/import`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${await gpsToken()}`, "content-type": "application/json" }),
        body: JSON.stringify({ kind: "gps", inbox: "some-other-owner-upload" }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("forbidden");
  });

  test("a gps parse refusal for this scope carries no problems or parser text", async () => {
    const { POST } = await import("@/app/api/v2/[user]/import/route");
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/import`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${await gpsToken()}`, "content-type": "application/json" }),
        body: JSON.stringify({ kind: "gps", text: "this is not a gps export" }),
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string; details?: unknown };
    expect(body.details).toBeUndefined();
    expect(body.message).not.toMatch(/line \d|token|unexpected/i);
  });

  test("minting is refused on a foreign Origin", async () => {
    cookie = await ownerGuestCookie();
    const { status, body } = await mintGpsToken(undefined, "https://evil.example");
    cookie = undefined;
    expect(status).toBe(403);
    expect((body as { error?: string }).error).toBe("foreign_origin");
  });
});

describe("the claim, derived rather than hand-listed", () => {
  /**
   * Every EXPORTED HANDLER (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) under
   * `app/api/v2/[user]/**` either gates through one of the primitives that
   * already refuse a non-journal-wide, non-trip-matching scope by
   * construction (`requireJournalOwner`, `mayActAsOwner`, `mayWriteTrip`,
   * `writableTrips`, `requireHiddenOwner`, or the shared `gateReshape`
   * wrapper, which itself calls `requireJournalOwner` —
   * `lib/api/v2/reshapeGate.ts`), or is named here with a one-line reason a
   * person can check. A new handler lands on the failing side of this test
   * until it does one of those two things — the safe default for a scan
   * that has to keep meaning something after this branch merges.
   *
   * **Per handler, not per file — B2204's own security review.** The
   * original version of this scan read the whole file as one blob of text,
   * so a file where only some verbs gate (`app/api/v2/[user]/trips/[trip]/
   * route.ts`'s `GET`, before this branch's fix) passed anyway: `PUT`/
   * `PATCH`/`DELETE` in the same file called `mayActAsOwner`, and the marker
   * being *anywhere in the file* was enough. That is exactly the shape of
   * the leak the review found — `GET` answered any bearer of the journal,
   * `write:gps` included, with the trip's full days and private plan. Each
   * handler is now walked on its own: its own body, plus every locally
   * declared helper function it calls (transitively — several routes here
   * put the actual gate in a `guard`/`gate`/`applyXPatch` function the
   * handler calls rather than inline), so a marker sitting in a sibling verb
   * no longer covers this one.
   */
  const GATE_MARKERS = [
    "requireJournalOwner",
    "requireHiddenOwner",
    "mayActAsOwner",
    "mayWriteTrip",
    "writableTrips",
    "gateReshape",
    // This ticket's own addition — `GET /status` and `GET .../trips/{trip}`
    // refuse write:gps directly rather than through one of the shared
    // primitives, since the whole point is to say so before either calls
    // `describeScope`/reads the stored trip.
    "isGpsWriteScope",
  ];

  /** Reasoned about individually above rather than by source marker.
   * Keyed `"<file>#<HANDLER>"` — a whole-file exemption would hide a sibling
   * handler in the same file that genuinely needed a gate, the same mistake
   * the file-level scan made. */
  const EXEMPT: Record<string, string> = {
    "app/api/v2/[user]/storage/route.ts#GET":
      "documented 'any scope may read storage totals' (money.md §2.6) — pre-dates this ticket. It " +
      "names trips, so write:gps is refused before it by authenticate() itself (tested above).",
    "app/api/v2/[user]/deletions/[token]/route.ts#POST":
      "reads no Authorization header at all — the credential is the single-use token in the path.",
    "app/api/v2/[user]/figures/presets/route.ts#GET":
      "deliberately unauthenticated — a vocabulary, not anybody's data (its own module comment).",
    "app/api/v2/[user]/figures/preview/route.ts#GET":
      "deliberately unauthenticated — renders whatever figure JSON the caller supplies, reads " +
      "nothing from disk (its own module comment).",
  };

  function walk(base: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(base)) {
      const full = path.join(base, entry);
      if (fs.statSync(full).isDirectory()) walk(full, found);
      else if (entry === "route.ts") found.push(full);
    }
    return found;
  }

  const HTTP_VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

  /** Every top-level function declaration in the file — exported or not,
   * `async` or not — mapped to its brace-matched body. Route files
   * routinely put the real gate in a local `guard`/`gate` helper a handler
   * calls rather than inline (e.g. `invites/[id]/route.ts`'s `guard`), so a
   * handler-only slice would miss it; this is what lets the walk below
   * follow that call. */
  function functionsIn(source: string): Map<string, string> {
    const map = new Map<string, string>();
    const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source))) {
      // The parameter list is matched first, not just "the next `{`" —
      // every route handler here destructures its second argument
      // (`{ params }: RouteContext<...>`), whose own brace is not the
      // function body's. Skipping straight to "the next `{`" after the name
      // would grab that destructure's brace instead and truncate the
      // "body" at its closing `}`, missing everything the handler actually
      // does — which is exactly how the first version of this scan read
      // every handler here as empty.
      const parenStart = source.indexOf("(", match.index);
      if (parenStart === -1) continue;
      let pdepth = 0;
      let parenEnd = -1;
      for (let i = parenStart; i < source.length; i++) {
        if (source[i] === "(") pdepth++;
        else if (source[i] === ")") {
          pdepth--;
          if (pdepth === 0) {
            parenEnd = i;
            break;
          }
        }
      }
      if (parenEnd === -1) continue;
      // Skip the return-type annotation, which can itself carry an
      // object-type brace before the real body starts —
      // `Promise<{ ok: false; response: Response } | { ok: true }>` — by
      // tracking angle-bracket depth and only accepting a `{` once it is
      // back to zero. Without this, `gateTrip` below (and every other
      // handler/helper whose return type names an inline object shape) has
      // its "body" truncated at the return type's own closing `}`, missing
      // the gate the function actually calls.
      let angle = 0;
      let braceStart = -1;
      for (let i = parenEnd + 1; i < source.length; i++) {
        const c = source[i];
        if (c === "<") angle++;
        else if (c === ">") angle = Math.max(0, angle - 1);
        else if (c === "{" && angle === 0) {
          braceStart = i;
          break;
        }
      }
      if (braceStart === -1) continue;
      let depth = 0;
      let end = braceStart;
      for (let i = braceStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      map.set(match[1], source.slice(match.index, end + 1));
    }
    return map;
  }

  /** The handler's own body, plus every same-file function it calls,
   * followed transitively. */
  function reachableText(fns: Map<string, string>, name: string, seen = new Set<string>()): string {
    if (seen.has(name)) return "";
    seen.add(name);
    const body = fns.get(name);
    if (body === undefined) return "";
    let combined = body;
    for (const other of fns.keys()) {
      if (other === name || seen.has(other)) continue;
      if (new RegExp(`\\b${other}\\(`).test(body)) {
        combined += reachableText(fns, other, seen);
      }
    }
    return combined;
  }

  test("every [user]-scoped v2 route handler gates on one of the known primitives, or is named with a reason", () => {
    const root = path.join(process.cwd(), "app", "api", "v2");
    const files = walk(root)
      .map((f) => path.relative(process.cwd(), f))
      .filter((f) => f.includes("[user]"))
      .sort();

    expect(files.length, "the walk found nothing — the path changed under this test").toBeGreaterThan(10);

    const unaccounted: string[] = [];
    let handlerCount = 0;
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      const fns = functionsIn(source);
      for (const verb of HTTP_VERBS) {
        if (!fns.has(verb)) continue;
        // Only an EXPORTED `function VERB(` is a route handler Next.js will
        // actually call — a same-named local helper would be a different bug.
        if (!new RegExp(`^export\\s+(?:async\\s+)?function\\s+${verb}\\s*\\(`, "m").test(source)) continue;
        handlerCount += 1;
        const key = `${file}#${verb}`;
        if (EXEMPT[key]) continue;
        const text = reachableText(fns, verb);
        if (!GATE_MARKERS.some((marker) => text.includes(marker))) unaccounted.push(key);
      }
    }

    expect(handlerCount, "the walk found no handlers — the extraction changed under this test").toBeGreaterThan(30);
    expect(
      unaccounted,
      "these [user]-scoped route handlers gate on none of the known primitives (directly, or through " +
        "a same-file helper they call) and are not in EXEMPT above with a reason:\n" +
        unaccounted.join("\n"),
    ).toEqual([]);
  });
});
