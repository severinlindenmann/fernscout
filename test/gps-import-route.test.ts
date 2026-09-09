import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * Importing over the network, driven the way an agent drives it — B671.
 *
 * B665 put the only door in a CLI, which the owner of a hosted journal cannot
 * reach and an agent never can. This is that door as a route, and what is
 * asserted here is mostly *refusals*: the store is a person's whole life of
 * movement, so who may write into it, what comes back out, and what happens
 * when the file is not what it claims all matter more than the happy path.
 *
 * Every coordinate below is invented.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const BUDDY_EMAIL = "buddy@example.test";
const TRIP = "algarve-2026";

let dir: string;
let calls = 0;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

/** One address per call — `lib/rateLimit.ts` is a module-level map. */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.7.0.${calls % 250}`, ...extra };
}

async function tokenFor(email: string, trip?: string): Promise<string> {
  const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent", { trip });
  // A trip-scoped token is the one somebody on the trip holds: it writes days
  // into that trip and has no business in the journal's location history.
  const result = await verifyCode(OWNER, email, code, "agent", trip ? tripWriteScope(trip) : undefined);
  if (!result.ok) throw new Error(`no token for ${email}`);
  return result.token;
}

/** One day in the Algarve, a minute apart, going somewhere. */
function fixesJsonl(count = 40, day = "2026-06-22"): string {
  const start = Date.parse(`${day}T09:00:00Z`) / 1000;
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify([start + i * 60, Number((37.1 + i * 0.004).toFixed(5)), -8.5]),
  ).join("\n");
}

async function importCall(token: string, body: unknown) {
  const { POST } = await import("@/app/api/v1/[user]/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function importForm(token: string, form: FormData) {
  const { POST } = await import("@/app/api/v1/[user]/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function formats(token: string) {
  const { GET } = await import("@/app/api/v1/[user]/import/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${OWNER}/import`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function deriveTrack(token: string, trip = TRIP) {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/track/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${trip}/track`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER, trip }) },
  );
  return { status: response.status, body: await response.json() };
}

async function stageInInbox(token: string, name: string, text: string) {
  const { POST } = await import("@/app/api/v1/[user]/inbox/route");
  const form = new FormData();
  form.append("files", new File([text], name, { type: "application/json" }));
  form.append("meta", JSON.stringify({}));
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/inbox`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const body = await response.json();
  if (response.status !== 201) throw new Error(`inbox refused: ${JSON.stringify(body)}`);
  return body.items[0].id as string;
}

function storedFixes(): number {
  const gps = path.join(dir, OWNER, "gps");
  if (!fs.existsSync(gps)) return 0;
  return fs
    .readdirSync(gps)
    .filter((f) => f.endsWith(".jsonl"))
    .reduce(
      (n, f) =>
        n + fs.readFileSync(path.join(gps, f), "utf8").split("\n").filter(Boolean).length,
      0,
    );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-import-"));
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
      'title: "The Algarve"',
      'start: "2026-06-22"',
      'end: "2026-06-24"',
      'status: "past"',
      'visibility: "private"',
      "people:",
      `  - name: "Buddy"`,
      `    email: "${BUDDY_EMAIL}"`,
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

describe("the whole file, kept in written order", { shuffle: false }, () => {
  describe("what can be imported", () => {
    test("GET describes the kinds and formats, and no data", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await formats(token);
      expect(status).toBe(200);
      expect(body.kinds[0].kind).toBe("gps");
      expect(body.kinds[0].formats.map((f: { id: string }) => f.id)).toEqual(
        expect.arrayContaining(["google-timeline", "google-records", "gpx", "fixes"]),
      );
      // The one GET in the feature, and it describes the door rather than what
      // is behind it.
      expect(JSON.stringify(body)).not.toMatch(/\b\d{2}\.\d{4,}\b/);
    });
  });

  describe("the four doors the bytes can arrive through", { shuffle: false }, () => {
    test("inline text, format detected from the contents", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const before = storedFixes();
      const { status, body } = await importCall(token, { kind: "gps", text: fixesJsonl() });
      expect(status).toBe(200);
      expect(body.format).toBe("fixes");
      expect(body.detected).toBe(true);
      expect(body.read).toBe(40);
      expect(storedFixes()).toBeGreaterThan(before);
    });

    test("a file staged in the inbox, named by its id", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const timeline = JSON.stringify([
        {
          startTime: "2026-06-23T06:00:00.000Z",
          endTime: "2026-06-23T07:00:00.000Z",
          timelinePath: [
            { point: "geo:37.20000,-8.40000", durationMinutesOffsetFromStartTime: "0" },
            { point: "geo:37.30000,-8.50000", durationMinutesOffsetFromStartTime: "45" },
          ],
        },
      ]);
      const id = await stageInInbox(token, "Timeline.json", timeline);
      const { status, body } = await importCall(token, { kind: "gps", inbox: id });
      expect(status).toBe(200);
      expect(body.format).toBe("google-timeline");
      expect(body.stored.after).toBeGreaterThan(0);
      // The file is left where it was: deleting somebody's upload is theirs to
      // ask for, and the answer says so.
      expect(body.next).toContain("inbox");
      const { findInboxFile } = await import("@/lib/inbox");
      expect(findInboxFile(OWNER, id)).not.toBeNull();
    });

    test("multipart, for a one-shot with nothing staged", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const form = new FormData();
      form.append("file", new File([fixesJsonl(10, "2026-06-24")], "walk.jsonl"));
      form.append("kind", "gps");
      const { status, body } = await importForm(token, form);
      expect(status).toBe(200);
      expect(body.read).toBe(10);
    });

    test("a named format is used instead of detection", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const gpx = `<gpx><trk><trkseg>
        <trkpt lat="37.4" lon="-8.6"><time>2026-06-24T09:00:00Z</time></trkpt>
        <trkpt lat="37.5" lon="-8.7"><time>2026-06-24T10:00:00Z</time></trkpt>
      </trkseg></trk></gpx>`;
      const { status, body } = await importCall(token, {
        kind: "gps",
        format: "gpx",
        text: gpx,
      });
      expect(status).toBe(200);
      expect(body.detected).toBe(false);
      expect(body.format).toBe("gpx");
    });
  });

  describe("what it refuses", () => {
    test("a trip-scoped token cannot import, and is told why", async () => {
      const buddy = await tokenFor(BUDDY_EMAIL, TRIP);
      const { status, body } = await importCall(buddy, { kind: "gps", text: fixesJsonl() });
      expect(status).toBe(403);
      expect(body.error).toBe("out_of_scope");
      // The reason is the point: it is not "you may not", it is "this is every
      // day of somebody's life, not the days you were there".
      expect(body.message).toMatch(/whole journal/i);
    });

    test("a trip-scoped token cannot derive a track either, on its own trip", async () => {
      const buddy = await tokenFor(BUDDY_EMAIL, TRIP);
      const { status, body } = await deriveTrack(buddy);
      expect(status).toBe(403);
      expect(body.error).toBe("out_of_scope");
    });

    test("an unknown format names the ones that exist", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await importCall(token, {
        kind: "gps",
        format: "strava-premium",
        text: fixesJsonl(),
      });
      expect(status).toBe(400);
      expect(body.error).toBe("unknown_format");
      expect(body.message).toContain("google-timeline");
    });

    test("an unknown kind is refused rather than guessed at", async () => {
      // `costs` was the example here until B677 made it real. It is a fine
      // reminder that this assertion is about the refusal, not the word.
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await importCall(token, { kind: "receipts", text: fixesJsonl() });
      expect(status).toBe(400);
      expect(body.error).toBe("unknown_kind");
    });

    test("an absent kind is refused too, now that there are two", async () => {
      // It defaulted to `gps` while that was the only kind. Reading somebody's
      // bank statement as positions is not a mistake to make quietly — B677.
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await importCall(token, { text: fixesJsonl() });
      expect(status).toBe(400);
      expect(body.error).toBe("unknown_kind");
      expect(body.message).toMatch(/Say what kind/);
    });

    test("a file nothing recognises says how to name one", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await importCall(token, { kind: "gps", text: "name,amount\na,1\n" });
      expect(status).toBe(400);
      expect(body.error).toBe("unknown_format");
    });

    test("an export that parses to nothing is refused, not stored as nothing", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await importCall(token, {
        kind: "gps",
        format: "fixes",
        text: "# a file of nothing but comments\n",
      });
      expect(status).toBe(400);
      expect(body.error).toBe("contract");
      expect(body.problems.join(" ")).toMatch(/returned nothing/);
    });

    test("coordinates the wrong way round are refused, and told what that looks like", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      // Longitude in the latitude column: a real mistake, and one that would
      // otherwise be found by looking at a map of the Gulf of Guinea. Every
      // importer here drops a row that is not on Earth, so what reaches the
      // check is an empty parse — and the refusal has to name this cause, or the
      // message sends somebody looking for a format problem they do not have.
      const { status, body } = await importCall(token, {
        kind: "gps",
        format: "fixes",
        text: '[1782108000, 8.1, 471]\n[1782108300, 8.2, 472]',
      });
      expect(status).toBe(400);
      expect(body.error).toBe("contract");
      expect(body.problems.join(" ")).toMatch(/wrong way round/);
    });

    test("no body at all is a hint rather than a stack trace", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const { status, body } = await importCall(token, { kind: "gps" });
      expect(status).toBe(400);
      expect(body.error).toBe("no_file");
    });
  });

  describe("dry runs and repeats", () => {
    test("dryRun reports and writes nothing", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const before = storedFixes();
      const { status, body } = await importCall(token, {
        kind: "gps",
        text: fixesJsonl(30, "2026-07-01"),
        dryRun: true,
      });
      expect(status).toBe(200);
      expect(body.read).toBe(30);
      expect(body.stored).toBeUndefined();
      expect(storedFixes()).toBe(before);
    });

    test("importing the same export twice leaves the store the same size", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const text = fixesJsonl(60, "2026-08-01");
      const first = await importCall(token, { kind: "gps", text });
      const after = storedFixes();
      const second = await importCall(token, { kind: "gps", text });
      expect(second.body.stored.after).toBe(first.body.stored.after);
      expect(storedFixes()).toBe(after);
    });
  });

  describe("drawing the trip's line", () => {
    test("derives a track from what was imported, and says nothing about where", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      await importCall(token, { kind: "gps", text: fixesJsonl(60, "2026-06-22") });
      const { status, body } = await deriveTrack(token);
      expect(status).toBe(200);
      expect(body.written).toBe(true);
      expect(body.segments).toBeGreaterThan(0);
      expect(body.points).toBeGreaterThan(1);
      // Counts, never coordinates.
      expect(JSON.stringify(body)).not.toContain("37.1");
      expect(fs.existsSync(path.join(tripPath(), "track.json"))).toBe(true);
    });

    test("a trip with nothing in the store writes nothing and leaves any line alone", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const empty = "winter-2029";
      fs.mkdirSync(path.join(dir, OWNER, "trips", empty), { recursive: true });
      fs.writeFileSync(
        path.join(dir, OWNER, "trips", empty, "trip.md"),
        ["---", `id: "${empty}"`, 'title: "Later"', 'start: "2029-01-01"', 'end: "2029-01-05"',
          'status: "upcoming"', 'visibility: "private"', "---", "", "x", ""].join("\n"),
      );
      const { status, body } = await deriveTrack(token, empty);
      expect(status).toBe(200);
      expect(body.written).toBe(false);
      expect(fs.existsSync(path.join(dir, OWNER, "trips", empty, "track.json"))).toBe(false);
    });

    test("an unknown trip is a 404", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      const { status } = await deriveTrack(token, "never-happened");
      expect(status).toBe(404);
    });

    test("private zones are cut out, and the answer says how many", async () => {
      const token = await tokenFor(OWNER_EMAIL);
      fs.mkdirSync(path.join(dir, OWNER, "gps"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, OWNER, "gps", "exclude.json"),
        JSON.stringify([{ label: "home", lat: 37.1, lon: -8.5, radiusM: 2000 }]),
      );
      const { body } = await deriveTrack(token);
      expect(body.zones).toBe(1);
      const track = JSON.parse(fs.readFileSync(path.join(tripPath(), "track.json"), "utf8"));
      const points: [number, number][] = track.segments.flatMap(
        (s: { points: [number, number][] }) => s.points,
      );
      // Nothing within 2 km of the excluded point survived.
      expect(points.some(([lat]) => Math.abs(lat - 37.1) < 0.015)).toBe(false);
      fs.rmSync(path.join(dir, OWNER, "gps", "exclude.json"));
    });
  });
});
