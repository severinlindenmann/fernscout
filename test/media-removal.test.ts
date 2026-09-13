import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { attachGallery, detachGallery } from "@/lib/api/entries";
import { storeUploads, deleteMediaFiles } from "@/lib/api/media";
import { getEntryBySlug, AS_AUTHOR } from "@/lib/entries";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B605 — a photograph could be added to a day and never taken away, so the
 * only remedy for a duplicate or a wrong upload was a shell on the server.
 *
 * `app/api/v1/[user]/trips/[trip]/media/route.ts` — the route these tests
 * used to drive end to end — was deleted under B1613 (the v2 media door,
 * `test/api-v2-media.test.ts`, replaces it and covers the equivalent DELETE
 * behaviour there). What is left here is `detachGallery` and
 * `deleteMediaFiles` themselves — the two library functions v1's route sat
 * on top of, still real, still called by the v1 gallery-editing paths that
 * remain, and worth their own direct coverage regardless of which route
 * calls them — in particular the path-traversal refusals, which are
 * security properties of the function and not of the route glue around it.
 */

const OWNER = "ana";
const TRIP = "asia-2026";
const DAY = "lanterns-of-hoi-an";
const REF = `${OWNER}/${TRIP}`;

let dir: string;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-media-removal-"));
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
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
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
      features: { auth: { enabled: true } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  writeTripFixture(OWNER, {
    id: TRIP,
    title: "A trip",
    start: "2026-01-01",
    end: "2026-01-05",
    status: "past",
    visibility: "private",
  });

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

/** A fresh day, with one photograph already uploaded and attached, for each
 * test that needs one — so a failure in one test cannot leave the next with
 * stray media on disk or a gallery item it did not expect. */
async function freshDayWithPhoto(slug: string) {
  writeDayFixture(dir, OWNER, TRIP, {
    slug,
    date: "2026-01-01",
    title: slug,
    location: "Hoi An",
    country: "Vietnam",
    status: "draft",
    content: "Words.",
  });
  const uploaded = await storeUploads(REF, slug, [
    { filename: "a.jpg", bytes: await jpeg(400, 300) },
  ]);
  if (!uploaded.ok) throw new Error("expected the upload to land");
  const attached = attachGallery(REF, slug, uploaded.items);
  if (!attached.ok) throw new Error("expected the gallery attach to land");
  return uploaded.items[0];
}

afterEach(() => {
  fs.rmSync(path.join(tripPath(), "media"), { recursive: true, force: true });
  fs.rmSync(path.join(tripPath(), "originals"), { recursive: true, force: true });
  for (const file of fs.readdirSync(path.join(tripPath(), "entries"))) {
    fs.rmSync(path.join(tripPath(), "entries", file));
  }
});

describe("detachGallery: the library function directly", () => {
  test("an original kept under a different extension than its derivative is still found and removed", async () => {
    // A HEIC upload keeps its own extension in originals/ while the served
    // derivative is always a JPEG — the two file names disagree on purpose,
    // which is exactly the case deleteMediaFiles has to handle by stem, not
    // by name.
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "day-three",
      date: "2026-01-03",
      title: "day-three",
      status: "draft",
      content: "Words.",
      media: [{ src: `/media/${TRIP}/day-three/01.jpg`, type: "image" }],
    });
    const mediaDir = path.join(tripPath(), "media", "day-three");
    const originalsDir = path.join(tripPath(), "originals", "day-three");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.mkdirSync(originalsDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "01.jpg"), await jpeg(100, 100));
    fs.writeFileSync(path.join(originalsDir, "01.heic"), Buffer.from("not really a heic"));

    const result = detachGallery(REF, "day-three", [`/media/${TRIP}/day-three/01.jpg`]);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(mediaDir, "01.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(originalsDir, "01.heic"))).toBe(false);
    expect(getEntryBySlug(REF, "day-three", AS_AUTHOR)?.gallery).toHaveLength(0);
  });

  test("the prose and the day's other fields survive the removal", async () => {
    const item = await freshDayWithPhoto(DAY);
    const entryFile = path.join(tripPath(), "entries", `2026-01-01-${DAY}.json`);
    // The "unrelated frontmatter" half of this test's original premise is
    // gone on purpose. A day is a closed shape now and `dayFromJson`
    // (lib/api/v2/documents.ts) carries forward only the fields it names, so
    // a key the parser has never heard of does not survive a round trip —
    // which is the decision in `03-build-order.md` ("no unknown-key
    // preservation"), not an oversight. An unknown key is therefore asserted
    // to be DROPPED below rather than kept, so that if somebody ever adds
    // pass-through preservation this test says so.
    //
    // What the test was really protecting is untouched: removing a
    // photograph must not take the day's prose or its other fields with it.
    const before = JSON.parse(fs.readFileSync(entryFile, "utf8"));
    before.note = "a key the v2 day shape does not define";
    fs.writeFileSync(entryFile, JSON.stringify(before, null, 2) + "\n");

    const result = detachGallery(REF, DAY, [item.src]);
    expect(result.ok).toBe(true);

    const after = fs.readFileSync(entryFile, "utf8");
    expect(after).not.toContain("a key the v2 day shape does not define");
    expect(after).toContain('"location": "Hoi An"');
    expect(JSON.parse(after).title).toBe("lanterns-of-hoi-an");
    expect(JSON.parse(after).country).toBe("Vietnam");
    expect(after).not.toContain('"media"');
    expect(JSON.parse(after).content).toBe("Words.");
  });

  test("deleteMediaFiles never resolves a src claiming a different trip's directory", () => {
    // A gallery item's own src names a trip other than the one being edited —
    // hand-shaped, the way a person's own edit to their file could be. It
    // must be left alone rather than resolved into that other trip's media.
    fs.mkdirSync(path.join(dir, OWNER, "trips", "someone-elses-trip", "media", "day"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, OWNER, "trips", "someone-elses-trip", "media", "day", "01.jpg"),
      "not touched",
    );
    deleteMediaFiles(REF, {
      src: `/media/someone-elses-trip/day/01.jpg`,
      type: "image",
    } as never);
    expect(
      fs.existsSync(path.join(dir, OWNER, "trips", "someone-elses-trip", "media", "day", "01.jpg")),
    ).toBe(true);
  });

  test("deleteMediaFiles cannot climb out of the trip's originals directory", () => {
    // The derivative goes through `resolveMediaFile`, which refuses this; the
    // originals scan used to join `dirs` onto the originals root itself, so a
    // hand-edited `src:` with `..` in it named a directory outside the trip
    // and every stem-matching file in it was unlinked.
    const outside = path.join(dir, OWNER, "trips", "01.jpg");
    fs.writeFileSync(outside, "not touched");
    fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "originals"), { recursive: true });

    deleteMediaFiles(REF, {
      src: `/media/${TRIP}/../../01.jpg`,
      type: "image",
    } as never);

    expect(fs.existsSync(outside)).toBe(true);
  });
});
