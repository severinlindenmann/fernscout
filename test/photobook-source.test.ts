import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { buildBookSource, printSourceFor, resolvePrintFile } from "@/lib/photobook/source";
import { planBook } from "@/lib/photobook/plan";
import { defaultSpec, BOOK_SIZES } from "@/lib/photobook/spec";

/**
 * Which copy of a photograph a book is built from, and how the plan says so.
 *
 * Two tasks meet here. **B13**: the originals exist so a plate can be printed
 * at 300 dpi, and the photobook looked for a better version of `01.jpg` in the
 * one folder that holds the worse one — so every page of a 210mm book came out
 * at about 125 DPI. **B25**: the plan wrote absolute paths, which made the JSON
 * machine-specific, and on a maintainer's own laptop dragged a home directory
 * — and therefore a person's name — into a generated file the depersonalisation
 * test walks.
 */

let dir: string;
const REF = "alex/asia-2026";
const SPEC = defaultSpec(BOOK_SIZES["square-210"]);

const tripPath = () => path.join(dir, "alex", "trips", "asia-2026");

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 90, b: 140 } } })
    .jpeg()
    .toBuffer();
}

function write(file: string, contents: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

/** One day, one photograph per `names` entry, numbered as ingest numbers them. */
function writeDay(slug: string, date: string, images: { width: number; height: number }[]) {
  write(
    path.join(tripPath(), "entries", `${date}-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      'location: "Hoi An"',
      'country: "Vietnam"',
      'countryCode: "VN"',
      "lat: 15.88",
      "lng: 108.33",
      "gallery:",
      ...images.flatMap((image, i) => [
        `  - src: "/media/asia-2026/${slug}/${String(i + 1).padStart(2, "0")}.jpg"`,
        '    type: "image"',
        // Deliberately the *derivative's* numbers, which is what both writers
        // record. A book built from the original must not believe them.
        `    width: ${image.width}`,
        `    height: ${image.height}`,
      ]),
      "---",
      "",
      "Words about the day.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-book-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.MEDIA_ORIGINALS_DIR;
  write(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "alex" },
      users: {},
      features: {},
    }),
  );
  write(
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
  write(
    path.join(tripPath(), "trip.md"),
    [
      "---",
      "id: asia-2026",
      'title: "Asia"',
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("which copy of a photograph gets printed", () => {
  test("the kept original, not the 2000px copy the browser is served", async () => {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "originals", "day-one", "01.jpg"), await jpeg(4200, 2800));

    const source = buildBookSource(REF, { madeOn: "2026-02-01" });
    const photo = source.days[0].photos[0];

    expect(photo.file).toBe("alex/trips/asia-2026/originals/day-one/01.jpg");
    // The frontmatter said 2000×1333 — the derivative's numbers. Believing them
    // is what made every plate print soft.
    expect(photo.width).toBe(4200);
    expect(photo.height).toBe(2800);
    expect(photo.fallbackReason).toBeUndefined();
    expect(fs.existsSync(resolvePrintFile(photo.file))).toBe(true);
  });

  /**
   * The case a naive path join gets wrong. Ingest names the original after the
   * derivative but keeps the camera's own extension, so `01.jpg` in `media/` is
   * `01.jpeg`, `01.HEIC` or `01.cr2` next door.
   */
  test("matches on the basename, whatever extension the camera wrote", async () => {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "originals", "day-one", "01.JPEG"), await jpeg(3600, 2400));

    const photo = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0];
    expect(photo.file).toBe("alex/trips/asia-2026/originals/day-one/01.JPEG");
    expect(photo.width).toBe(3600);
  });

  test("an original the PDF writer cannot embed falls back, and says which", async () => {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    // A real HEIC, as far as this matters: bytes that are not a JPEG.
    write(path.join(tripPath(), "originals", "day-one", "01.HEIC"), Buffer.from("ftypheic…"));

    const source = buildBookSource(REF, { madeOn: "2026-02-01" });
    const photo = source.days[0].photos[0];

    expect(photo.file).toBe("alex/trips/asia-2026/media/day-one/01.jpg");
    expect(photo.width).toBe(2000);
    expect(photo.fallbackReason).toContain("01.HEIC");
    expect(photo.fallbackReason).toContain("not a JPEG");
    // Silently falling back is the thing this is not allowed to do.
    expect(source.notes?.map((n) => n.code)).toContain("no-original");
  });

  test("a JPEG original beside a HEIC one is preferred", async () => {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "originals", "day-one", "01.heic"), Buffer.from("not a jpeg"));
    write(path.join(tripPath(), "originals", "day-one", "01.jpg"), await jpeg(3000, 2000));

    const photo = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0];
    expect(photo.file).toBe("alex/trips/asia-2026/originals/day-one/01.jpg");
    expect(photo.width).toBe(3000);
  });

  test("a trip with no originals behaves as before, plus a warning saying so", async () => {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));

    const source = buildBookSource(REF, { madeOn: "2026-02-01" });
    const photo = source.days[0].photos[0];
    expect(photo.file).toBe("alex/trips/asia-2026/media/day-one/01.jpg");
    expect(photo.width).toBe(2000);
    expect(photo.fallbackReason).toBe("no original was kept for it");

    const book = planBook(source, SPEC);
    const missing = book.warnings.filter((w) => w.code === "no-original");
    expect(missing).toHaveLength(1);
    expect(missing[0].detail).toContain("no original was kept for it");

    // And the DPI warning names the reason rather than only the resolution, so
    // nobody goes hunting for a bigger photograph that does not exist.
    const soft = book.warnings.filter((w) => w.code === "low-resolution");
    expect(soft.length).toBeGreaterThan(0);
    expect(soft[0].detail).toContain("no original was kept for it");
  });

  test("printSourceFor leaves a src that escapes media/ alone", () => {
    const print = printSourceFor(REF, "/media/asia-2026/../../../etc/passwd");
    expect(print.fallbackReason).toBeUndefined();
    expect(path.isAbsolute(print.absolute)).toBe(true);
  });
});

describe("what the plan writes down", () => {
  async function seed() {
    writeDay("day-one", "2026-01-01", [
      { width: 2000, height: 1333 },
      { width: 1333, height: 2000 },
    ]);
    writeDay("day-two", "2026-01-02", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "media", "day-one", "02.jpg"), await jpeg(1333, 2000));
    write(path.join(tripPath(), "media", "day-two", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "originals", "day-one", "01.jpg"), await jpeg(4200, 2800));
    write(path.join(tripPath(), "originals", "day-two", "01.jpg"), await jpeg(4200, 2800));
  }

  /** B25's first two acceptance lines, together: the plan is the JSON the
   * script writes into `content/<user>/photobooks/`. */
  test("no absolute path reaches the plan JSON", async () => {
    await seed();
    const book = planBook(buildBookSource(REF, { madeOn: "2026-02-01" }), SPEC);
    const json = JSON.stringify({ spec: book.spec, warnings: book.warnings, volumes: book.volumes });

    expect(json).not.toContain(dir);
    expect(json).not.toContain(os.homedir());
    // Nothing that looks like a rooted path, in either separator.
    expect(json).not.toMatch(/"[A-Za-z]:[\\/]/);
    expect(json).not.toMatch(/"\/(Users|home|var|tmp|private)\//);
  });

  test("two runs of the same input produce byte-identical JSON", async () => {
    await seed();
    const plan = () =>
      JSON.stringify(planBook(buildBookSource(REF, { madeOn: "2026-02-01" }), SPEC), null, 2);
    expect(plan()).toBe(plan());
  });

  test("the recorded file is the one that was actually read", async () => {
    await seed();
    const book = planBook(buildBookSource(REF, { madeOn: "2026-02-01" }), SPEC);
    const files = book.volumes
      .flatMap((v) => v.pages)
      .flatMap((p) => (p.kind === "photos" ? p.placements.map((x) => x.photo.file) : []));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(path.isAbsolute(file), `${file} is absolute`).toBe(false);
      expect(fs.existsSync(resolvePrintFile(file)), `${file} does not exist`).toBe(true);
    }
    expect(files).toContain("alex/trips/asia-2026/originals/day-one/01.jpg");
  });
});

/**
 * B210. `MEDIA_ORIGINALS_DIR` is "another disk, usually", so the one file the
 * book actually prints can sit outside the content root — and a path measured
 * from a root that does not contain it is a `../` chain whose length says
 * where the content root happens to sit. The plan is a file somebody keeps.
 */
describe("originals kept outside the content root", () => {
  let vault: string;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-vault-"));
    process.env.MEDIA_ORIGINALS_DIR = vault;
  });

  afterEach(() => {
    delete process.env.MEDIA_ORIGINALS_DIR;
    fs.rmSync(vault, { recursive: true, force: true });
  });

  async function seedAcrossTwoDisks() {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    // Where `tripOriginalsDir` puts them: <root>/<user>/<trip>/…
    write(path.join(vault, "alex", "asia-2026", "day-one", "01.jpg"), await jpeg(4200, 2800));
  }

  test("the plan names the originals root rather than climbing out of the content one", async () => {
    await seedAcrossTwoDisks();
    const photo = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0];

    expect(photo.file).toBe("originals:alex/asia-2026/day-one/01.jpg");
    expect(photo.file).not.toContain("..");
    expect(photo.file).not.toContain(vault);
    expect(path.isAbsolute(photo.file)).toBe(false);
    // Still the original that gets printed, and still readable back.
    expect(photo.width).toBe(4200);
    expect(fs.existsSync(resolvePrintFile(photo.file))).toBe(true);
  });

  test("the same photograph gets the same handle from a content root somewhere else", async () => {
    await seedAcrossTwoDisks();
    const here = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0].file;

    // The identical content, at a different depth, against the same vault.
    const elsewhere = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-deep-")), "a/b/c");
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.cpSync(dir, elsewhere, { recursive: true });
    process.env.CONTENT_DIR = elsewhere;
    clearConfigCache();
    clearUserCache();

    const there = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0].file;
    expect(there).toBe(here);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  test("a plan built against a vault will not quietly resolve without one", async () => {
    await seedAcrossTwoDisks();
    const photo = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0];

    delete process.env.MEDIA_ORIGINALS_DIR;
    // Not a path under the content root that happens not to exist: that is how
    // a missing plate gets explained as a missing photograph.
    expect(() => resolvePrintFile(photo.file)).toThrow(/MEDIA_ORIGINALS_DIR/);
  });

  test("a vault inside the content root is still written the plain way", async () => {
    // Nothing is outside anything here, so nothing changes: the prefix exists
    // for the case where a relative path cannot be honest.
    process.env.MEDIA_ORIGINALS_DIR = path.join(dir, "vault");
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(dir, "vault", "alex", "asia-2026", "day-one", "01.jpg"), await jpeg(4200, 2800));

    const photo = buildBookSource(REF, { madeOn: "2026-02-01" }).days[0].photos[0];
    expect(photo.file).toBe("vault/alex/asia-2026/day-one/01.jpg");
    expect(fs.existsSync(resolvePrintFile(photo.file))).toBe(true);
  });
});

describe("what the source leaves out", () => {
  test("excludePhotos drops exactly the named photographs", async () => {
    writeDay("day-one", "2026-01-01", [
      { width: 2000, height: 1333 },
      { width: 1333, height: 2000 },
    ]);
    writeDay("day-two", "2026-01-02", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "media", "day-one", "02.jpg"), await jpeg(1333, 2000));
    write(path.join(tripPath(), "media", "day-two", "01.jpg"), await jpeg(2000, 1333));

    const all = buildBookSource(REF);
    const files = all.days.flatMap((d) => d.photos.map((p) => p.file));
    expect(files.length).toBeGreaterThan(1);

    const firstSrc = "/alex/media/asia-2026/day-one/01.jpg"; // the gallery src, not the print file
    const fewer = buildBookSource(REF, { excludePhotos: [firstSrc] });
    expect(fewer.days.flatMap((d) => d.photos).length).toBe(files.length - 1);
  });

  test("includeNames: false leaves the travellers out", async () => {
    writeDay("day-one", "2026-01-01", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));

    expect(buildBookSource(REF).travellers.length).toBeGreaterThan(0);
    expect(buildBookSource(REF, { includeNames: false }).travellers).toEqual([]);
  });

  test("excluding everything is a book with no photographs, not a crash", async () => {
    writeDay("day-one", "2026-01-01", [
      { width: 2000, height: 1333 },
      { width: 1333, height: 2000 },
    ]);
    writeDay("day-two", "2026-01-02", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "media", "day-one", "02.jpg"), await jpeg(1333, 2000));
    write(path.join(tripPath(), "media", "day-two", "01.jpg"), await jpeg(2000, 1333));

    const srcs = [
      "/alex/media/asia-2026/day-one/01.jpg",
      "/alex/media/asia-2026/day-one/02.jpg",
      "/alex/media/asia-2026/day-two/01.jpg",
    ];
    const empty = buildBookSource(REF, { excludePhotos: srcs });
    expect(empty.days.flatMap((d) => d.photos)).toEqual([]);
  });
});

describe("the web preview handle", () => {
  test("buildBookSource sets webSrc to the entry's own gallery src on every photograph", async () => {
    writeDay("day-one", "2026-01-01", [
      { width: 2000, height: 1333 },
      { width: 1333, height: 2000 },
    ]);
    writeDay("day-two", "2026-01-02", [{ width: 2000, height: 1333 }]);
    write(path.join(tripPath(), "media", "day-one", "01.jpg"), await jpeg(2000, 1333));
    write(path.join(tripPath(), "media", "day-one", "02.jpg"), await jpeg(1333, 2000));
    write(path.join(tripPath(), "media", "day-two", "01.jpg"), await jpeg(2000, 1333));
    // A kept original, so `file` carries the print path and cannot double as
    // the preview's src — the exact case webSrc exists for.
    write(path.join(tripPath(), "originals", "day-one", "01.jpg"), await jpeg(4200, 2800));

    const source = buildBookSource(REF, { madeOn: "2026-02-01" });
    const photos = source.days.flatMap((d) => d.photos);
    expect(photos.length).toBeGreaterThan(1);
    expect(photos.map((p) => p.webSrc)).toEqual([
      "/alex/media/asia-2026/day-one/01.jpg",
      "/alex/media/asia-2026/day-one/02.jpg",
      "/alex/media/asia-2026/day-two/01.jpg",
    ]);
    // Distinct from the print file wherever a kept original wins.
    const withOriginal = photos.find((p) => p.file.includes("originals/"));
    expect(withOriginal?.webSrc).toBe("/alex/media/asia-2026/day-one/01.jpg");
    expect(withOriginal?.webSrc).not.toBe(withOriginal?.file);
  });
});
