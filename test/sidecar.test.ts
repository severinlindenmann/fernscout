import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * One metadata file per photograph, for life — B1864.
 *
 * Three properties, and every one of them was a real defect before this
 * module existed: a write preserves what it does not understand, a write is
 * never half-visible, and filing a photograph MOVES its sidecar rather than
 * writing a second one next to the first.
 */

const OWNER = "ana";
const TRIP = "sidecar-2026";
const REF = `${OWNER}/${TRIP}`;

let dir: string;
let work: string;

const tripRoot = () => path.join(dir, OWNER, "trips", TRIP);

/** A real JPEG, deterministic, so a measurement is reproducible. */
async function jpeg(width = 80, height = 60, shade = 120): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 8, g: 60, b: shade } } })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sidecar-"));
  work = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sidecar-work-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "66".repeat(32);
  delete process.env.MEDIA_ORIGINALS_DIR;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  const created = createJournal({
    username: OWNER,
    title: "Two Backpacks",
    ownerEmail: "ana@example.test",
    ownerName: "Ana Traveller",
    ownerNickname: "Ana",
  });
  if (!created.ok) throw new Error(created.message);

  writeTripFixture(OWNER, {
    id: TRIP,
    title: "Sidecars",
    start: "2026-04-01",
    end: "2026-04-05",
    visibility: "private",
  });
  writeDayFixture(dir, OWNER, TRIP, { slug: "a-day", date: "2026-04-01", title: "A day" });
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

describe("writeSidecar", () => {
  let file: string;

  beforeEach(() => {
    const scratch = fs.mkdtempSync(path.join(work, "one-"));
    file = path.join(scratch, "01.jpg.meta.json");
  });

  test("a key it has never heard of survives every later write", async () => {
    const { readSidecar, writeSidecar } = await import("@/lib/sidecar");

    fs.writeFileSync(
      file,
      JSON.stringify({ caption: "first", somethingLaterWillAdd: { cost: 3 } }),
    );
    writeSidecar(file, { description: "what was said" });

    const read = readSidecar(file) as Record<string, unknown>;
    expect(read.somethingLaterWillAdd).toEqual({ cost: 3 });
    expect(read.caption).toBe("first");
    expect(read.description).toBe("what was said");
  });

  test("a key set to undefined is removed rather than written as null", async () => {
    const { readSidecar, writeSidecar } = await import("@/lib/sidecar");
    writeSidecar(file, { caption: "said once" });
    writeSidecar(file, { caption: undefined });
    expect(readSidecar(file)).toEqual({});
    expect(fs.readFileSync(file, "utf8")).not.toContain("null");
  });

  test("the write is a rename: nothing partial is ever at the final path", async () => {
    const { readSidecar, writeSidecar } = await import("@/lib/sidecar");
    writeSidecar(file, { caption: "first" });
    writeSidecar(file, { caption: "second", description: "and more of it" });

    // The directory holds the sidecar and nothing else — no `.tmp-` left
    // behind, which is also what proves the final path was never the file
    // being written into.
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
    expect(readSidecar(file)?.caption).toBe("second");
  });

  test("a malformed file reads as absent, never as half a sidecar", async () => {
    const { readSidecar } = await import("@/lib/sidecar");
    fs.writeFileSync(file, '{"caption": "cut off mid-');
    expect(readSidecar(file)).toBeNull();
  });
});

describe("moveSidecar", () => {
  test("leaves exactly one file, carrying every key plus the patch", async () => {
    const { moveSidecar, readSidecar } = await import("@/lib/sidecar");
    const scratch = fs.mkdtempSync(path.join(work, "move-"));
    const from = path.join(scratch, "in", "x.jpg.meta.json");
    const to = path.join(scratch, "out", "01.jpg.meta.json");

    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.writeFileSync(from, JSON.stringify({ description: "theirs", lat: 1.5, measuredFrom: "exif" }));

    moveSidecar(from, to, { trip: TRIP, day: "a-day" });

    expect(fs.existsSync(from)).toBe(false);
    expect(fs.readdirSync(path.dirname(to))).toEqual(["01.jpg.meta.json"]);
    expect(readSidecar(to)).toEqual({
      description: "theirs",
      lat: 1.5,
      measuredFrom: "exif",
      trip: TRIP,
      day: "a-day",
    });
  });
});

describe("a trip sidecar still sitting in media/", () => {
  const rel = path.join("legacy-day", "01.jpg");
  const legacy = () => path.join(tripRoot(), "media", `${rel}.meta.json`);
  const meta = () => path.join(tripRoot(), "meta", `${rel}.meta.json`);

  beforeEach(() => {
    fs.rmSync(legacy(), { force: true });
    fs.rmSync(meta(), { force: true });
    fs.mkdirSync(path.dirname(legacy()), { recursive: true });
    fs.writeFileSync(legacy(), JSON.stringify({ caption: "written before B1863", filename: "IMG_1.HEIC" }));
  });

  test("is read when meta/ has none", async () => {
    const { readTripSidecar } = await import("@/lib/sidecar");
    expect(readTripSidecar(REF, rel)?.caption).toBe("written before B1863");
  });

  test("migrates on the first write, keys and all, and the old copy goes", async () => {
    const { readTripSidecar, writeTripSidecar } = await import("@/lib/sidecar");
    writeTripSidecar(REF, rel, { description: "added later" });

    expect(fs.existsSync(legacy())).toBe(false);
    expect(fs.existsSync(meta())).toBe(true);
    expect(readTripSidecar(REF, rel)).toEqual({
      caption: "written before B1863",
      filename: "IMG_1.HEIC",
      description: "added later",
    });
  });

  test("removeTripSidecar clears both places and leaves no empty meta/<day>", async () => {
    const { removeTripSidecar, writeTripSidecar } = await import("@/lib/sidecar");
    writeTripSidecar(REF, rel, { description: "added later" });
    // And a legacy copy back beside the derivative, the state an older
    // journal is actually in.
    fs.writeFileSync(legacy(), JSON.stringify({ caption: "still here" }));

    removeTripSidecar(REF, rel);

    expect(fs.existsSync(legacy())).toBe(false);
    expect(fs.existsSync(meta())).toBe(false);
    expect(fs.existsSync(path.dirname(meta()))).toBe(false);
  });
});

describe("imageFactsFor", () => {
  test("measures once, then answers from the sidecar", async () => {
    const { imageFactsFor, readTripSidecar } = await import("@/lib/sidecar");
    const rel = path.join("a-day", "measured.jpg");
    const file = path.join(tripRoot(), "media", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await jpeg(64, 48));

    const first = await imageFactsFor(REF, rel, file);
    expect(first?.width).toBe(64);
    expect(first?.height).toBe(48);
    expect(readTripSidecar(REF, rel)?.image?.measuredAt).toBe(first?.measuredAt);

    // The cached block, not a second decode: the same instant comes back.
    const again = await imageFactsFor(REF, rel, file);
    expect(again?.measuredAt).toBe(first?.measuredAt);
  });

  test("something that will not decode is null, never a throw", async () => {
    const { imageFactsFor } = await import("@/lib/sidecar");
    const rel = path.join("a-day", "not-an-image.jpg");
    const file = path.join(tripRoot(), "media", rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "this is not a photograph");
    expect(await imageFactsFor(REF, rel, file)).toBeNull();
  });
});

describe("filing a photograph out of the inbox", () => {
  /**
   * The whole point of the ticket: what the inbox collected is not rebuilt
   * from a narrower type at the trip, and no second file is left behind.
   */
  test("moves the one sidecar onto the trip with every key it had", async () => {
    const { storeInboxFile } = await import("@/lib/inbox");
    const { attachStagedFiles } = await import("@/lib/api/staged");

    const bytes = await jpeg(96, 72, 200);
    const { entry } = storeInboxFile(OWNER, "media", "IMG_4242.JPG", bytes, {
      description: "what the uploader said",
      tags: ["harbour"],
      lat: 47.1,
      lon: 8.2,
      takenAt: "2026-04-01T09:00:00Z",
      measuredFrom: "exif",
      source: "whatsapp",
    });

    const inboxSidecar = path.join(dir, OWNER, "inbox", "media", `${entry.id}.meta.json`);
    expect(fs.existsSync(inboxSidecar)).toBe(true);

    writeDayFixture(dir, OWNER, TRIP, { slug: "filed-day", date: "2026-04-03", title: "Filed" });
    const filed = await attachStagedFiles(OWNER, REF, "filed-day", [entry.id]);
    expect(filed.ok, JSON.stringify(filed)).toBe(true);
    if (!filed.ok) return;

    // Gone from the inbox — bytes and sidecar both.
    expect(fs.existsSync(inboxSidecar)).toBe(false);
    expect(fs.existsSync(path.join(dir, OWNER, "inbox", "media", entry.id))).toBe(false);

    const rel = filed.items[0].src.replace(`/media/${TRIP}/`, "");
    const { readSidecar, readTripSidecar } = await import("@/lib/sidecar");

    // Exactly one metadata file for this photograph, and it is the trip's.
    const dayMeta = path.join(tripRoot(), "meta", path.dirname(rel));
    expect(fs.readdirSync(dayMeta)).toEqual([`${path.basename(rel)}.meta.json`]);
    expect(fs.existsSync(path.join(tripRoot(), "media", `${rel}.meta.json`))).toBe(false);
    expect(readSidecar(path.join(tripRoot(), "media", `${rel}.meta.json`))).toBeNull();

    const carried = readTripSidecar(REF, rel);
    expect(carried?.description).toBe("what the uploader said");
    expect(carried?.tags).toEqual(["harbour"]);
    expect(carried?.lat).toBe(47.1);
    expect(carried?.lon).toBe(8.2);
    expect(carried?.takenAt).toBe("2026-04-01T09:00:00Z");
    expect(carried?.measuredFrom).toBe("exif");
    expect(carried?.source).toBe("whatsapp");
    // The full hash of the original bytes, kept from the inbox: a v1
    // derivative is named positionally and carries none of its own.
    expect(carried?.sha256).toBe(entry.sha256);
    // And the time it actually arrived, not the time it was filed.
    expect(carried?.uploadedAt).toBe(entry.uploadedAt);
    expect(carried?.trip).toBe(TRIP);
    expect(carried?.day).toBe("filed-day");
    // And what only the pixels say, measured at the door (B1865).
    expect(carried?.image?.width).toBe(96);
  });
});

describe("removing a filed photograph (v1)", () => {
  test("takes its sidecar and leaves no empty meta/<day> behind", async () => {
    const { storeUploads, deleteMediaFiles } = await import("@/lib/api/media");
    const { readTripSidecar } = await import("@/lib/sidecar");

    writeDayFixture(dir, OWNER, TRIP, { slug: "gone-day", date: "2026-04-02", title: "Gone" });
    const stored = await storeUploads(REF, "gone-day", [
      { filename: "IMG_7.JPG", bytes: await jpeg(60, 40, 90), source: "web" },
    ]);
    expect(stored.ok, JSON.stringify(stored)).toBe(true);
    if (!stored.ok) return;

    const rel = stored.items[0].src.replace(`/media/${TRIP}/`, "");
    expect(readTripSidecar(REF, rel)?.sha256).toHaveLength(64);
    expect(readTripSidecar(REF, rel)?.source).toBe("web");

    deleteMediaFiles(REF, stored.items[0]);

    expect(readTripSidecar(REF, rel)).toBeNull();
    expect(fs.existsSync(path.join(tripRoot(), "meta", "gone-day"))).toBe(false);
  });
});

describe("removing a filed photograph (v2)", () => {
  test("takes both sidecar locations and leaves no empty meta/<day> behind", async () => {
    const { storeMediaV2, deleteMediaV2 } = await import("@/lib/api/v2/media");
    const { mediaIntent } = await import("@/lib/api/v2/schemas/media");
    const { readTripSidecar } = await import("@/lib/sidecar");

    writeDayFixture(dir, OWNER, TRIP, { slug: "v2-day", date: "2026-04-04", title: "V2" });
    const stored = await storeMediaV2(
      OWNER,
      mediaIntent.parse({ kind: "photo", trip: TRIP, day: "2026-04-04-v2-day", caption: "said at the door" }),
      { filename: "IMG_8.JPG", bytes: await jpeg(70, 50, 30) },
      { uploadedBy: "ana@example.test", source: "api" },
    );
    expect(stored.ok, JSON.stringify(stored)).toBe(true);
    if (!stored.ok) return;

    const rel = stored.item.src.replace(`/media/${TRIP}/`, "");
    expect(readTripSidecar(REF, rel)?.uploadedBy).toBe("ana@example.test");
    expect(readTripSidecar(REF, rel)?.source).toBe("api");
    expect(readTripSidecar(REF, rel)?.sha256).toHaveLength(64);

    // And a stale legacy copy beside the derivative, which is what an older
    // journal still has on disk — both have to go.
    fs.writeFileSync(path.join(tripRoot(), "media", `${rel}.meta.json`), JSON.stringify({ caption: "old" }));

    expect(deleteMediaV2(OWNER, stored.item.src)).toEqual({ ok: true });
    expect(readTripSidecar(REF, rel)).toBeNull();
    expect(fs.existsSync(path.join(tripRoot(), "media", `${rel}.meta.json`))).toBe(false);
    expect(fs.existsSync(path.join(tripRoot(), "meta", "2026-04-04-v2-day"))).toBe(false);
  });

  test("what the door recorded reads back through the media list", async () => {
    const { storeMediaV2, listTripMediaV2 } = await import("@/lib/api/v2/media");
    const { mediaIntent } = await import("@/lib/api/v2/schemas/media");

    writeDayFixture(dir, OWNER, TRIP, { slug: "listed-day", date: "2026-04-05", title: "Listed" });
    const stored = await storeMediaV2(
      OWNER,
      mediaIntent.parse({ kind: "photo", trip: TRIP, day: "2026-04-05-listed-day", caption: "said at the door" }),
      { filename: "IMG_9.JPG", bytes: await jpeg(120, 90, 44) },
      { uploadedBy: "ana@example.test", source: "api" },
    );
    expect(stored.ok, JSON.stringify(stored)).toBe(true);
    if (!stored.ok) return;

    const listed = listTripMediaV2(OWNER, TRIP, { limit: 200 });
    const item = listed.items.find((one) => one.src === stored.item.src);
    expect(item?.uploadedBy).toBe("ana@example.test");
    expect(item?.source).toBe("api");
    expect(item?.width).toBe(120);
    expect(item?.height).toBe(90);
  });
});

describe("a media path that climbs out of the trip", () => {
  /**
   * A day's `src` is read off disk, and frontmatter is not something the API
   * writes — so a hand-edited one has to be contained here rather than
   * trusted. Only reachable by somebody who can already edit the file, which
   * is why it is asymmetry rather than a hole; a delete path is the wrong
   * place to leave one.
   */
  test("is refused by every trip-sidecar function", async () => {
    const { readTripSidecar, writeTripSidecar, removeTripSidecar } = await import("@/lib/sidecar");
    const outside = path.join(dir, OWNER, "trips", TRIP, "trip.md.meta.json");
    fs.writeFileSync(outside, JSON.stringify({ caption: "not a photograph's" }));
    const climbing = path.join("..", "..", "trip.md");

    expect(readTripSidecar(REF, climbing)).toBeNull();
    writeTripSidecar(REF, climbing, { caption: "overwritten" });
    removeTripSidecar(REF, climbing);

    expect(fs.existsSync(outside)).toBe(true);
    expect(JSON.parse(fs.readFileSync(outside, "utf8")).caption).toBe("not a photograph's");
  });
});
