import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import sharp from "sharp";
import { paintJpeg } from "./support/pictures";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

/**
 * The URL door, end to end — B133/B30, driven at the v2 media door.
 *
 * `storeMediaV2`'s own test (`test/api-v2-media.test.ts`) calls the route
 * with byte candidates over multipart, which is indistinguishable from a
 * `{intent, url}` JSON call at the level of `storeMediaV2` itself: it proves
 * the shared writer keeps an original, and nothing more. The argument that
 * this is enough is an argument about the shape of the code today, not a
 * test — a `url` branch that resized *before* handing bytes to
 * `storeMediaV2` would reintroduce exactly the bug B30 was raised for, and
 * nothing in the multipart suite would fail.
 *
 * The promise is worth a test of its own because of what it is: AGENTS.md
 * tells agents the original is what a photobook prints from and that a small
 * source cannot be recovered later. B30 exists because an agent watched
 * 3000px go in and read 2000px back, and concluded the promise did not hold.
 *
 * This file was deleted during the v2 migration (B1613) on the judgement
 * that it was "wholly about the deleted route's v1-only batch semantics".
 * That was wrong: the v2 door still has a `url` branch — `fetchMedia` at
 * `app/api/v2/[user]/media/route.ts` — so the exact same regression this file
 * exists to catch is still possible to reintroduce here. Do not delete this
 * again; repoint it if the door's shape changes further.
 *
 * So: the real v2 route handler, a stubbed remote host, and the assertion
 * taken off the disk rather than out of the response.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const DAY = "lanterns-of-hoi-an";

let dir: string;
let calls = 0;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

/** One IP per call — `lib/rateLimit.ts` is a module-level map for the file. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return {
    "content-type": "application/json",
    "x-forwarded-for": `10.2.1.${calls % 250}`,
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

/** The JSON door, driven exactly as an agent drives it: `intent` + `url`. */
async function postUrl(token: string, url: string, day: string, opts: { trip?: string } = {}) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const intent: Record<string, unknown> = { kind: "photo", trip: opts.trip ?? TRIP };
  if (day) intent.day = day;
  else intent.declined = { day: "sorting later" };
  intent.declined = { ...(intent.declined as object | undefined), caption: "no caption for this test" };
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ intent, url }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const realRequest = https.request;
const realLookup = dns.lookup;

/**
 * A remote host that serves one known image.
 *
 * DNS is stubbed as well as the socket: the build never touches the network,
 * and a test that depends on `example.com` resolving is a test that fails on
 * a machine with no resolver.
 *
 * Stubbed at `https.request` rather than at `globalThis.fetch`, matching
 * `fetchMedia`'s own implementation (it reaches the remote host through
 * `https.request` so it can pin the connection to the address it already
 * checked — `fetch` takes no `lookup` option). Everything above the socket is
 * therefore still the real code here, pin included.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-url-media-v2-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.MEDIA_ORIGINALS_DIR;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");
  const { createTrip } = await import("@/lib/tripWrite");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: OWNER,
    title: "Two Backpacks",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Ana Traveller",
    ownerNickname: "Ana",
  });
  if (!created.ok) throw new Error(created.message);

  const trip = createTrip(OWNER, {
    id: TRIP,
    title: "Asia",
    start: "2026-01-01",
    end: "2026-01-10",
    visibility: "private",
  });
  if (!trip.ok) throw new Error(trip.message);
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
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a photograph fetched from a URL", { shuffle: false }, () => {
  test("keeps the source at full size on disk, not merely in the response", async () => {
    const sourceBytes = await paintJpeg(3000, 2000);
    serve(sourceBytes);
    const token = await ownerToken();

    const { status, body } = await postUrl(token, "https://example.com/seed/x/3000/2000", DAY);
    expect(status, JSON.stringify(body)).toBe(201);

    const src = String(body.src);
    // frontmatterSrc(tripId, relPath) — see media-response-src.test.ts.
    const relPath = src.replace(new RegExp(`^/media/${TRIP}/`), "");

    // What the site serves, resized to the derivative ceiling.
    const derivative = path.join(tripPath(), "media", relPath);
    const derivMeta = await sharp(derivative).metadata();
    expect(derivMeta.width).toBe(2000);
    expect(derivMeta.height).toBe(1333);

    // And the claim, off the disk rather than out of the response — this is
    // the assertion the multipart-only suite cannot make about this branch: a
    // `url` path that resized before calling `storeMediaV2` would still
    // answer `201` and still fail only here.
    const original = path.join(tripPath(), "originals", relPath);
    expect(fs.existsSync(original)).toBe(true);
    const meta = await sharp(original).metadata();
    expect(meta.width).toBe(3000);
    expect(meta.height).toBe(2000);
    expect(fs.readFileSync(original).equals(sourceBytes)).toBe(true);

    // The two really are different files, not one path asserted twice.
    expect(derivative).not.toBe(original);
  });

  /** All or nothing, through the route: a refused URL writes nothing at all. */
  test("a refused URL stores nothing", async () => {
    const token = await ownerToken();

    const { status, body } = await postUrl(token, "https://127.0.0.1/a.jpg", "refused-day");
    expect(status).toBe(400);
    expect(body.error).toBe("could_not_fetch");
    expect(fs.existsSync(path.join(tripPath(), "media", "refused-day"))).toBe(false);
  });

  test("a day-less upload keeps the original too", async () => {
    serve(await paintJpeg(2400, 1600));
    const token = await ownerToken();

    const { status, body } = await postUrl(token, "https://example.com/seed/x/2400/1600", "");
    expect(status, JSON.stringify(body)).toBe(201);
    expect(body.day).toBeUndefined();

    const src = String(body.src);
    const relPath = src.replace(new RegExp(`^/media/${TRIP}/`), "");
    const original = path.join(tripPath(), "originals", relPath);
    expect(fs.existsSync(original)).toBe(true);
    expect((await sharp(original).metadata()).width).toBe(2400);
  });
});
