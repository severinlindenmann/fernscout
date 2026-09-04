import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { storeUploads } from "@/lib/api/media";
import { attachGallery } from "@/lib/api/entries";
import { getEntryBySlug } from "@/lib/entries";
import { MAX_ITEMS_PER_DAY, type Problem } from "@/lib/validate/media";

/**
 * Media arriving over the network.
 *
 * Until this existed, `npm run ingest` reading a local folder was the only way
 * a photograph reached a journal — so an agent working over HTTP could write a
 * day's words and nothing else.
 *
 * The property worth guarding is that **two** files come out of one going in.
 * A derivative is not a source: the site wants 2000px with no metadata, and a
 * photobook plate at 300 dpi wants roughly 2500×3500. Keeping only the first
 * throws away the one artefact the print pipeline needs, irrecoverably.
 */

let dir: string;
const REF = "alex/asia-2026";

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

const tripPath = () => path.join(dir, "alex", "trips", "asia-2026");

/** Photographs attach to a day, so the day has to exist first. */
function writeDay(slug: string, date: string, draft = false) {
  fs.writeFileSync(
    path.join(tripPath(), "entries", `${date}-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      'location: "Hoi An"',
      'country: "Vietnam"',
      ...(draft ? ["status: draft"] : []),
      "---",
      "",
      "Words.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-upload-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.MEDIA_ORIGINALS_DIR;
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://e.test", defaultUser: "alex" }, users: {}, features: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" },
      startLocation: "X", defaultLocale: "en", locales: ["en"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
  writeDay("lanterns-of-hoi-an", "2026-01-01");
  writeDay("day-one", "2026-01-02");
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The problem a test is about, wherever `storeUploads` happened to append it.
 *
 * `problems` is built by appending — `validateMediaBatch` first, then the
 * missing-ffmpeg case, then the per-day ceiling, then the journal byte quota —
 * and **nothing promises which of them fires**. `problems[0]` says where a
 * problem sits today, so a fixture that trips a second limit, or a check added
 * ahead of it, fails with a message about the wrong rule. The ceiling test did
 * fail exactly that way once, in a full run (B71).
 *
 * The whole array goes into the failure message, because which problem came
 * first is the answer to that question if it ever recurs.
 */
function only(problems: Problem[], what: string, match: (p: Problem) => boolean): Problem {
  const found = problems.filter(match);
  expect(
    found.length,
    `expected exactly one problem about ${what}, got:\n${JSON.stringify(problems, null, 2)}`,
  ).toBe(1);
  return found[0];
}

describe("storing an upload", () => {
  test("writes a resized derivative and keeps the original", async () => {
    const result = await storeUploads(REF, "lanterns-of-hoi-an", [
      { filename: "DSC_4471.jpg", bytes: await jpeg(4200, 2800) },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const served = path.join(tripPath(), "media", "lanterns-of-hoi-an", "01.jpg");
    const kept = path.join(tripPath(), "originals", "lanterns-of-hoi-an", "01.jpg");

    expect((await sharp(served).metadata()).width).toBe(2000);
    // Untouched: the same pixels that were sent, not a re-encode.
    expect((await sharp(kept).metadata()).width).toBe(4200);
    expect(result.items[0]).toMatchObject({ type: "image", width: 2000, height: 1333 });
  });

  /** The owner is prefixed at read time — that is what let the move to
   * multi-user rewrite no entry file. */
  test("the gallery src is trip-relative, with no username in it", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "a.jpg", bytes: await jpeg(800, 600) },
    ]);
    if (!result.ok) throw new Error("expected success");
    expect(result.items[0].src).toBe("/media/asia-2026/day-one/01.jpg");
  });

  /**
   * Two cameras produce IMG_0001.JPG on the same day about as often as not,
   * and a second upload to the same day must append rather than overwrite.
   */
  test("numbers from the next free index, so a second upload appends", async () => {
    await storeUploads(REF, "day-one", [{ filename: "a.jpg", bytes: await jpeg(400, 300) }]);
    const second = await storeUploads(REF, "day-one", [
      { filename: "a.jpg", bytes: await jpeg(400, 300) },
      { filename: "b.jpg", bytes: await jpeg(400, 300) },
    ]);
    if (!second.ok) throw new Error("expected success");
    expect(second.items.map((i) => i.src)).toEqual([
      "/media/asia-2026/day-one/02.jpg",
      "/media/asia-2026/day-one/03.jpg",
    ]);
    expect(fs.readdirSync(path.join(tripPath(), "media", "day-one")).sort()).toEqual([
      "01.jpg", "02.jpg", "03.jpg",
    ]);
  });

  test("MEDIA_ORIGINALS_DIR moves the originals off the content disk", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-vault-"));
    process.env.MEDIA_ORIGINALS_DIR = vault;
    try {
      await storeUploads(REF, "day-one", [{ filename: "a.jpg", bytes: await jpeg(400, 300) }]);
      expect(fs.readdirSync(path.join(vault, "alex", "asia-2026", "day-one"))).toEqual(["01.jpg"]);
      expect(fs.existsSync(path.join(tripPath(), "originals"))).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe("what it refuses", () => {
  test("a format sharp cannot read, naming the ones it can", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "notes.txt", bytes: Buffer.from("not an image") },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const format = only(result.problems, "notes.txt's format", (p) => p.field === "notes.txt.format");
    expect(format.got).toBe("txt");
    expect(format.expected).toContain("heic");
  });

  /** A refused batch must leave no half-imported day behind. */
  test("writes nothing at all when the batch is refused", async () => {
    await storeUploads(REF, "day-one", [
      { filename: "ok.jpg", bytes: await jpeg(400, 300) },
      { filename: "notes.txt", bytes: Buffer.from("x") },
    ]);
    expect(fs.existsSync(path.join(tripPath(), "media", "day-one"))).toBe(false);
    expect(fs.existsSync(path.join(tripPath(), "originals", "day-one"))).toBe(false);
  });

  test("the per-day ceiling counts what is already on disk", async () => {
    // One encode, reused. The loop below is the slowest thing in this file and
    // re-encoding the same 60px square forty times bought nothing.
    const bytes = await jpeg(60, 60);
    const one = () => [{ filename: "a.jpg", bytes }];

    for (let i = 0; i < MAX_ITEMS_PER_DAY; i++) {
      const landed = await storeUploads(REF, "day-one", one());
      expect(landed.ok, `upload ${i + 1} of ${MAX_ITEMS_PER_DAY} did not land`).toBe(true);
    }
    // Stated rather than assumed: the ceiling counts `readdirSync(mediaOut)`,
    // so a short write here would be a failure about the wrong thing.
    expect(fs.readdirSync(path.join(tripPath(), "media", "day-one"))).toHaveLength(
      MAX_ITEMS_PER_DAY,
    );

    const over = await storeUploads(REF, "day-one", one());
    expect(over.ok).toBe(false);
    if (over.ok) return;
    const ceiling = only(over.problems, "the per-day ceiling", (p) =>
      p.expected.includes(`at most ${MAX_ITEMS_PER_DAY} items in one day`),
    );
    expect(ceiling.got).toBe(`${MAX_ITEMS_PER_DAY + 1} items in this day`);
    // It says which day is full and by how much, which is what makes "use
    // another day" an instruction rather than a guess — B209.
    expect(ceiling.expected).toContain(`This day already holds ${MAX_ITEMS_PER_DAY}`);
    expect(ceiling.expected).toContain("another day");
  });

  /**
   * B209 — the pair, in one refusal.
   *
   * More items than a day may hold, sent in one call to an empty day, breaks
   * *both* rules: the request-level one in `validateMediaBatch` and the
   * day-level one here. They used to arrive with the identical `expected`
   * string, so the refusal read as one rule stated twice and neither remedy
   * was legible.
   *
   * Matched on text rather than on position, per B71. No image is decoded:
   * validation refuses the batch before anything is opened, so these are
   * bytes with the right extension and nothing else.
   */
  test("a batch bigger than a day says both what the request broke and what the day holds", async () => {
    const many = Array.from({ length: MAX_ITEMS_PER_DAY + 1 }, () => ({
      filename: "a.jpg",
      bytes: Buffer.from("not decoded — the batch is refused first"),
    }));

    const result = await storeUploads(REF, "day-one", many);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const request = only(result.problems, "the size of the request", (p) =>
      p.expected.includes("in one request"),
    );
    const day = only(result.problems, "what the day holds", (p) =>
      p.expected.includes("in one day"),
    );

    expect(request.expected).not.toBe(day.expected);
    expect(request.got).toBe(`${MAX_ITEMS_PER_DAY + 1} items in one request`);
    expect(day.got).toBe(`${MAX_ITEMS_PER_DAY + 1} items in this day`);
    // The remedy that does not work is refused in words rather than left to be
    // inferred: the day could not hold them however they are split.
    expect(request.expected).toContain("splitting this batch will not help");
    expect(day.expected).toContain("This day already holds 0");
  });

  test("an empty request, and a day slug that is not one", async () => {
    const empty = await storeUploads(REF, "day-one", []);
    expect(empty.ok).toBe(false);
    // B292: the `field` key already named it, and an agent read past that —
    // so the refusal also carries a sentence naming the form field.
    if (!empty.ok) expect(empty.problems[0].hint).toContain("files");
    expect((await storeUploads(REF, "///", [{ filename: "a.jpg", bytes: await jpeg(60, 60) }])).ok).toBe(false);
  });
});

/**
 * A file that only claims to be an image.
 *
 * Decoding is where that gives up, and it throws. Uncaught, it reached the
 * REST route as a bare 500 with an empty body — nothing for an agent to act
 * on.
 */
describe("a file that is not the image it says it is", () => {
  test("is refused with a readable problem, not a crash", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "holiday.jpg", bytes: Buffer.from("this is plain text, not a JPEG") },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const format = only(result.problems, "holiday.jpg's format", (p) =>
      p.field === "holiday.jpg.format",
    );
    expect(format.expected).toContain("heic");
  });

  test("does not leave a broken half-written day behind", async () => {
    await storeUploads(REF, "day-one", [
      { filename: "holiday.jpg", bytes: Buffer.from("not a JPEG") },
    ]);
    // Nothing servable was written: the derivative is what the site shows.
    expect(fs.existsSync(path.join(tripPath(), "media", "day-one", "01.jpg"))).toBe(false);
  });
});

/**
 * Photographs belong to a day, and the day decides who may see them.
 *
 * The upload endpoint used to take any slug at all, so a typo produced a
 * folder of public files attached to nothing — discoverable by guessing the
 * path, and cleaned up by nobody.
 */
describe("the day a photograph belongs to", () => {
  test("must exist", async () => {
    const result = await storeUploads(REF, "no-such-day", [
      { filename: "a.jpg", bytes: await jpeg(400, 300) },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const day = only(result.problems, "the day", (p) => p.field === "day");
    expect(day.expected).toContain("write the day first");
  });

  /** A day awaiting approval is the normal thing to attach photographs to. */
  test("may be a draft", async () => {
    writeDay("still-a-draft", "2026-01-05", true);
    const result = await storeUploads(REF, "still-a-draft", [
      { filename: "a.jpg", bytes: await jpeg(400, 300) },
    ]);
    expect(result.ok).toBe(true);
  });
});

/**
 * Video, which the limits table has always advertised and this path always
 * refused.
 *
 * Every upload was declared `kind: "image"`, so an `.mp4` was measured against
 * the image formats and came back as a broken photograph — a documented
 * feature that had never worked through this door, while ingest reading the
 * same file from a folder handled it.
 */
describe("video", () => {
  // The first request of the process to mention video pays for finding
  // ffmpeg — two bounded `-version` spawns — before it does anything else.
  // That is well under the default budget on a machine at rest and has been
  // over it on one running a build at the same time, which showed up here as
  // a timeout on the line below rather than as anything to do with video.
  test("a clip is judged as a clip, not as a broken photograph", async () => {
    writeDay("day-one", "2026-01-01");
    const result = await storeUploads(REF, "day-one", [
      { filename: "clip.mp4", bytes: Buffer.from("not really an mp4") },
    ]);
    expect(result.ok).toBe(false);
    const problems = (result as { problems: { field: string; expected: string }[] }).problems;
    // It may be refused for being unreadable, or for there being no ffmpeg.
    // What it must never be refused for is failing to be a JPEG.
    expect(problems.some((p) => /jpeg/.test(p.expected))).toBe(false);
  }, 30_000);

  /**
   * A file that is not really a video used to take seconds to refuse.
   *
   * ffprobe, handed something it cannot parse, falls back to waiting on
   * standard input — at nought per cent of a CPU. `spawnSync` leaves stdin as
   * an open pipe by default, so every malformed upload held a request open for
   * about four seconds (twenty, measured from a terminal, where stdin is a
   * tty). Closing it: 37 ms. That is a denial of service written in a default.
   *
   * The cap is set between those two numbers rather than near either: it is
   * checking that the wait is gone, not measuring ffprobe on this machine.
   *
   * The probe is timed rather than the whole upload, because an upload also
   * pays for finding ffmpeg — two bounded spawns, seconds of them on a loaded
   * machine — and that cost is not what the pipe fix was about. Timing the
   * request instead made this fail for a reason it does not describe.
   */
  test("and is refused promptly, rather than waiting on a pipe nobody writes to", async () => {
    const { probeVideo, videoToolsAvailable } = await import("@/lib/ingest/video");
    if (!videoToolsAvailable()) return; // Nothing to be slow about without ffprobe.

    const notAVideo = path.join(dir, "clip.mp4");
    fs.writeFileSync(notAVideo, "not really an mp4");

    const started = Date.now();
    expect(probeVideo(notAVideo)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 30_000);

  test("a photograph in the same request is still judged as a photograph", async () => {
    writeDay("day-one", "2026-01-01");
    const result = await storeUploads(REF, "day-one", [
      { filename: "photo.txt", bytes: Buffer.from("x") },
    ]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toMatch(/jpeg|png/);
  });

  test("a real clip is transcoded, kept, and given a poster", async () => {
    const { videoToolsAvailable } = await import("@/lib/ingest/video");
    if (!videoToolsAvailable()) return; // No ffmpeg here; the next test covers that.

    // A two-second clip, made by ffmpeg so the test does not ship a binary.
    const source = path.join(dir, "source.mp4");
    const { spawnSync } = await import("node:child_process");
    const made = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi",
      "-i", "testsrc=size=320x240:rate=10", "-t", "2", "-pix_fmt", "yuv420p", source]);
    if (made.status !== 0) throw new Error(`could not make a test clip: ${made.stderr}`);

    writeDay("day-one", "2026-01-01");
    const result = await storeUploads(REF, "day-one", [
      { filename: "clip.mp4", bytes: fs.readFileSync(source) },
    ]);
    expect(result.ok).toBe(true);

    const [item] = (result as { items: { type: string; poster?: string; src: string }[] }).items;
    expect(item.type).toBe("video");
    expect(item.src).toMatch(/\.mp4$/);
    expect(item.poster).toBeTruthy();

    // Both the served file and the original the caller sent.
    const served = path.join(tripPath(), "media", "day-one");
    expect(fs.readdirSync(served).sort()).toEqual(["01-poster.jpg", "01.mp4"]);
    expect(fs.readdirSync(path.join(tripPath(), "originals", "day-one"))).toEqual(["01.mp4"]);
  }, 30_000);
});

/**
 * A batch that fails halfway.
 *
 * "If any file in a batch is refused, nothing is written: fix it and send the
 * batch again" — that is what the guide promises, and it is the only advice
 * that can be given, because an agent has no way to tell which files landed.
 * The *validation* was all-or-nothing. The writing was not: the loop wrote
 * each file as it went and returned on the first one that would not decode,
 * leaving everything before it on disk. Following the advice then wrote those
 * again under fresh numbers, so the retry that was supposed to fix the day
 * duplicated half of it.
 */
describe("a batch that fails halfway", () => {
  test("writes nothing at all", async () => {
    writeDay("day-one", "2026-01-01");
    const result = await storeUploads(REF, "day-one", [
      { filename: "good.jpg", bytes: await jpeg(400, 300) },
      { filename: "broken.jpg", bytes: Buffer.from("not a jpeg at all") },
    ]);
    expect(result.ok).toBe(false);

    const served = path.join(tripPath(), "media", "day-one");
    const originals = path.join(tripPath(), "originals", "day-one");
    const held = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
    expect(held(served)).toEqual([]);
    expect(held(originals)).toEqual([]);
  });

  test("so the retry the error asks for cannot duplicate anything", async () => {
    writeDay("day-one", "2026-01-01");
    await storeUploads(REF, "day-one", [
      { filename: "good.jpg", bytes: await jpeg(400, 300) },
      { filename: "broken.jpg", bytes: Buffer.from("not a jpeg at all") },
    ]);
    // The person fixes the second file and sends the batch again, as told.
    const retry = await storeUploads(REF, "day-one", [
      { filename: "good.jpg", bytes: await jpeg(400, 300) },
      { filename: "fixed.jpg", bytes: await jpeg(400, 300) },
    ]);
    expect(retry.ok).toBe(true);
    expect(fs.readdirSync(path.join(tripPath(), "media", "day-one"))).toHaveLength(2);
  });

  test("and a batch that is entirely fine still lands", async () => {
    writeDay("day-one", "2026-01-01");
    const result = await storeUploads(REF, "day-one", [
      { filename: "a.jpg", bytes: await jpeg(400, 300) },
      { filename: "b.jpg", bytes: await jpeg(400, 300) },
    ]);
    expect(result.ok).toBe(true);
    expect(fs.readdirSync(path.join(tripPath(), "media", "day-one")).sort()).toEqual([
      "01.jpg",
      "02.jpg",
    ]);
  });
});

/**
 * The photographs end up **in the day**, not beside it.
 *
 * The endpoint used to write the files and hand back a `gallery:` block with
 * instructions to paste it into the entry. There was no call that could: a day
 * has POST, GET and DELETE and no PATCH. So an agent that wrote three days and
 * then uploaded to each got three days whose gallery was empty and five
 * photographs nothing pointed at, and the only way back was deleting the
 * drafts.
 */
/**
 * B30. An agent reported that the URL route "keeps no original", having sent
 * 3000px and read 2000px back. It was wrong — the original was always kept —
 * but nothing in the reply said so, and the guide promises a photobook is
 * printed from it. A promise the API makes and never evidences is one that
 * gets doubted.
 */
describe("what was kept, beside what is served", () => {
  test("reports the original's dimensions, not the derivative's", async () => {
    writeDay("day-one", "2026-01-01", true);
    const result = await storeUploads(REF, "day-one", [
      { filename: "big.jpg", bytes: await jpeg(3000, 2000) },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The served copy is resized…
    expect(result.items[0].width).toBe(2000);
    expect(result.items[0].height).toBe(1333);
    // …and the original is not. These are the numbers the caller sent, which
    // is the fact they are actually checking.
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]).toMatchObject({ filename: "big.jpg", width: 3000, height: 2000 });
    expect(result.kept[0].bytes).toBeGreaterThan(0);
  });

  test("the original really is on disk at full size — the claim being doubted", async () => {
    writeDay("day-one", "2026-01-01", true);
    await storeUploads(REF, "day-one", [
      { filename: "big.jpg", bytes: await jpeg(3000, 2000) },
    ]);

    const original = path.join(tripPath(), "originals", "day-one", "01.jpg");
    expect(fs.existsSync(original)).toBe(true);
    const meta = await sharp(original).metadata();
    expect(meta.width).toBe(3000);
    expect(meta.height).toBe(2000);
  });

  test("one entry per file, in the order they were sent", async () => {
    writeDay("day-one", "2026-01-01", true);
    const result = await storeUploads(REF, "day-one", [
      { filename: "a.jpg", bytes: await jpeg(2400, 1600) },
      { filename: "b.jpg", bytes: await jpeg(800, 600) },
    ]);
    if (!result.ok) throw new Error("expected the batch to land");
    expect(result.kept.map((k) => k.filename)).toEqual(["a.jpg", "b.jpg"]);
    // A source already under the cap is not enlarged, so kept and served match.
    expect(result.kept[1]).toMatchObject({ width: 800, height: 600 });
    expect(result.items[1]).toMatchObject({ width: 800, height: 600 });
  });
});

describe("attaching a gallery to the day", () => {
  test("puts what was uploaded into the entry that names it", async () => {
    writeDay("day-one", "2026-01-01", true);
    const result = await storeUploads(REF, "day-one", [
      { filename: "a.jpg", bytes: await jpeg(400, 300) },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(attachGallery(REF, "day-one", result.items)).toEqual({ ok: true, attached: 1 });

    const entry = getEntryBySlug(REF, "day-one", { includeDrafts: true });
    expect(entry?.gallery).toHaveLength(1);
    expect(entry?.gallery[0].width).toBe(400);
  });

  test("a second batch is added to the first, not instead of it", async () => {
    writeDay("day-one", "2026-01-01", true);
    for (const name of ["a.jpg", "b.jpg"]) {
      const batch = await storeUploads(REF, "day-one", [
        { filename: name, bytes: await jpeg(400, 300) },
      ]);
      if (batch.ok) attachGallery(REF, "day-one", batch.items);
    }
    expect(getEntryBySlug(REF, "day-one", { includeDrafts: true })?.gallery).toHaveLength(2);
  });

  test("the prose and the frontmatter around it are left exactly as they were", async () => {
    writeDay("day-one", "2026-01-01", true);
    const result = await storeUploads(REF, "day-one", [
      { filename: "a.jpg", bytes: await jpeg(400, 300) },
    ]);
    if (result.ok) attachGallery(REF, "day-one", result.items);

    const raw = fs.readFileSync(
      path.join(tripPath(), "entries", "2026-01-01-day-one.md"),
      "utf8",
    );
    expect(raw).toContain('location: "Hoi An"');
    expect(raw).toContain("status: draft");
    expect(raw.trimEnd().endsWith("Words.")).toBe(true);
  });

  test("a slug naming no entry is refused rather than guessed at", () => {
    expect(attachGallery(REF, "no-such-day", [{ src: "x", type: "image" }])).toEqual({
      ok: false,
      error: 'no entry "no-such-day" in this trip',
    });
  });

  test("an entry with no frontmatter is left alone and said so", () => {
    fs.writeFileSync(
      path.join(tripPath(), "entries", "2026-02-02-freeform.md"),
      "Just prose, written by hand.\n",
    );
    const result = attachGallery(REF, "freeform", [{ src: "x", type: "image" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no frontmatter block");
    // And the file is untouched.
    expect(
      fs.readFileSync(path.join(tripPath(), "entries", "2026-02-02-freeform.md"), "utf8"),
    ).toBe("Just prose, written by hand.\n");
  });
});
