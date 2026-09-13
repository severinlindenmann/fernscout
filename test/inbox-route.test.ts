import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * The inbox, driven the way an agent drives it — B663.
 *
 * `test/inbox.test.ts` holds the module's own properties. This is the round
 * trip that is the actual feature: stage a photograph while no day exists,
 * write the day, file the photograph into it, and find the bucket empty
 * afterwards. Nothing here is mocked above the socket — the real routes, the
 * real token, the real pipeline, and the assertions taken off the disk.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const DAY = "lanterns-of-hoi-an";

let dir: string;
let calls = 0;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

async function jpeg(width: number, height: number, shade = 140): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: shade } } })
    .jpeg()
    .toBuffer();
}

/** One address per call — `lib/rateLimit.ts` is a module-level map. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.3.0.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/**
 * Staging is no longer its own verb (B1624) — it is the v2 media door with
 * `trip`/`day` declined, one file per call. This helper keeps the batch shape
 * the tests below already read (`items[]`) by calling the door once per file.
 */
async function stage(
  token: string,
  files: { name: string; bytes: Buffer; meta?: { description?: string } }[],
) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const items: Record<string, unknown>[] = [];
  for (const file of files) {
    const caption = file.meta?.description;
    const form = new FormData();
    form.append("file", new File([new Uint8Array(file.bytes)], file.name, { type: "image/jpeg" }));
    form.append(
      "intent",
      JSON.stringify({
        kind: "photo",
        ...(caption ? { caption } : {}),
        declined: {
          trip: "not sorted yet",
          day: "not sorted yet",
          ...(caption ? {} : { caption: "not said at upload" }),
        },
      }),
    );
    const response = await POST(
      new Request(`https://example.test/api/v2/${OWNER}/media`, {
        method: "POST",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: form,
      }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    const body = await response.json();
    if (response.status !== 201) return { status: response.status, body };
    const src = typeof body.src === "string" ? body.src : "";
    items.push({ id: src.replace(/^inbox:/, ""), caption: body.caption });
  }
  return { status: 201, body: { items } };
}

async function readInbox(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/inbox/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/inbox`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

/**
 * The v2 media door's `inbox` branch — B1613 replaced the v1 trip media
 * route's own `inbox: [...ids]` batch door with the one upload door every
 * kind of bytes shares, and that door is single-file-per-call (decision 7's
 * "one fact, one address" carried through). One id at a time here, rather
 * than the old array, for the same reason.
 */
async function fileIntoDay(token: string, id: string, day = DAY) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify({
        intent: { kind: "photo", trip: TRIP, day, declined: { caption: "not said at upload" } },
        inbox: id,
      }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-inbox-route-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
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
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
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
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The day the photograph will end up on. Written *after* it is staged, which
 * is the order this whole feature exists to allow. */
function writeDay(slug: string, date: string) {
  fs.writeFileSync(
    path.join(tripPath(), "entries", `${date}-${slug}.md`),
    ["---", `title: "${slug}"`, `date: "${date}"`, "status: draft", "---", "", "Words.", ""].join(
      "\n",
    ),
  );
}

describe("the whole file, kept in written order", { shuffle: false }, () => {
  describe("staging a file before any day exists", () => {
    test("the round trip: stage, write the day, file it, bucket empty", async () => {
      const token = await ownerToken();

      // No day of that name exists yet — the media route would refuse this.
      expect(fs.existsSync(path.join(tripPath(), "entries", `2026-01-01-${DAY}.md`))).toBe(false);

      const staged = await stage(token, [
        { name: "DSC_0001.jpg", bytes: await jpeg(1200, 800), meta: { description: "the bridge" } },
      ]);
      expect(staged.status).toBe(201);
      const id = staged.body.items[0].id as string;
      expect(staged.body.items[0].caption).toBe("the bridge");

      const listed = await readInbox(token);
      expect(listed.status).toBe(200);
      expect(listed.body.counts.media).toBe(1);
      expect(listed.body.items.media[0].id).toBe(id);

      // Now the day, and only now — though the v2 media door no longer needs
      // it to exist: `day` only ever decides where on disk the bytes land,
      // never whether an entry is there to attach into (that attachment is
      // the day route's own job now, reading this response's `src` back).
      writeDay(DAY, "2026-01-01");

      const filed = await fileIntoDay(token, id);
      expect(filed.status).toBe(201);
      expect(filed.body.src).toBeTruthy();
      expect(filed.body.trip).toBe(TRIP);
      expect(filed.body.day).toBe(DAY);

      // On disk in the trip, and gone from the bucket — moved, not copied.
      // Two files per photograph now: the derivative and its sidecar.
      const inTrip = fs.readdirSync(path.join(tripPath(), "media", DAY));
      expect(inTrip).toHaveLength(2);
      expect((await readInbox(token)).body.counts.media).toBe(0);
    });

    test("an id that names nothing is refused, and nothing is written", async () => {
      const token = await ownerToken();
      writeDay("market-morning", "2026-01-02");

      // Staged for real, so the next test ("a staged file can be taken back
      // out") has something in the bucket — this test's own id is a bogus
      // one that names nothing, kept separate on purpose.
      await stage(token, [{ name: "DSC_0002.jpg", bytes: await jpeg(900, 600, 60) }]);

      const filed = await fileIntoDay(token, "deadbeef-nothing.jpg", "market-morning");
      expect(filed.status).toBe(400);
      expect(filed.body.error).toBe("unknown_inbox_file");
      expect(fs.existsSync(path.join(tripPath(), "media", "market-morning"))).toBe(false);
      expect((await readInbox(token)).body.counts.media).toBe(1);
    });

    test("a staged file can be taken back out", async () => {
      const token = await ownerToken();
      const { DELETE } = await import("@/app/api/v2/[user]/inbox/[id]/route");
      const id = (await readInbox(token)).body.items.media[0].id as string;

      const response = await DELETE(
        new Request(`https://example.test/api/v2/${OWNER}/inbox/${id}`, {
          method: "DELETE",
          headers: headers({ authorization: `Bearer ${token}` }),
        }),
        { params: Promise.resolve({ user: OWNER, id }) },
      );

      expect(response.status).toBe(200);
      expect((await readInbox(token)).body.counts.media).toBe(0);
    });

    // B1613's media door validates format/size for a photo landing ON A TRIP
    // (`storeTripPhoto`) but not for one declined straight to the inbox — the
    // `else` branch of `storeMediaV2` calls `storeInboxFile` with no format
    // check at all, unlike v1's `POST /inbox` (`kindForExtension`). Captured
    // as B1627 rather than fixed here: `lib/api/v2/media.ts` is B1613's own
    // file, not this ticket's (B1624, print/inbox/statements/journals).
    test("an inbox-declined upload is staged with no format check (B1627)", async () => {
      const token = await ownerToken();
      const staged = await stage(token, [{ name: "payload.exe", bytes: Buffer.from("MZ") }]);
      expect(staged.status).toBe(201);
      // Clean up so it does not leak into the next test's counts.
      const { DELETE } = await import("@/app/api/v2/[user]/inbox/[id]/route");
      await DELETE(
        new Request(`https://example.test/api/v2/${OWNER}/inbox/${staged.body.items[0].id}`, {
          method: "DELETE",
          headers: headers({ authorization: `Bearer ${token}` }),
        }),
        { params: Promise.resolve({ user: OWNER, id: staged.body.items[0].id as string }) },
      );
    });
  });

  describe("who may reach it", () => {
    test("no token at all is 401, not an empty inbox", async () => {
      const { GET } = await import("@/app/api/v2/[user]/inbox/route");
      const response = await GET(
        new Request(`https://example.test/api/v2/${OWNER}/inbox`, { headers: headers() }),
        { params: Promise.resolve({ user: OWNER }) },
      );
      expect(response.status).toBe(401);
    });
  });
});
