import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

/**
 * Committing one confirmed day out of staging and into the journal — B1751,
 * Task 3.1. The first thing in this whole plan that writes real bytes into
 * `content/<user>/`, which is why the quota test below is the one that
 * matters most: it has to prove nothing moved, not merely that an error came
 * back.
 */

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
  // Imported lazily, after `DATA_DIR` is set for this test.
  const { putStagedFile } = await import("@/lib/staging/store");
  return putStagedFile(USER, RUN, filename, bytes).id;
}

async function writeRunManifest(
  photos: import("@/lib/staging/manifest").PhotoRow[],
  days: import("@/lib/staging/manifest").DayRow[],
): Promise<void> {
  const { writeManifest } = await import("@/lib/staging/manifest");
  const now = new Date();
  writeManifest(USER, {
    version: 1,
    runId: RUN,
    owner: USER,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    tripId: null,
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

  test("the day's prose lands in words.md, and no location is invented", async () => {
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
    expect(readDayReadiness(USER, DATE).location).toBeUndefined();
  });

  test("commit never creates an entry — draft is the only state that could ever exist afterward", async () => {
    // The literal frontmatter assertion ("the created entry says status:
    // draft") does not apply to this file: `commitDay`'s own doc comment and
    // its `Consumes` list are explicit that `assemble-day` — not this
    // function — creates the entry, and `assemble-day` itself needs a real
    // trip (`getTrip`) plus every one of its tracked rows answered, neither
    // of which this run's manifest carries. So the honest, checkable form of
    // "generate never publishes" here is stronger than a frontmatter field:
    // no entry file exists at all, anywhere in the journal, after a commit —
    // which makes "not published" true by construction rather than by a
    // field that could in principle say something else.
    const keptBytes = Buffer.from("draft-proof-photo");
    const keptId = await stageFile("draft.jpg", keptBytes);
    await writeRunManifest(
      [{ id: keptId, filename: "draft.jpg", bytes: keptBytes.byteLength, kind: "image", date: DATE }],
      [{ date: DATE, words: "A quiet morning.", answered: [] }],
    );
    const { commitDay } = await import("@/lib/extract/commit");
    const result = await commitDay(USER, RUN, DATE);
    expect(result.moved).toBe(1);

    const { userDir } = await import("@/lib/users");
    const tripsDir = path.join(userDir(USER), "trips");
    expect(fs.existsSync(tripsDir) ? fs.readdirSync(tripsDir) : []).toEqual([]);

    // The one file this task does write, checked directly: it carries no
    // `status` field of any kind, published or otherwise.
    const wordsFile = path.join(userDir(USER), "inbox", "days", DATE, "words.md");
    expect(fs.readFileSync(wordsFile, "utf8")).not.toMatch(/status\s*:/);
  });
});

describe("committing a day over quota", () => {
  beforeEach(() => setup(10)); // ten bytes of allowance, far below any real photograph

  test("refuses when the journal is over its quota, and moves nothing", async () => {
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
    expect(readManifest(USER, RUN)?.days.find((d) => d.date === DATE)?.committed).toBeFalsy();
  });
});
