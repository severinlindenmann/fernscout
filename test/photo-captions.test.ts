import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import matter from "gray-matter";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { storeUploads } from "@/lib/api/media";
import { attachGallery, editEntry } from "@/lib/api/entries";
import { getEntryBySlug } from "@/lib/entries";
import { captionsFor, CAPTION_MAX_CHARS } from "@/lib/validate/media";
import { validateEntryEdit } from "@/lib/validate/entry";

/**
 * B522 — the line under a photograph.
 *
 * `caption` was on `GalleryItem` from the beginning and rendered on the day
 * and in the lightbox, and there was no way to put one there: the upload
 * endpoint composed the `gallery:` block itself and `PATCH` spliced everything
 * except that block. So the only place to say who is in a picture was the
 * prose, detached from the picture.
 *
 * What these hold the line on:
 *
 *  - a caption sent with the files reaches the day's frontmatter and reads
 *    back;
 *  - correcting one later is a **splice**, not a rewrite — the prose, the
 *    title and the photographs' own `src`/`width`/`height` come back byte for
 *    byte, because a caption edit that could drop a photograph is a worse
 *    thing than no caption edit at all;
 *  - text from a request body cannot break the frontmatter it lands in.
 */

let dir: string;
const REF = "alex/asia-2026";
const DAY = "lanterns-of-hoi-an";
const tripPath = () => path.join(dir, "alex", "trips", "asia-2026");

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 8, g: 80, b: 120 } } })
    .jpeg()
    .toBuffer();
}

function writeDay() {
  fs.writeFileSync(
    path.join(tripPath(), "entries", `2026-08-26-${DAY}.md`),
    [
      "---",
      'title: "Lanterns of Hoi An"',
      'date: "2026-08-26"',
      'location: "Hoi An"',
      'country: "Vietnam"',
      "status: draft",
      "---",
      "",
      "Words the author wrote, and nobody else may touch.",
      "",
    ].join("\n"),
  );
}

const entryFile = () => path.join(tripPath(), "entries", `2026-08-26-${DAY}.md`);
const onDisk = () => fs.readFileSync(entryFile(), "utf8");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-captions-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.MEDIA_ORIGINALS_DIR;
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://e.test", defaultUser: "alex" },
      users: {},
      features: {},
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  fs.writeFileSync(
    path.join(tripPath(), "trip.md"),
    ["---", "id: asia-2026", 'title: "Asia"', 'start: "2026-08-01"', "visibility: public", "---", "", "Trip.", ""].join("\n"),
  );
  writeDay();
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a caption arrives with the photograph", () => {
  test("what was sent is what the day carries, and what reads back", async () => {
    const bytes = await jpeg();
    const written = await storeUploads(REF, DAY, [
      { filename: "one.jpg", bytes, caption: "The lanterns going up on the bridge" },
      { filename: "two.jpg", bytes },
    ]);
    if (!written.ok) throw new Error(JSON.stringify(written.problems));
    expect(attachGallery(REF, DAY, written.items)).toEqual({ ok: true, attached: 2 });

    const gallery = getEntryBySlug(REF, DAY, { includeDrafts: true })?.gallery ?? [];
    expect(gallery.map((item) => item.caption)).toEqual([
      "The lanterns going up on the bridge",
      undefined,
    ]);
  });

  /**
   * The bug this file was written to catch, and it was found *after* the
   * feature worked.
   *
   * A caption is the first value in a gallery item that comes straight from a
   * request body. `lib/ingest/entry.ts` had a private `yamlString` escaping
   * backslash and quote only — the third copy of that function in the
   * codebase, and the second one to be wrong in the way B204 already cost a
   * trip id. A vertical tab, form feed, escape or NUL in a caption wrote a day
   * that gray-matter could not parse: invisible at every reading path, and
   * undeletable through the API, because every delete path resolves the day
   * first. `galleryLines` now quotes with the shared `quoteScalar`, which
   * cannot emit invalid YAML whatever it is handed.
   *
   * `attachGallery` does *not* re-read what it wrote, the way `editEntry`
   * does — see B528.
   */
  test("a caption full of control characters still writes a day that reads back", async () => {
    const nasty = "bell\u0007 vertical\u000b form\u000c escape\u001b nul\u0000 end";
    const written = await storeUploads(REF, DAY, [
      { filename: "one.jpg", bytes: await jpeg(), caption: nasty },
    ]);
    if (!written.ok) throw new Error(JSON.stringify(written.problems));
    attachGallery(REF, DAY, written.items);

    // Parses at all — the property the private escaper took away — and says
    // what was sent, rather than a mangled copy of it.
    expect(matter(onDisk()).data.title).toBe("Lanterns of Hoi An");
    expect(getEntryBySlug(REF, DAY, { includeDrafts: true })?.gallery[0]?.caption).toBe(nasty);
  });

  test("a tab and a quote survive as themselves", async () => {
    const written = await storeUploads(REF, DAY, [
      { filename: "one.jpg", bytes: await jpeg(), caption: 'a\ttab and a "quote"' },
    ]);
    if (!written.ok) throw new Error(JSON.stringify(written.problems));
    attachGallery(REF, DAY, written.items);
    expect(getEntryBySlug(REF, DAY, { includeDrafts: true })?.gallery[0]?.caption).toBe(
      'a\ttab and a "quote"',
    );
  });
});

describe("captionsFor: positional, and refused rather than misaligned", () => {
  test("fewer captions than files is fine, and they stay in order", () => {
    expect(captionsFor(["  first  "], 2)).toEqual({ ok: true, captions: ["first"] });
    expect(captionsFor(undefined, 2)).toEqual({ ok: true, captions: [] });
  });

  test("more captions than files is refused", () => {
    const result = captionsFor(["a", "b", "c"], 2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.got).toContain("3 captions for 2 files");
  });

  test("something that is not a list of strings is refused", () => {
    expect(captionsFor({ "01.jpg": "hello" }, 1).ok).toBe(false);
    expect(captionsFor([42], 1).ok).toBe(false);
  });

  test("a caption longer than the ceiling is refused", () => {
    expect(captionsFor(["x".repeat(CAPTION_MAX_CHARS + 1)], 1).ok).toBe(false);
    expect(captionsFor(["x".repeat(CAPTION_MAX_CHARS)], 1).ok).toBe(true);
  });

  // Refused at the door rather than folded onto one line, the same choice
  // `singleLineProblem` makes for a title: a caption is somebody's words, and
  // a caller who sent two lines by accident wants to hear it now.
  test("a caption of two lines is refused, whichever break it uses", () => {
    expect(captionsFor(["two\nlines"], 1).ok).toBe(false);
    expect(captionsFor(["two\r\nlines"], 1).ok).toBe(false);
    expect(captionsFor(["two\rlines"], 1).ok).toBe(false);
  });
});

describe("correcting a caption is a splice, not a rewrite", () => {
  async function dayWithTwoPhotographs() {
    const bytes = await jpeg();
    const written = await storeUploads(REF, DAY, [
      { filename: "one.jpg", bytes, caption: "First, as told" },
      { filename: "two.jpg", bytes },
    ]);
    if (!written.ok) throw new Error(JSON.stringify(written.problems));
    attachGallery(REF, DAY, written.items);
    return getEntryBySlug(REF, DAY, { includeDrafts: true })!.gallery;
  }

  test("only the caption line changes — every other byte survives", async () => {
    const gallery = await dayWithTwoPhotographs();
    const before = onDisk();

    // Keyed by the src as the API hands it back, `/alex/media/…`, while the
    // file on disk carries `/media/…`.
    expect(gallery[0].src.startsWith("/alex/media/")).toBe(true);
    const result = editEntry(REF, DAY, { captions: { [gallery[0].src]: "First, corrected" } });
    expect(result).toEqual({ ok: true, slug: DAY, status: "draft" });

    const after = onDisk();
    expect(after).toBe(before.replace('caption: "First, as told"', 'caption: "First, corrected"'));
    // Said twice on purpose: the diff above is the property, and this is the
    // sentence a person would check by eye.
    expect(after).toContain("Words the author wrote, and nobody else may touch.");
    expect(after).toContain('title: "Lanterns of Hoi An"');
  });

  test("a photograph with no caption gains one, and nothing else moves", async () => {
    const gallery = await dayWithTwoPhotographs();
    editEntry(REF, DAY, { captions: { [gallery[1].src]: "Second, as told" } });

    const read = getEntryBySlug(REF, DAY, { includeDrafts: true })!.gallery;
    expect(read.map((item) => item.caption)).toEqual(["First, as told", "Second, as told"]);
    expect(read.map((item) => item.src)).toEqual(gallery.map((item) => item.src));
    expect(read.map((item) => item.width)).toEqual(gallery.map((item) => item.width));
  });

  test("an empty string removes a caption; an unknown src is ignored", async () => {
    const gallery = await dayWithTwoPhotographs();
    editEntry(REF, DAY, {
      captions: { [gallery[0].src]: "", "/alex/media/asia-2026/other-day/99.jpg": "nowhere" },
    });

    const read = getEntryBySlug(REF, DAY, { includeDrafts: true })!.gallery;
    expect(read.map((item) => item.caption)).toEqual([undefined, undefined]);
    expect(read).toHaveLength(2);
    expect(onDisk()).not.toContain("nowhere");
  });

  test("a day with no gallery at all is left alone rather than gaining a block", () => {
    const before = onDisk();
    const result = editEntry(REF, DAY, { captions: { "/alex/media/asia-2026/x/01.jpg": "hello" } });
    expect(result.ok).toBe(true);
    expect(onDisk()).toBe(before);
  });
});

describe("validateEntryEdit: a malformed captions field is refused, not ignored", () => {
  test("a list, a number, and an over-long caption", () => {
    expect(validateEntryEdit({ captions: ["a"] })).toHaveLength(1);
    expect(validateEntryEdit({ captions: { "/a/01.jpg": 4 } })).toHaveLength(1);
    expect(
      validateEntryEdit({ captions: { "/a/01.jpg": "x".repeat(CAPTION_MAX_CHARS + 1) } }),
    ).toHaveLength(1);
    expect(validateEntryEdit({ captions: { "/a/01.jpg": "fine" } })).toHaveLength(0);
  });
});
