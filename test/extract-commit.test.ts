import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Committing one confirmed day out of staging and into the journal — B1751,
 * Task 3.1. The first thing in this whole plan that writes real bytes into
 * `content/<user>/`, which is why the quota test below is the one that
 * matters most: it has to prove nothing moved, not merely that an error came
 * back.
 *
 * `isEnabled`/`isHelperOwner` are mocked the same way `test/extract-routes.test.ts`
 * already does, only for the one test that goes through the real route (the
 * draft assertion, which needs the whole hand-off to `assemble-day`) — every
 * other test calls `commitDay` directly and needs no route-level gate at all.
 */
const cap = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: (name: string) => (name === "extract" ? cap.enabled : true) };
});
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => true };
});

let contentDir: string;
let dataDir: string;
const USER = "alex";
const RUN = "run-1";
const DATE = "2019-07-02";

/** A journal with a real ceiling — `null` for "no ceiling at all". */
function setup(perUserBytes: number | null): void {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-commit-content-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-commit-data-"));
  process.env.CONTENT_DIR = contentDir;
  process.env.DATA_DIR = dataDir;

  fs.writeFileSync(
    path.join(contentDir, "config.json"),
    JSON.stringify({
      site: { name: "Test", url: "https://example.test" },
      users: { reserved: [] },
      features: {},
      media: { perUserBytes },
    }),
  );
  fs.mkdirSync(path.join(contentDir, USER), { recursive: true });
  fs.writeFileSync(
    path.join(contentDir, USER, "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "Alex A", nickname: "Alex", email: "alex@example.test" },
    }),
  );
}

/** Stage one photograph's bytes into the run's own holding area, and return
 *  the id staging gave it — the same id an analysed `PhotoRow` carries. */
async function stageFile(filename: string, bytes: Buffer): Promise<string> {
  const { putStagedFile } = await import("@/lib/staging/store");
  return putStagedFile(USER, RUN, filename, bytes).id;
}

async function writeRunManifest(
  photos: import("@/lib/staging/manifest").PhotoRow[],
  days: import("@/lib/staging/manifest").DayRow[],
  tripId: string | null = null,
): Promise<void> {
  const { writeManifest } = await import("@/lib/staging/manifest");
  const now = new Date();
  writeManifest(USER, {
    version: 1,
    runId: RUN,
    owner: USER,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    tripId,
    mode: "type",
    state: "telling",
    photos,
    days,
  });
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  fs.rmSync(contentDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("committing a day", () => {
  beforeEach(() => setup(10_000_000));

  test("moves the kept photographs into the date folder and leaves the dropped ones staged", async () => {
    const keptBytes = Buffer.from("kept-photo-bytes");
    const droppedBytes = Buffer.from("dropped-photo-bytes-different");
    const keptId = await stageFile("kept.jpg", keptBytes);
    const droppedId = await stageFile("dropped.jpg", droppedBytes);

    await writeRunManifest(
      [
        { id: keptId, filename: "kept.jpg", bytes: keptBytes.byteLength, kind: "image", date: DATE },
        { id: droppedId, filename: "dropped.jpg", bytes: droppedBytes.byteLength, kind: "image", date: DATE, dropped: true },
      ],
      [{ date: DATE, words: "There's a great old town for breakfast that morning.", answered: [] }],
    );

    const { commitDay } = await import("@/lib/extract/commit");
    const result = await commitDay(USER, RUN, DATE);
    expect(result.moved).toBe(1);

    const { listDayInbox } = await import("@/lib/inbox");
    expect(listDayInbox(USER, DATE).media).toHaveLength(1);
    expect(listDayInbox(USER, DATE).media[0].filename).toBe("kept.jpg");

    // The dropped photograph is untouched — still staged, still readable —
    // rather than deleted, so the person can still change their mind while
    // the run is alive.
    const { readStagedFile } = await import("@/lib/staging/store");
    expect(readStagedFile(USER, RUN, droppedId)).toEqual(droppedBytes);
  });

  test("the day's prose lands in words.md, no coordinate is invented, and every unasked track is recorded as unrecorded rather than declined", async () => {
    const keptBytes = Buffer.from("another-kept-photo");
    const keptId = await stageFile("kept2.jpg", keptBytes);
    await writeRunManifest(
      [{ id: keptId, filename: "kept2.jpg", bytes: keptBytes.byteLength, kind: "image", date: DATE }],
      [{ date: DATE, words: "There's a great old town for breakfast that morning.", answered: [] }],
    );

    const { commitDay } = await import("@/lib/extract/commit");
    await commitDay(USER, RUN, DATE);

    const { readDayReadiness, readWords } = await import("@/lib/dayReadiness");
    expect(readWords(USER, DATE)).toContain("old town for breakfast");
    // Nobody answered the where question with a real coordinate, so nothing
    // is written — in particular not a neighbouring day's coordinate.
    const readiness = readDayReadiness(USER, DATE);
    expect(readiness.location).toBeUndefined();

    // Every write-time track this flow never put in front of the person is
    // on record as "nobody has decided yet" — a true statement — never as
    // "without" (a confident "there is none of this"), which nothing here
    // has enough to claim. `photos` is absent from both lists: it is a
    // publish-time row, not this gate's business.
    expect(readiness.unrecorded.sort()).toEqual(
      ["costs", "coordinates", "tags", "time", "transportMode", "visibility"].sort(),
    );
    expect(readiness.without).toEqual([]);
  });

  test("a day whose kept photographs carry EXIF coordinates gets a location with source: photo — the median, not a mean", async () => {
    const bytesA = Buffer.from("photo-a-with-gps");
    const bytesB = Buffer.from("photo-b-with-gps");
    const idA = await stageFile("gps-a.jpg", bytesA);
    const idB = await stageFile("gps-b.jpg", bytesB);
    await writeRunManifest(
      [
        { id: idA, filename: "gps-a.jpg", bytes: bytesA.byteLength, kind: "image", date: DATE, lat: 46.0, lng: 7.0 },
        { id: idB, filename: "gps-b.jpg", bytes: bytesB.byteLength, kind: "image", date: DATE, lat: 46.2, lng: 7.4 },
      ],
      [{ date: DATE, words: "Somewhere with a real fix.", answered: [] }],
    );

    const { commitDay } = await import("@/lib/extract/commit");
    await commitDay(USER, RUN, DATE);

    const { readDayReadiness } = await import("@/lib/dayReadiness");
    const readiness = readDayReadiness(USER, DATE);
    // Two points, so the median of each axis is their plain midpoint here —
    // a real, checkable number, not just "is defined".
    expect(readiness.location).toEqual({ lat: 46.1, lon: 7.2, source: "photo" });
    // A real coordinate answers `coordinates` for real — not a decline.
    expect(readiness.unrecorded).not.toContain("coordinates");
  });

  test("a day whose kept photographs carry no coordinate gets none — even when the dropped ones did", async () => {
    const droppedBytes = Buffer.from("dropped-photo-had-gps");
    const keptBytes = Buffer.from("kept-photo-had-none");
    const droppedId = await stageFile("dropped-gps.jpg", droppedBytes);
    const keptId = await stageFile("kept-no-gps.jpg", keptBytes);
    await writeRunManifest(
      [
        // Dropped, and the only row with a coordinate — proves the median is
        // computed over `kept`, not over every photo the manifest carries.
        { id: droppedId, filename: "dropped-gps.jpg", bytes: droppedBytes.byteLength, kind: "image", date: DATE, lat: 40.0, lng: 10.0, dropped: true },
        { id: keptId, filename: "kept-no-gps.jpg", bytes: keptBytes.byteLength, kind: "image", date: DATE },
      ],
      [{ date: DATE, words: "No fix on the kept photograph.", answered: [] }],
    );

    const { commitDay } = await import("@/lib/extract/commit");
    await commitDay(USER, RUN, DATE);

    const { readDayReadiness } = await import("@/lib/dayReadiness");
    const readiness = readDayReadiness(USER, DATE);
    expect(readiness.location).toBeUndefined();
    // No real answer, so still recorded as "nobody has decided yet".
    expect(readiness.unrecorded).toContain("coordinates");
  });

  test("commitDay ensures a trip exists, named from the run's own dates, and reuses it on a later day in the same run", async () => {
    const bytes1 = await stageFile("d1.jpg", Buffer.from("day-one-photo"));
    await writeRunManifest(
      [{ id: bytes1, filename: "d1.jpg", bytes: 13, kind: "image", date: "2019-07-02" }],
      [{ date: "2019-07-02", words: "Day one.", answered: [] }],
    );
    const { commitDay } = await import("@/lib/extract/commit");
    await commitDay(USER, RUN, "2019-07-02");

    const { readManifest } = await import("@/lib/staging/manifest");
    const afterFirst = readManifest(USER, RUN);
    expect(afterFirst?.tripId).toBeTruthy();

    const { getTrip, tripRef } = await import("@/lib/trips");
    const trip = getTrip(tripRef(USER, afterFirst!.tripId!));
    expect(trip?.title).toBe("2 July 2019");
    expect(trip?.visibility).toBe("private");

    // A second day in the same run, committed separately, joins the same
    // trip rather than getting one of its own.
    const bytes2 = await stageFile("d2.jpg", Buffer.from("day-two-photo"));
    const manifest = readManifest(USER, RUN)!;
    manifest.photos.push({ id: bytes2, filename: "d2.jpg", bytes: 13, kind: "image", date: "2019-07-11" });
    manifest.days.push({ date: "2019-07-11", words: "Day eleven.", answered: [] });
    const { writeManifest } = await import("@/lib/staging/manifest");
    writeManifest(USER, manifest);
    await commitDay(USER, RUN, "2019-07-11");

    const afterSecond = readManifest(USER, RUN);
    expect(afterSecond?.tripId).toBe(afterFirst?.tripId);
  });

  test("an existing tripId on the manifest is reused, never replaced with a second trip", async () => {
    const { createTrip } = await import("@/lib/tripWrite");
    const created = createTrip(USER, {
      id: "already-there",
      title: "Already there",
      start: "2019-07-01",
      end: "2019-07-15",
    });
    expect(created.ok).toBe(true);

    const keptId = await stageFile("existing-trip.jpg", Buffer.from("photo-for-existing-trip"));
    await writeRunManifest(
      [{ id: keptId, filename: "existing-trip.jpg", bytes: 24, kind: "image", date: DATE }],
      [{ date: DATE, words: "Joining the trip that was already there.", answered: [] }],
      "already-there",
    );
    const { commitDay } = await import("@/lib/extract/commit");
    await commitDay(USER, RUN, DATE);

    const { getTrips } = await import("@/lib/trips");
    expect(getTrips(USER).map((t) => t.id)).toEqual(["already-there"]);
  });
});

describe("committing a day, through the real route, all the way into the journal", () => {
  beforeEach(() => setup(10_000_000));

  test("the created entry's own file says status: draft, and nothing else — the constraint this whole feature exists to keep", async () => {
    // A real JPEG, not arbitrary text bytes — `attachDayFolderMedia` runs
    // this all the way through `storeUploads`, which validates real image
    // content, unlike every other test in this file that stops at
    // `listDayInbox` and never needs a real photograph.
    const keptBytes = fs.readFileSync("test/fixtures/ingest/camera.jpg");
    const keptId = await stageFile("draft.jpg", keptBytes);
    await writeRunManifest(
      [{ id: keptId, filename: "draft.jpg", bytes: keptBytes.byteLength, kind: "image", date: DATE }],
      [{ date: DATE, words: "A quiet morning.", answered: [] }],
    );

    const { POST } = await import("@/app/api/helper/[user]/extract/commit/route");
    const res = await POST(
      new Request("http://x/api/helper/alex/extract/commit", {
        method: "POST",
        body: JSON.stringify({ run: RUN, date: DATE }),
      }),
      { params: Promise.resolve({ user: USER }) },
    );
    const body = (await res.json()) as { ok: boolean; moved: number; entry: string | null };
    expect(res.status).toBe(200);
    expect(body.moved).toBe(1);
    expect(body.entry).toBeTruthy();

    const { readManifest } = await import("@/lib/staging/manifest");
    const tripId = readManifest(USER, RUN)?.tripId;
    expect(tripId).toBeTruthy();

    // The one acceptable evidence: the file that actually landed.
    const { userDir } = await import("@/lib/users");
    const entryFile = path.join(userDir(USER), "trips", tripId!, "entries", `${DATE}-${body.entry}.json`);
    const written = JSON.parse(fs.readFileSync(entryFile, "utf8")) as { status: string; content: string };
    expect(written.status).toBe("draft");
    expect(fs.readFileSync(entryFile, "utf8")).not.toContain("published");
    expect(written.content).toContain("A quiet morning.");

    // Committed, staged, and gone from the day folder — attached to the real
    // entry instead.
    const { listDayInbox } = await import("@/lib/inbox");
    expect(listDayInbox(USER, DATE).media).toHaveLength(0);
  });
});

describe("committing a day over quota", () => {
  beforeEach(() => setup(10)); // ten bytes of allowance, far below any real photograph

  test("refuses when the journal is over its quota, and moves nothing — not even a trip", async () => {
    const keptBytes = Buffer.from("this-photo-is-far-too-large-for-the-tiny-quota");
    const keptId = await stageFile("big.jpg", keptBytes);
    await writeRunManifest(
      [{ id: keptId, filename: "big.jpg", bytes: keptBytes.byteLength, kind: "image", date: DATE }],
      [{ date: DATE, words: "Should never be written either.", answered: [] }],
    );

    const { commitDay } = await import("@/lib/extract/commit");
    const result = await commitDay(USER, RUN, DATE);
    expect(result.moved).toBe(0);
    expect(result.entry).toBeNull();

    const { listDayInbox } = await import("@/lib/inbox");
    expect(listDayInbox(USER, DATE).media).toHaveLength(0);

    // Refused as a whole day: not the photograph, not the words either — a
    // half-committed day is worse than a refused one.
    const { readWords } = await import("@/lib/dayReadiness");
    expect(readWords(USER, DATE)).toBe("");

    // And the file itself never left staging.
    const { readStagedFile } = await import("@/lib/staging/store");
    expect(readStagedFile(USER, RUN, keptId)).toEqual(keptBytes);

    const { readManifest } = await import("@/lib/staging/manifest");
    const after = readManifest(USER, RUN);
    expect(after?.days.find((d) => d.date === DATE)?.committed).toBeFalsy();
    // No trip either — a half-committed *run* is exactly as unwanted as a
    // half-committed day.
    expect(after?.tripId).toBeNull();
    const { getTrips } = await import("@/lib/trips");
    expect(getTrips(USER)).toEqual([]);
  });
});
