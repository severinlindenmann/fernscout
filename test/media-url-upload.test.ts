import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

/**
 * The URL door, end to end — B133.
 *
 * B30's test calls `storeUploads()` with byte candidates, which is
 * indistinguishable from the multipart path: it proves the shared writer keeps
 * an original, and nothing more. The argument that this was enough was that
 * both doors go through that one writer, so the asymmetry could not come back
 * without deleting the field. That is an argument about the shape of the code
 * today, not a test — a URL branch that resized *before* calling `storeUploads`
 * would reintroduce exactly the bug B30 was raised for, and nothing would fail.
 *
 * The promise is worth a test of its own because of what it is: `agent.md`
 * tells agents the original is what a photobook prints from and that a small
 * source cannot be recovered later. B30 exists because an agent watched 3000px
 * go in, read 2000px back, and concluded the promise did not hold.
 *
 * So: the real route handler, a stubbed remote host, and the assertion taken
 * off the disk rather than out of the response.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const DAY = "lanterns-of-hoi-an";

let dir: string;
let calls = 0;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

/** One IP per call — `lib/rateLimit.ts` is a module-level map for the file. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.2.0.${calls % 250}`,
    ...extra,
  };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** The JSON door, driven exactly as an agent drives it. */
async function postUrls(token: string, urls: string[]) {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/media/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}/media`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ day: DAY, urls }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
  );
  return { status: response.status, body: await response.json() };
}

const realRequest = https.request;
const realLookup = dns.lookup;

/**
 * A remote host that serves one known image.
 *
 * DNS is stubbed as well as the socket: the build never touches the network,
 * and a test that depends on `example.com` resolving is a test that fails on a
 * machine with no resolver.
 *
 * Stubbed at `https.request` rather than at `globalThis.fetch` since B03. The
 * route reaches the remote host through `fetchImage`, which no longer uses
 * `fetch` — `fetch` takes no `lookup`, so it cannot be pinned to the address
 * that was checked. Everything above the socket is therefore still the real
 * code here, pin included, which is more of it than this test used to cover.
 */
function serve(bytes: Buffer) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (https as any).request = (
    _options: unknown,
    callback: (message: IncomingMessage) => void,
  ): ClientRequest => {
    const message = Readable.from([bytes]) as unknown as IncomingMessage;
    message.statusCode = 200;
    message.headers = { "content-type": "image/jpeg" };
    const request = new EventEmitter() as unknown as ClientRequest;
    request.end = (() => {
      setImmediate(() => callback(message));
      return request;
    }) as ClientRequest["end"];
    return request;
  };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-url-media-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.MEDIA_ORIGINALS_DIR;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
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
      features: { auth: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(tripPath(), "trip.md"),
    [
      "---",
      `id: "${TRIP}"`,
      'title: "Asia"',
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      'status: "past"',
      'visibility: "private"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  // A draft: photographs attach to a day that exists, and a published one is
  // refused on purpose.
  fs.writeFileSync(
    path.join(tripPath(), "entries", `2026-01-01-${DAY}.md`),
    [
      "---",
      `title: "${DAY}"`,
      'date: "2026-01-01"',
      'location: "Hoi An"',
      'country: "Vietnam"',
      "status: draft",
      "---",
      "",
      "Words.",
      "",
    ].join("\n"),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (https as any).request = realRequest;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).lookup = realLookup;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a photograph fetched from a URL", () => {
  test("keeps the source at full size, and says so in kept", async () => {
    serve(await jpeg(3000, 2000));
    const token = await ownerToken();

    const { status, body } = await postUrls(token, ["https://example.com/seed/x/3000/2000"]);
    expect(status).toBe(201);

    const reply = body as {
      ok: boolean;
      items: { width: number; height: number; src: string }[];
      kept: { filename: string; width: number; height: number; bytes: number }[];
      attached: boolean;
    };
    expect(reply.ok).toBe(true);
    expect(reply.attached).toBe(true);

    // What the site serves, resized.
    expect(reply.items[0]).toMatchObject({ width: 2000, height: 1333 });
    // What was stored for print, untouched. These are the numbers the remote
    // host actually sent, which is the fact being checked.
    expect(reply.kept).toHaveLength(1);
    expect(reply.kept[0]).toMatchObject({ width: 3000, height: 2000 });
    expect(reply.kept[0].bytes).toBeGreaterThan(0);

    // And the claim, off the disk rather than out of the response. This is the
    // assertion B30's test could not make about this door: a URL branch that
    // resized before storing would answer the same `201` and fail here.
    const original = path.join(tripPath(), "originals", DAY, "01.jpg");
    expect(fs.existsSync(original)).toBe(true);
    const meta = await sharp(original).metadata();
    expect(meta.width).toBe(3000);
    expect(meta.height).toBe(2000);
    expect(fs.statSync(original).size).toBe(reply.kept[0].bytes);

    // The two really are different files, not one path asserted twice.
    const served = path.join(tripPath(), "media", DAY, "01.jpg");
    expect((await sharp(served).metadata()).width).toBe(2000);
  });

  /**
   * `kept.filename` on this door is the URL's last path segment, so a host
   * whose URLs end in a dimension reports `2000.jpg` for a 3000px file. Nothing
   * is wrong on disk — the stored name is `01.jpg` — but the field an agent
   * would use to correlate is meaningless here, and the guide now says so.
   */
  test("kept.filename is the URL's last segment, which is advisory only", async () => {
    serve(await jpeg(1200, 800));
    const token = await ownerToken();

    const { status, body } = await postUrls(token, ["https://example.com/seed/x/3000/2000"]);
    expect(status).toBe(201);
    const reply = body as { kept: { filename: string }[]; items: { src: string }[] };

    expect(reply.kept[0].filename).toBe("2000.jpg");
    // Position is what correlates, and it is what the guide tells agents to use.
    expect(reply.items[0].src).toContain(`/${DAY}/02.jpg`);
    expect(fs.existsSync(path.join(tripPath(), "originals", DAY, "02.jpg"))).toBe(true);
  });

  /** All or nothing, through the route: a refused URL writes nothing at all. */
  test("a refused URL leaves no half-imported day", async () => {
    const token = await ownerToken();
    const before = fs.readdirSync(path.join(tripPath(), "media", DAY)).length;

    const { status, body } = await postUrls(token, ["https://127.0.0.1/a.jpg"]);
    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe("could_not_fetch");
    expect(fs.readdirSync(path.join(tripPath(), "media", DAY))).toHaveLength(before);
  });
});
