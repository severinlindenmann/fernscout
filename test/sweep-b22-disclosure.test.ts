import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { fetchImage, type Transport } from "@/lib/api/fetchMedia";

/**
 * Two smaller findings from the B22 sweep, now asserting the fix.
 *
 * These began life the other way round: written by the sweep to assert
 * **today's wrong behaviour**, so the suite stayed green until the tickets
 * landed. B232 and B233 flipped them.
 *
 * - **B232** — `/api/reactions` resolved a trip with `getTrip` and never asked
 *   `mayReadTrip`. A private trip answered `200` where a trip that does not
 *   exist answered `400`, which is an existence oracle over guessable ids —
 *   the thing B117 closed on the trip gate and `mayWriteTrip` is careful about
 *   on every write route. The counts it returned are keyed by day slug, so a
 *   private trip anybody had reacted to also handed over its day slugs, and a
 *   slug is made from the day's title. The route also never asked
 *   `isEnabled("reactions")`, which is B165's shape one endpoint over.
 *
 *   The property asserted below is **sameness**: a trip nobody may read and a
 *   trip that was never written have to answer identically, byte for byte, or
 *   the oracle has only moved.
 * - **B233** — `lib/api/fetchMedia.ts` checked `url.protocol !== "https:"`
 *   once, before the redirect loop. A hop that redirects elsewhere is
 *   re-resolved and re-pinned (which is B03's fix, and it holds) but its
 *   scheme and port were never questioned again.
 */

/** Every cookie the mocked `next/headers` hands back. `mayReadTrip` reads it. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Approved: an active contact, holding the journal-wide read grant. */
const GUEST = "oma@example.test";

let dir: string;
/** Session tokens by viewer name; `anonymous` has none. */
const tokens: Record<string, string | null> = { anonymous: null };

function writeTrip(id: string, visibility: string) {
  const root = path.join(dir, OWNER, "trips", id);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "${id}"`,
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      `visibility: "${visibility}"`,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

/** The journal's own config, rewritten so a test can switch reactions off. */
function writeUserConfig(features: Record<string, { enabled: boolean }>) {
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features,
    }),
  );
}

async function clearCaches() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

/** Puts the named viewer behind the cookie jar for the calls that follow. */
function as(viewer: string) {
  jar.cookies = {};
  const token = tokens[viewer];
  if (token) jar.cookies.fs_session = token;
}

async function signIn(email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  const session = await verifyCode(OWNER, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
  return session.token;
}

async function addApprovedContact(email: string) {
  const { approveContact, confirmContact, listContacts, requestContact } = await import(
    "@/lib/contacts"
  );
  const { issueCode } = await import("@/lib/auth");
  await requestContact(OWNER, {
    name: "Reader",
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
  const contact = (await listContacts(OWNER)).find((c) => c.email === email);
  if (!contact) throw new Error(`no contact for ${email}`);
  await approveContact(OWNER, contact.id);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sweep-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        reactions: { enabled: true },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  writeUserConfig({
    auth: { enabled: true },
    contacts: { enabled: true },
    reactions: { enabled: true },
  });

  writeTrip("the-quiet-week", "private");
  writeTrip("invited-2026", "guest");
  writeTrip("open-2026", "public");

  await clearCaches();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());

  await addApprovedContact(GUEST);
  tokens.guest = await signIn(GUEST);
  tokens.owner = await signIn(OWNER_EMAIL);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of [
    "CONTENT_DIR",
    "DATABASE_URL",
    "SESSION_SECRET",
    "CONTACTS_ENCRYPTION_KEY",
  ])
    delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("B232 — /api/reactions answers for a trip nobody is allowed to read", () => {
  async function ask(ref: string) {
    const { GET } = await import("@/app/api/reactions/route");
    const response = await GET(
      new Request(`https://example.test/api/reactions?trip=${encodeURIComponent(ref)}`),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function react(ref: string, day: string, ip: string) {
    const { POST } = await import("@/app/api/reactions/route");
    const response = await POST(
      new Request("https://example.test/api/reactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ trip: ref, day, voter: "v1", emoji: "❤️" }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  test("a private trip and a trip that does not exist answer identically", async () => {
    as("anonymous");
    const real = await ask(`${OWNER}/the-quiet-week`);
    const invented = await ask(`${OWNER}/no-such-trip`);

    expect(real.status).toBe(400);
    expect(real.body).toEqual({ error: "unknown_trip" });
    // The whole property: not merely "refused", but refused in a way that says
    // nothing about whether `the-quiet-week` was ever written. B117.
    expect(real).toEqual(invented);
  });

  test("a guest trip answers the same way to somebody who was never invited", async () => {
    as("anonymous");
    const closed = await ask(`${OWNER}/invited-2026`);
    const invented = await ask(`${OWNER}/no-such-trip`);
    expect(closed).toEqual(invented);
  });

  test("an anonymous vote against a private trip is refused and records nothing", async () => {
    as("anonymous");
    const posted = await react(`${OWNER}/the-quiet-week`, "a-day-nobody-may-read", "10.9.0.1");
    expect(posted.status).toBe(400);
    expect(posted.body).toEqual({ error: "unknown_trip" });

    // And nothing was written: the owner, who may read the trip, sees no
    // counts. This is the half that made the day-slug leak self-serve.
    as("owner");
    const seen = await ask(`${OWNER}/the-quiet-week`);
    expect(seen.status).toBe(200);
    expect(seen.body.counts).toEqual({});
  });

  test("a reader with a live grant still reads and records reactions", async () => {
    as("guest");
    const before = await ask(`${OWNER}/invited-2026`);
    expect(before.status).toBe(200);

    const posted = await react(`${OWNER}/invited-2026`, "the-first-day", "10.9.0.2");
    expect(posted.status).toBe(200);

    const after = await ask(`${OWNER}/invited-2026`);
    expect(Object.keys(after.body.counts as Record<string, unknown>)).toContain(
      `${OWNER}/invited-2026:the-first-day`,
    );
  });

  test("a public trip is unchanged for anybody at all", async () => {
    as("anonymous");
    const response = await ask(`${OWNER}/open-2026`);
    expect(response.status).toBe(200);
    expect(response.body.counts).toEqual({});

    const posted = await react(`${OWNER}/open-2026`, "the-first-day", "10.9.0.3");
    expect(posted.status).toBe(200);
  });

  test("a journal with reactions switched off is absent, not empty", async () => {
    writeUserConfig({
      auth: { enabled: true },
      contacts: { enabled: true },
      reactions: { enabled: false },
    });
    await clearCaches();
    try {
      as("owner");
      const off = await ask(`${OWNER}/open-2026`);
      expect(off.status).toBe(404);
      expect(off.body.error).toBe("reactions_disabled");

      // And a journal that does not exist answers exactly the same, so the
      // capability check cannot become an oracle over journal names either.
      const nobody = await ask("nosuchjournal/open-2026");
      expect(nobody).toEqual(off);

      const posted = await react(`${OWNER}/open-2026`, "the-first-day", "10.9.0.4");
      expect(posted.status).toBe(404);
    } finally {
      writeUserConfig({
        auth: { enabled: true },
        contacts: { enabled: true },
        reactions: { enabled: true },
      });
      await clearCaches();
    }
  });
});

describe("B233 — the https-only rule is not re-applied after a redirect", () => {
  /** Answers the first call with a redirect and every later one with an image. */
  function redirectingTo(location: string): { transport: Transport; seen: URL[] } {
    const seen: URL[] = [];
    const transport: Transport = async (url) => {
      seen.push(url);
      if (seen.length === 1) {
        return new Response(null, { status: 302, headers: { location } });
      }
      return new Response(new Blob([new Uint8Array([1, 2, 3])]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    };
    return { transport, seen };
  }

  test("a redirect to an http URL is refused, and never requested", async () => {
    const { transport, seen } = redirectingTo("http://example.com:8080/next.jpg");

    const result = await fetchImage(
      "https://example.com/first.jpg",
      1024,
      60_000,
      15_000,
      transport,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toContain("only https:");
    // The transport saw the first hop and nothing after it. Before B233 it saw
    // two, the second being `http:` on port 8080 — opened over TLS, because
    // `pinnedRequest` builds from `url.port || 443` and ignores the protocol.
    expect(seen).toHaveLength(1);
  });

  /**
   * The other half of B233, decided rather than left implied: the **scheme**
   * is fixed and the **port** is not, and this asserts the second so the file
   * and its documentation cannot come apart again in the opposite direction.
   *
   * Restricting to 443 was considered and rejected. `fetchImage` is called
   * with a URL the agent chose, so a redirect reaches no port the original URL
   * could not have named directly — and `test/fetch-media.test.ts` drives the
   * B03 pin against a real listener on an ephemeral port, which the rule would
   * have made untestable. `checkHost` is what bounds this, and it is unchanged.
   */
  test("a redirect to https on another port is followed, deliberately", async () => {
    const { transport, seen } = redirectingTo("https://example.net:8443/next.jpg");

    const result = await fetchImage(
      "https://example.com/first.jpg",
      1024,
      60_000,
      15_000,
      transport,
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1].port).toBe("8443");
  });

  test("a redirect that stays on https is still followed", async () => {
    const { transport, seen } = redirectingTo("https://example.net/next.jpg");

    const result = await fetchImage(
      "https://example.com/first.jpg",
      1024,
      60_000,
      15_000,
      transport,
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1].hostname).toBe("example.net");
  });

  test("the same URL is refused when supplied directly", async () => {
    const { transport } = redirectingTo("https://example.com/never.jpg");

    const plain = await fetchImage("http://example.com/a.jpg", 1024, 60_000, 15_000, transport);
    expect(plain.ok).toBe(false);
    if (plain.ok) return;
    expect(plain.problem.reason).toContain("only https:");
  });
});
