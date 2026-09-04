import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fetchImage, type Transport } from "@/lib/api/fetchMedia";

/**
 * Two smaller findings from the B22 sweep, held as reproductions.
 *
 * Like `test/scope-escalation.test.ts`, **these assert today's behaviour,
 * which is the wrong behaviour**, so the suite stays green until the tickets
 * land. Each names its ticket.
 *
 * - **B232** — `/api/reactions` resolves a trip with `getTrip` and never asks
 *   `mayReadTrip`. A private trip answers `200` where a trip that does not
 *   exist answers `400`, which is an existence oracle over guessable ids —
 *   the thing B117 closed on the trip gate and `mayWriteTrip` is careful about
 *   on every write route. The counts it returns are keyed by day slug, so a
 *   private trip that anyone has reacted to also hands over its day slugs, and
 *   a slug is made from the day's title.
 * - **B233** — `lib/api/fetchMedia.ts` checks `url.protocol !== "https:"` once,
 *   before the redirect loop. A hop that redirects elsewhere is re-resolved and
 *   re-pinned (which is B03's fix, and it holds) but its scheme and port are
 *   never questioned again.
 */

const OWNER = "ana";

let dir: string;

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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sweep-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "ana@example.test" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
    }),
  );

  writeTrip("the-quiet-week", "private");

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
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
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

  test("a private trip and a trip that does not exist answer differently", async () => {
    const real = await ask(`${OWNER}/the-quiet-week`);
    const invented = await ask(`${OWNER}/no-such-trip`);

    // Today: the private trip is confirmed to exist by an anonymous caller.
    expect(real.status).toBe(200);
    expect(invented.status).toBe(400);
    expect(invented.body.error).toBe("unknown_trip");
  });

  test("and an anonymous vote is recorded against one of its days", async () => {
    const { POST } = await import("@/app/api/reactions/route");
    const response = await POST(
      new Request("https://example.test/api/reactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.1" },
        body: JSON.stringify({
          trip: `${OWNER}/the-quiet-week`,
          day: "a-day-nobody-may-read",
          voter: "v1",
          emoji: "❤️",
        }),
      }),
    );
    expect(response.status).toBe(200);

    // Which then comes back to any anonymous reader, keyed by day slug.
    const after = await ask(`${OWNER}/the-quiet-week`);
    expect(Object.keys(after.body.counts as Record<string, unknown>).join(" ")).toContain(
      "a-day-nobody-may-read",
    );
  });
});

describe("B233 — the https-only rule is not re-applied after a redirect", () => {
  test("a redirect to an http URL on another port is followed, over TLS, to that port", async () => {
    const seen: URL[] = [];
    const transport: Transport = async (url) => {
      seen.push(url);
      if (seen.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://example.com:8080/next.jpg" },
        });
      }
      return new Response(new Blob([new Uint8Array([1, 2, 3])]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    };

    const result = await fetchImage(
      "https://example.com/first.jpg",
      1024,
      60_000,
      15_000,
      transport,
    );

    // The first URL was refused nothing; the second is `http:` on port 8080 and
    // was requested anyway. `pinnedRequest` would open a TLS socket to 8080.
    expect(seen).toHaveLength(2);
    expect(seen[1].protocol).toBe("http:");
    expect(seen[1].port).toBe("8080");
    expect(result.ok).toBe(true);

    // The rule as stated, and as enforced on the first URL only.
    const first = await fetchImage("http://example.com/a.jpg", 1024, 60_000, 15_000, transport);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.problem.reason).toContain("only https:");
  });
});
