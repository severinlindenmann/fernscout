import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * The sidecar a photograph carries is not the photograph — B1863.
 *
 * `/[user]/media/**` served any file under a trip's `media/`, and the `.meta.json`
 * written beside every v2 upload is such a file. It is in no gallery, so the
 * route's per-photograph label check never matched it and it fell through to
 * the *day's* visibility — nothing, for a published day. The result: the
 * uploader's original filename and caption were public for a photograph the
 * very same route correctly answered 404 for.
 *
 * Closed twice, on purpose, because the two halves close different things:
 *
 * - **By construction**, for anything written from now on: a sidecar lives
 *   under `trips/<trip>/meta/`, a sibling of `media/` that `resolveMediaFile`
 *   cannot reach — the same design `originals/` already relies on.
 * - **At the route**, for the 1,500+ sidecars an existing journal already has
 *   sitting in `media/`: a file whose extension maps to no media type is not
 *   something this route serves, and it is refused before it is read.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const CANARY = "SIDECAR-LEAK-CANARY";

/** Everything the route tests read: one public trip, one published day with a
 * private photograph in it, one day held back entirely. */
const SHOWN = "shown-2026";
/** Where an upload actually lands, to prove where the sidecar is written. */
const UPLOAD = "upload-2026";
/** The trip an `open-to-link` export is taken of. */
const SEEN = "seen-2026";

let dir: string;
let workDir: string;

const tripRootOf = (tripId: string) => path.join(dir, OWNER, "trips", tripId);

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** A file the route would happily serve if it served everything. */
function plantSidecar(file: string, caption: string) {
  write(file, JSON.stringify({ kind: "photo", canary: CANARY, filename: "IMG_9001.HEIC", caption }));
}

/** A JPEG's first four bytes, which is all `contentTypeFor` looks at. */
function plantPhoto(file: string) {
  write(file, "");
  fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
}

async function fetchMedia(segments: string[]) {
  const { GET } = await import("@/app/[user]/media/[...path]/route");
  return GET(
    new Request(`https://example.test/${OWNER}/media/${segments.join("/")}`),
    { params: Promise.resolve({ user: OWNER, path: segments }) } as never,
  );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sidecar-leak-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sidecar-leak-work-"));
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
    ownerEmail: OWNER_EMAIL,
    ownerName: "Ana Traveller",
    ownerNickname: "Ana",
  });
  if (!created.ok) throw new Error(created.message);

  // (a) and (b): a public, listed trip anybody may read.
  writeTripFixture(OWNER, {
    id: SHOWN,
    title: "Shown",
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "public",
    listed: true,
  });
  for (const [day, files] of [
    ["a-day", ["open.jpg", "held.jpg"]],
    ["held-day", ["whole.jpg"]],
  ] as const) {
    for (const file of files) {
      plantPhoto(path.join(tripRootOf(SHOWN), "media", day, file));
      // The legacy location, deliberately: this is what an existing journal
      // has on disk today, and it is exactly what must stop being served.
      plantSidecar(path.join(tripRootOf(SHOWN), "media", day, `${file}.meta.json`), `caption for ${file}`);
    }
  }
  writeDayFixture(dir, OWNER, SHOWN, {
    slug: "a-day",
    date: "2026-08-25",
    title: "A day",
    media: [
      { src: `/media/${SHOWN}/a-day/open.jpg` },
      { src: `/media/${SHOWN}/a-day/held.jpg`, visibility: "private" },
    ],
  });
  writeDayFixture(dir, OWNER, SHOWN, {
    slug: "held-day",
    date: "2026-08-26",
    title: "Held back",
    visibility: "private",
    media: [{ src: `/media/${SHOWN}/held-day/whole.jpg` }],
  });

  // (c): a trip to upload into.
  writeTripFixture(OWNER, {
    id: UPLOAD,
    title: "Upload",
    start: "2026-01-01",
    end: "2026-01-10",
    visibility: "private",
  });

  // (d): a public trip with one held-back photograph, sidecars in both places.
  writeTripFixture(OWNER, {
    id: SEEN,
    title: "Seen",
    start: "2026-03-01",
    end: "2026-03-02",
    visibility: "public",
    listed: true,
  });
  for (const file of ["open.jpg", "held.jpg"]) {
    plantPhoto(path.join(tripRootOf(SEEN), "media", "a-day", file));
    plantSidecar(path.join(tripRootOf(SEEN), "media", "a-day", `${file}.meta.json`), `legacy ${file}`);
    plantSidecar(path.join(tripRootOf(SEEN), "meta", "a-day", `${file}.meta.json`), `current ${file}`);
  }
  writeDayFixture(dir, OWNER, SEEN, {
    slug: "a-day",
    date: "2026-03-01",
    title: "A day",
    media: [
      { src: `/media/${SEEN}/a-day/open.jpg` },
      { src: `/media/${SEEN}/a-day/held.jpg`, visibility: "private" },
    ],
  });
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("the media route, asked for a sidecar with no credential", () => {
  test("a private photograph's sidecar on a published day is not served", async () => {
    const photo = await fetchMedia([SHOWN, "a-day", "held.jpg"]);
    expect(photo.status).toBe(404);

    const sidecar = await fetchMedia([SHOWN, "a-day", "held.jpg.meta.json"]);
    expect(sidecar.status).toBe(404);
    expect(await sidecar.text()).not.toContain(CANARY);
  });

  test("a held-back day's sidecar is not served either", async () => {
    const photo = await fetchMedia([SHOWN, "held-day", "whole.jpg"]);
    expect(photo.status).toBe(404);

    const sidecar = await fetchMedia([SHOWN, "held-day", "whole.jpg.meta.json"]);
    expect(sidecar.status).toBe(404);
    expect(await sidecar.text()).not.toContain(CANARY);
  });

  /**
   * And the visible photograph's sidecar too. The route serves photographs;
   * `application/octet-stream` means "not a media type this route serves",
   * and a sidecar is never a thing to hand to a stranger whatever the
   * picture beside it is labelled.
   */
  test("even a public photograph's sidecar is not a media file", async () => {
    expect((await fetchMedia([SHOWN, "a-day", "open.jpg"])).status).toBe(200);
    expect((await fetchMedia([SHOWN, "a-day", "open.jpg.meta.json"])).status).toBe(404);
  });

  /** `.fingerprints/` and friends: a dotfile directory is bookkeeping, never
   * something to serve. */
  test("a dotfile path is refused", async () => {
    write(path.join(tripRootOf(SHOWN), "media", ".fingerprints", "index.json"), `{"x":"${CANARY}"}`);
    const response = await fetchMedia([SHOWN, ".fingerprints", "index.json"]);
    expect(response.status).toBe(404);
  });
});

describe("where an upload writes its sidecar", () => {
  test("under meta/, never under media/, and the caption still reads back", async () => {
    const { storeMediaV2, listTripMediaV2 } = await import("@/lib/api/v2/media");
    const { mediaIntent } = await import("@/lib/api/v2/schemas/media");

    const bytes = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 3, g: 9, b: 7 } } })
      .jpeg()
      .toBuffer();
    const stored = await storeMediaV2(
      OWNER,
      mediaIntent.parse({
        kind: "photo",
        trip: UPLOAD,
        caption: "a real caption",
        declined: { day: "not the point of this test" },
      }),
      { filename: "IMG_9001.HEIC.jpg", bytes },
    );
    expect(stored.ok, JSON.stringify(stored)).toBe(true);
    if (!stored.ok) return;

    const relPath = stored.item.src.replace(/^\/media\/[^/]+\//, "");
    expect(fs.existsSync(path.join(tripRootOf(UPLOAD), "media", `${relPath}.meta.json`))).toBe(false);
    expect(fs.existsSync(path.join(tripRootOf(UPLOAD), "meta", `${relPath}.meta.json`))).toBe(true);

    const listed = listTripMediaV2(OWNER, UPLOAD, { limit: 50 });
    expect(listed.items.find((i) => i.src === stored.item.src)?.caption).toBe("a real caption");
  });

  test("a sidecar still sitting in media/ is read when meta/ has none", async () => {
    const { listTripMediaV2 } = await import("@/lib/api/v2/media");
    const listed = listTripMediaV2(OWNER, SHOWN, { limit: 50 });
    const held = listed.items.find((i) => i.src.endsWith("a-day/held.jpg"));
    expect(held?.caption).toBe("caption for held.jpg");
  });
});

describe("an owner's own export", () => {
  test("carries the sidecars — they are the owner's content, not a leak to them", async () => {
    const { buildUserExportZipBuffer } = await import("@/lib/exportZip");
    const buffer = await buildUserExportZipBuffer(OWNER, "all");
    const zipPath = path.join(workDir, "owner.zip");
    fs.writeFileSync(zipPath, buffer);
    const extracted = path.join(workDir, "owner-restored");
    fs.mkdirSync(extracted, { recursive: true });
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", extracted]);

    const at = (...rest: string[]) => path.join(extracted, "trips", SEEN, ...rest);
    // Both photographs, held back or not, and the sidecar of each.
    expect(fs.existsSync(at("meta", "a-day", "open.jpg.meta.json"))).toBe(true);
    expect(fs.existsSync(at("meta", "a-day", "held.jpg.meta.json"))).toBe(true);
    expect(fs.existsSync(at("media", "a-day", "held.jpg"))).toBe(true);
  });
});

describe("an open-to-link export", () => {
  test("carries no sidecar, in either location, for a photograph it drops", async () => {
    const { buildUserExportZipBuffer } = await import("@/lib/exportZip");
    const buffer = await buildUserExportZipBuffer(OWNER, "open-to-link");
    const zipPath = path.join(workDir, "open-to-link.zip");
    fs.writeFileSync(zipPath, buffer);
    const extracted = path.join(workDir, "open-to-link-restored");
    fs.mkdirSync(extracted, { recursive: true });
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", extracted]);

    const at = (...rest: string[]) => path.join(extracted, "trips", SEEN, ...rest);

    expect(fs.existsSync(at("media", "a-day", "held.jpg"))).toBe(false);
    expect(fs.existsSync(at("media", "a-day", "held.jpg.meta.json"))).toBe(false);
    expect(fs.existsSync(at("meta", "a-day", "held.jpg.meta.json"))).toBe(false);

    // And the photograph anybody may see keeps its own, in both places it
    // could be sitting — this is an export of the owner's content, not a
    // redaction of it.
    expect(fs.existsSync(at("media", "a-day", "open.jpg"))).toBe(true);
    expect(fs.existsSync(at("meta", "a-day", "open.jpg.meta.json"))).toBe(true);
  });
});

describe("renaming a day", () => {
  /**
   * The sidecars used to ride along inside `media/<slug>`, so moving that
   * folder moved them. Now they have their own `meta/<slug>` and it has to be
   * moved too, or every caption and original filename the day carries is
   * orphaned by a rename — B1863.
   */
  test("takes the day's sidecars with it", async () => {
    const { renameDayMedia } = await import("@/lib/api/media");
    const { tripSidecarPath } = await import("@/lib/media");

    writeTripFixture(OWNER, {
      id: "rename-2026",
      title: "Rename",
      start: "2026-05-01",
      end: "2026-05-02",
      visibility: "private",
    });
    const ref = `${OWNER}/rename-2026`;
    plantPhoto(path.join(tripRootOf("rename-2026"), "media", "before", "01.jpg"));
    plantSidecar(tripSidecarPath(ref, path.join("before", "01.jpg")), "moves with the day");

    const moved = renameDayMedia(ref, "before", "after");
    expect(moved.ok, JSON.stringify(moved)).toBe(true);

    expect(fs.existsSync(tripSidecarPath(ref, path.join("before", "01.jpg")))).toBe(false);
    expect(fs.existsSync(tripSidecarPath(ref, path.join("after", "01.jpg")))).toBe(true);
    expect(fs.existsSync(path.join(tripRootOf("rename-2026"), "media", "after", "01.jpg"))).toBe(true);
  });
});

/**
 * Deleting a photograph deletes its sidecar — B1877, raised by B1863's own
 * security review.
 *
 * Four paths can make a photograph go away, and each is asserted here even
 * where it was already right: these are the assertions that keep it right
 * when the sidecar stops holding a filename and starts holding the rest of
 * what is known about the picture.
 */
describe("deleting a photograph", () => {
  /** A trip with one photograph and a sidecar in *both* places, since an
   * existing journal has legacy ones and new uploads have current ones. */
  function plantDeletable(tripId: string, slug: string, file: string) {
    writeTripFixture(OWNER, {
      id: tripId,
      title: tripId,
      start: "2026-06-01",
      end: "2026-06-02",
      visibility: "private",
    });
    const ref = `${OWNER}/${tripId}`;
    const rel = path.join(slug, file);
    plantPhoto(path.join(tripRootOf(tripId), "media", rel));
    plantSidecar(path.join(tripRootOf(tripId), "media", `${rel}.meta.json`), "legacy");
    plantSidecar(path.join(tripRootOf(tripId), "meta", `${rel}.meta.json`), "current");
    writeDayFixture(dir, OWNER, tripId, {
      slug,
      date: "2026-06-01",
      title: "A day",
      media: [{ src: `/media/${tripId}/${slug}/${file}` }],
    });
    return {
      ref,
      src: `/media/${tripId}/${slug}/${file}`,
      photo: path.join(tripRootOf(tripId), "media", rel),
      legacy: path.join(tripRootOf(tripId), "media", `${rel}.meta.json`),
      current: path.join(tripRootOf(tripId), "meta", `${rel}.meta.json`),
    };
  }

  test("through the v1 path, nothing is left at either location", async () => {
    const { detachGallery } = await import("@/lib/api/entries");
    const planted = plantDeletable("v1-delete-2026", "a-day", "01.jpg");

    const result = detachGallery(planted.ref, "a-day", [planted.src]);
    expect(result.ok, JSON.stringify(result)).toBe(true);

    expect(fs.existsSync(planted.photo)).toBe(false);
    expect(fs.existsSync(planted.legacy)).toBe(false);
    expect(fs.existsSync(planted.current)).toBe(false);
  });

  test("through the v2 path, nothing is left at either location", async () => {
    const { deleteMediaV2 } = await import("@/lib/api/v2/media");
    const planted = plantDeletable("v2-delete-2026", "a-day", "01.jpg");

    const result = deleteMediaV2(OWNER, planted.src);
    expect(result.ok, JSON.stringify(result)).toBe(true);

    expect(fs.existsSync(planted.photo)).toBe(false);
    expect(fs.existsSync(planted.legacy)).toBe(false);
    expect(fs.existsSync(planted.current)).toBe(false);
  });

  /**
   * Deleting a *day* deliberately leaves the photographs on disk — an entry
   * can be written again around the same pictures, and a deleted original
   * cannot be recovered (`deleteEntry`'s own doc comment). The sidecar has to
   * follow that rule rather than either one of the other two: it stays
   * exactly as long as the photograph it describes does.
   */
  test("a day deletion keeps the photograph, so it keeps the sidecars too", async () => {
    const { deleteEntry } = await import("@/lib/api/entries");
    const planted = plantDeletable("day-delete-2026", "a-day", "01.jpg");

    const result = deleteEntry(planted.ref, "a-day", { allowPublished: true });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    expect(fs.existsSync(planted.photo)).toBe(true);
    expect(fs.existsSync(planted.legacy)).toBe(true);
    expect(fs.existsSync(planted.current)).toBe(true);
  });

  /** A trip takes its folder with it, and `meta/` is inside that folder. */
  test("a trip deletion takes meta/ with the rest of the trip", async () => {
    const { deleteTrip } = await import("@/lib/deletions");
    const planted = plantDeletable("trip-delete-2026", "a-day", "01.jpg");

    await deleteTrip(OWNER, "trip-delete-2026", OWNER_EMAIL);

    expect(fs.existsSync(tripRootOf("trip-delete-2026"))).toBe(false);
    expect(fs.existsSync(planted.current)).toBe(false);
  });
});
