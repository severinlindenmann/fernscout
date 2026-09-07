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

async function stage(token: string, files: { name: string; bytes: Buffer; meta?: unknown }[]) {
  const { POST } = await import("@/app/api/v1/[user]/inbox/route");
  const form = new FormData();
  for (const file of files) {
    form.append("files", new File([new Uint8Array(file.bytes)], file.name, { type: "image/jpeg" }));
    form.append("meta", JSON.stringify(file.meta ?? {}));
  }
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/inbox`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function readInbox(token: string) {
  const { GET } = await import("@/app/api/v1/[user]/inbox/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${OWNER}/inbox`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

/** The media route's third door: file staged ids into a day. */
async function fileIntoDay(token: string, ids: string[], day = DAY) {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/media/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}/media`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify({ day, inbox: ids }),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
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
    expect(staged.body.items[0].description).toBe("the bridge");

    const listed = await readInbox(token);
    expect(listed.status).toBe(200);
    expect(listed.body.counts.media).toBe(1);
    expect(listed.body.items.media[0].id).toBe(id);

    // Now the day, and only now.
    writeDay(DAY, "2026-01-01");

    const filed = await fileIntoDay(token, [id]);
    expect(filed.status).toBe(201);
    expect(filed.body.items).toHaveLength(1);

    // On disk in the trip, and gone from the bucket — moved, not copied.
    const inTrip = fs.readdirSync(path.join(tripPath(), "media", DAY));
    expect(inTrip).toHaveLength(1);
    expect((await readInbox(token)).body.counts.media).toBe(0);

    // And in the day itself, which is the half that used to be homework.
    const entry = fs.readFileSync(
      path.join(tripPath(), "entries", `2026-01-01-${DAY}.md`),
      "utf8",
    );
    expect(entry).toContain("gallery:");
  });

  /**
   * All or nothing. A batch naming one id that is not there must leave the
   * others staged rather than filing some and reporting a failure.
   */
  test("an id that names nothing refuses the whole call and moves nothing", async () => {
    const token = await ownerToken();
    writeDay("market-morning", "2026-01-02");

    const staged = await stage(token, [{ name: "DSC_0002.jpg", bytes: await jpeg(900, 600, 60) }]);
    const id = staged.body.items[0].id as string;

    const filed = await fileIntoDay(token, [id, "deadbeef-nothing.jpg"], "market-morning");
    expect(filed.status).toBe(400);
    expect(filed.body.error).toBe("unknown_inbox_file");
    expect(filed.body.missing).toEqual(["deadbeef-nothing.jpg"]);

    // Still staged, and no day was written into.
    expect((await readInbox(token)).body.counts.media).toBe(1);
    expect(fs.existsSync(path.join(tripPath(), "media", "market-morning"))).toBe(false);
  });

  test("a staged file can be taken back out", async () => {
    const token = await ownerToken();
    const { DELETE } = await import("@/app/api/v1/[user]/inbox/[id]/route");
    const id = (await readInbox(token)).body.items.media[0].id as string;

    const response = await DELETE(
      new Request(`https://example.test/api/v1/${OWNER}/inbox/${id}`, {
        method: "DELETE",
        headers: headers({ authorization: `Bearer ${token}` }),
      }),
      { params: Promise.resolve({ user: OWNER, id }) },
    );

    expect(response.status).toBe(200);
    expect((await readInbox(token)).body.counts.media).toBe(0);
  });

  test("a file this journal does not take is refused, and nothing is written", async () => {
    const token = await ownerToken();
    const refused = await stage(token, [{ name: "payload.exe", bytes: Buffer.from("MZ") }]);
    expect(refused.status).toBe(400);
    expect((await readInbox(token)).body.counts.media).toBe(0);
  });
});

describe("who may reach it", () => {
  test("no token at all is 401, not an empty inbox", async () => {
    const { GET } = await import("@/app/api/v1/[user]/inbox/route");
    const response = await GET(
      new Request(`https://example.test/api/v1/${OWNER}/inbox`, { headers: headers() }),
      { params: Promise.resolve({ user: OWNER }) },
    );
    expect(response.status).toBe(401);
  });
});
