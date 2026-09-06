import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { attachGallery, detachGallery } from "@/lib/api/entries";
import { storeUploads, deleteMediaFiles } from "@/lib/api/media";
import { getEntryBySlug, getTripStats, AS_AUTHOR } from "@/lib/entries";

/**
 * B605 — a photograph could be added to a day and never taken away, so the
 * only remedy for a duplicate or a wrong upload was a shell on the server.
 *
 * These drive the real `DELETE /api/v1/<user>/trips/<trip>/media` route, the
 * same way test/media-response-src.test.ts drives the POST — so the auth
 * gate, the request parsing and the response shape are all exercised, not
 * only the library function underneath.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "asia-2026";
const OTHER_TRIP = "europe-2027";
const DAY = "lanterns-of-hoi-an";
const REF = `${OWNER}/${TRIP}`;

let dir: string;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** A token scoped to a trip other than the one being written to — the
 * refusal `mayWriteTrip` gives when a trip-scoped token tries to widen. */
async function otherTripToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, "buddy@example.test", "agent", { trip: `${OWNER}/${OTHER_TRIP}` });
  const result = await verifyCode(OWNER, "buddy@example.test", code, "agent");
  if (!result.ok) throw new Error("no scoped token");
  return result.token;
}

async function deleteMedia(token: string, body: unknown) {
  const { DELETE } = await import("@/app/api/v1/[user]/trips/[trip]/media/route");
  const response = await DELETE(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${TRIP}/media`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP }) },
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
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
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.mkdirSync(path.join(dir, OWNER, "trips", OTHER_TRIP, "entries"), { recursive: true });
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
  for (const [id, tripPathHere] of [
    [TRIP, tripPath()],
    [OTHER_TRIP, path.join(dir, OWNER, "trips", OTHER_TRIP)],
  ] as const) {
    fs.writeFileSync(
      path.join(tripPathHere, "trip.md"),
      [
        "---",
        `id: "${id}"`,
        'title: "A trip"',
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
  }

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
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh day, with one photograph already uploaded and attached, for each
 * test that needs one — so a failure in one test cannot leave the next with
 * stray media on disk or a gallery item it did not expect. */
async function freshDayWithPhoto(slug: string) {
  fs.writeFileSync(
    path.join(tripPath(), "entries", `2026-01-01-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
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

describe("DELETE /api/v1/<user>/trips/<trip>/media", () => {
  test("removes a photograph: gallery shrinks, totalMedia drops, files gone from disk", async () => {
    await freshDayWithPhoto(DAY);
    const before = getTripStats(REF, AS_AUTHOR).totalMedia;
    expect(before).toBe(1);

    const served = path.join(tripPath(), "media", DAY, "01.jpg");
    const kept = path.join(tripPath(), "originals", DAY, "01.jpg");
    expect(fs.existsSync(served)).toBe(true);
    expect(fs.existsSync(kept)).toBe(true);

    const token = await ownerToken();
    const { status, body } = await deleteMedia(token, {
      day: DAY,
      src: [`/${OWNER}/media/${TRIP}/${DAY}/01.jpg`],
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.removed).toEqual([`/${OWNER}/media/${TRIP}/${DAY}/01.jpg`]);

    expect(getEntryBySlug(REF, DAY, AS_AUTHOR)?.gallery).toHaveLength(0);
    expect(getTripStats(REF, AS_AUTHOR).totalMedia).toBe(before - 1);
    expect(fs.existsSync(served)).toBe(false);
    expect(fs.existsSync(kept)).toBe(false);
  });

  test("a src the day does not carry is 400, naming it, and nothing is removed", async () => {
    await freshDayWithPhoto(DAY);
    const token = await ownerToken();
    const { status, body } = await deleteMedia(token, {
      day: DAY,
      src: [`/${OWNER}/media/${TRIP}/${DAY}/99.jpg`],
    });

    expect(status).toBe(400);
    expect(body.error).toBe("unknown_media");
    const problems = body.problems as { field: string; got: string }[];
    expect(problems.some((p) => p.got.includes("99.jpg"))).toBe(true);

    // The real photograph is untouched — a batch naming one bad src refuses
    // the whole call rather than removing the rest.
    expect(getEntryBySlug(REF, DAY, AS_AUTHOR)?.gallery).toHaveLength(1);
    expect(fs.existsSync(path.join(tripPath(), "media", DAY, "01.jpg"))).toBe(true);
  });

  test("a trip-scoped token for a different trip cannot widen into this one", async () => {
    await freshDayWithPhoto(DAY);
    const token = await otherTripToken();
    const { status } = await deleteMedia(token, {
      day: DAY,
      src: [`/${OWNER}/media/${TRIP}/${DAY}/01.jpg`],
    });
    // Same answer mayWriteTrip gives any trip a scoped token does not name:
    // unknown_trip, so a probe cannot tell "wrong trip" from "no such trip".
    expect(status).toBe(404);
    expect(getEntryBySlug(REF, DAY, AS_AUTHOR)?.gallery).toHaveLength(1);
  });

  test("an unknown day is 404", async () => {
    const token = await ownerToken();
    const { status, body } = await deleteMedia(token, {
      day: "no-such-day",
      src: ["/x/media/y/z/01.jpg"],
    });
    expect(status).toBe(404);
    expect(body.error).toBe("unknown_day");
  });

  test("no src at all is refused rather than a no-op 200", async () => {
    await freshDayWithPhoto(DAY);
    const token = await ownerToken();
    const { status, body } = await deleteMedia(token, { day: DAY, src: [] });
    expect(status).toBe(400);
    expect(body.error).toBe("expected_src");
  });

  test("a video's poster is deleted along with the clip", async () => {
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    if (!videoToolsAvailable()) return; // No ffmpeg on this machine.

    fs.writeFileSync(
      path.join(tripPath(), "entries", `2026-01-02-day-two.md`),
      ["---", 'title: "day-two"', 'date: "2026-01-02"', "status: draft", "---", "", "Words.", ""].join("\n"),
    );
    const source = path.join(dir, "clip.mp4");
    const { spawnSync } = await import("node:child_process");
    const made = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi",
      "-i", "testsrc=size=320x240:rate=10", "-t", "1", "-pix_fmt", "yuv420p", source]);
    if (made.status !== 0) throw new Error(`could not make a test clip: ${made.stderr}`);

    const uploaded = await storeUploads(REF, "day-two", [
      { filename: "clip.mp4", bytes: fs.readFileSync(source) },
    ]);
    if (!uploaded.ok) throw new Error("expected the clip to land");
    attachGallery(REF, "day-two", uploaded.items);

    const mediaDir = path.join(tripPath(), "media", "day-two");
    expect(fs.readdirSync(mediaDir).sort()).toEqual(["01-poster.jpg", "01.mp4"]);

    const token = await ownerToken();
    const item = uploaded.items[0];
    const { status } = await deleteMedia(token, {
      day: "day-two",
      src: [`/${OWNER}${item.src}`],
    });
    expect(status).toBe(200);
    expect(fs.existsSync(path.join(mediaDir, "01.mp4"))).toBe(false);
    expect(fs.existsSync(path.join(mediaDir, "01-poster.jpg"))).toBe(false);
  }, 30_000);
});

describe("detachGallery: the library function directly", () => {
  test("an original kept under a different extension than its derivative is still found and removed", async () => {
    // A HEIC upload keeps its own extension in originals/ while the served
    // derivative is always a JPEG — the two file names disagree on purpose,
    // which is exactly the case deleteMediaFiles has to handle by stem, not
    // by name.
    fs.writeFileSync(
      path.join(tripPath(), "entries", "2026-01-03-day-three.md"),
      ["---", 'title: "day-three"', 'date: "2026-01-03"', "status: draft", "---", "", "Words.", ""].join("\n"),
    );
    const mediaDir = path.join(tripPath(), "media", "day-three");
    const originalsDir = path.join(tripPath(), "originals", "day-three");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.mkdirSync(originalsDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "01.jpg"), await jpeg(100, 100));
    fs.writeFileSync(path.join(originalsDir, "01.heic"), Buffer.from("not really a heic"));
    const entryFile = path.join(tripPath(), "entries", "2026-01-03-day-three.md");
    fs.writeFileSync(
      entryFile,
      fs.readFileSync(entryFile, "utf8").replace(
        "status: draft\n",
        `status: draft\ngallery:\n  - src: "/media/${TRIP}/day-three/01.jpg"\n    type: "image"\n    width: 100\n    height: 100\n`,
      ),
    );

    const result = detachGallery(REF, "day-three", [`/media/${TRIP}/day-three/01.jpg`]);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(mediaDir, "01.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(originalsDir, "01.heic"))).toBe(false);
    expect(getEntryBySlug(REF, "day-three", AS_AUTHOR)?.gallery).toHaveLength(0);
  });

  test("the prose and unrelated frontmatter survive the removal", async () => {
    const item = await freshDayWithPhoto(DAY);
    const entryFile = path.join(tripPath(), "entries", `2026-01-01-${DAY}.md`);
    const before = fs.readFileSync(entryFile, "utf8").replace(
      'location: "Hoi An"',
      'location: "Hoi An"\n# a note nobody else should touch',
    );
    fs.writeFileSync(entryFile, before);

    const result = detachGallery(REF, DAY, [item.src]);
    expect(result.ok).toBe(true);

    const after = fs.readFileSync(entryFile, "utf8");
    expect(after).toContain("# a note nobody else should touch");
    expect(after).toContain('location: "Hoi An"');
    expect(after).not.toContain("gallery:");
    expect(after.trimEnd().endsWith("Words.")).toBe(true);
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
