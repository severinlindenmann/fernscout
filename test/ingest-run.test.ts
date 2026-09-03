import { afterEach, beforeEach, describe, expect, test } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";
import { ingest } from "@/lib/ingest";
import { readExif } from "@/lib/ingest/exif";
import { geodataAvailable } from "@/lib/ingest/geo";
import { appendGallery, entryFileName, renderEntry } from "@/lib/ingest/entry";
import { slugify } from "@/lib/slug.ts";
import { videoToolsAvailable } from "@/lib/ingest/video";
import { writePhoto } from "./support/exif-jpeg";

const USER = "traveller";
const TRIP = "test-trip";

let root: string;
let source: string;
let previousContentDir: string | undefined;

const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const CHIANG_MAI = { lat: 18.7883, lng: 98.9853 };

function tripDir(): string {
  return path.join(root, USER, "trips", TRIP);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ingest-test-"));
  source = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-ingest-src-"));
  fs.mkdirSync(tripDir(), { recursive: true });
  fs.writeFileSync(
    path.join(root, USER, "config.json"),
    JSON.stringify({
      title: "A Test Site",
      baseCurrency: "CHF",
      owner: { name: "A Test Person", nickname: "A" },
    }),
  );
  fs.writeFileSync(
    path.join(tripDir(), "trip.md"),
    `---\nid: "${TRIP}"\ntitle: "A Test Trip"\nstart: "2026-08-01"\nend: "2026-09-01"\n---\n`,
  );
  previousContentDir = process.env.CONTENT_DIR;
  process.env.CONTENT_DIR = root;
});

afterEach(() => {
  if (previousContentDir === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = previousContentDir;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(source, { recursive: true, force: true });
});

/** A fingerprint of everything the trip folder holds, used to prove that a
 * second import changes nothing at all. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        out[path.relative(dir, full)] = crypto
          .createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex");
      }
    }
  };
  walk(dir);
  return out;
}

async function photo(
  name: string,
  seed: number,
  takenAt: string,
  where?: { lat: number; lng: number },
  size?: { width: number; height: number },
) {
  await writePhoto(path.join(source, name), seed, { takenAt, ...where }, size);
}

function run(options: Partial<Parameters<typeof ingest>[0]> = {}) {
  return ingest({ username: USER, tripId: TRIP, source, ...options });
}

describe("a day in, an entry out", () => {
  beforeEach(async () => {
    await photo("a.jpg", 1, "2026-08-14 09:12:00", BANGKOK);
    await photo("b.jpg", 2, "2026-08-14 09:40:00", BANGKOK);
    await photo("c.jpg", 3, "2026-08-14 10:05:00", BANGKOK);
  });

  test("writes one entry with the day's photographs", async () => {
    const result = await run();
    expect(result.entries).toHaveLength(1);
    expect(result.imported).toBe(3);
    expect(result.failed).toEqual([]);

    const files = fs.readdirSync(path.join(tripDir(), "entries"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^2026-08-14-.*\.md$/);
  });

  test("frontmatter carries date, time, coordinates and sizes", async () => {
    await run();
    const file = fs.readdirSync(path.join(tripDir(), "entries"))[0];
    const { data } = matter(fs.readFileSync(path.join(tripDir(), "entries", file), "utf8"));

    expect(data.date).toBe("2026-08-14");
    expect(data.time).toBe("09:12");
    expect(data.lat).toBeCloseTo(BANGKOK.lat, 3);
    expect(data.lng).toBeCloseTo(BANGKOK.lng, 3);
    expect(data.gallery).toHaveLength(3);
    for (const item of data.gallery) {
      expect(item.type).toBe("image");
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });

  test("media paths stay trip-relative, with no username in them", async () => {
    // lib/entries.ts prefixes the owner at read time. A username written here
    // would come out as /alice/media/alice/… on the page.
    await run();
    const file = fs.readdirSync(path.join(tripDir(), "entries"))[0];
    const { data } = matter(fs.readFileSync(path.join(tripDir(), "entries", file), "utf8"));
    for (const item of data.gallery) {
      expect(item.src).toMatch(new RegExp(`^/media/${TRIP}/`));
      expect(item.src).not.toContain(USER);
    }
  });

  test("the files named in frontmatter are on disk and carry no GPS", async () => {
    await run();
    const file = fs.readdirSync(path.join(tripDir(), "entries"))[0];
    const { data } = matter(fs.readFileSync(path.join(tripDir(), "entries", file), "utf8"));
    for (const item of data.gallery) {
      const onDisk = path.join(tripDir(), "media", item.src.replace(`/media/${TRIP}/`, ""));
      expect(fs.existsSync(onDisk)).toBe(true);
      const exif = readExif(new Uint8Array(fs.readFileSync(onDisk)));
      expect(exif.lat).toBeUndefined();
      expect(exif.lng).toBeUndefined();
    }
  });

  /**
   * A fresh entry's body is "write the day here". Ingest is one of the ways an
   * agent creates an entry — there is a skill for it — and everything an agent
   * creates is a draft, so the placeholder must not be on the site while it is
   * still a placeholder.
   */
  test("what it writes is a draft, and so invisible", async () => {
    const result = await run();
    const file = result.entries[0].file;
    expect(fs.readFileSync(file, "utf8")).toContain("status: draft");

    const { getAllEntries } = await import("@/lib/entries");
    expect(getAllEntries(`${USER}/${TRIP}`)).toEqual([]);
  });

  test("the entry reads back through the site's own content model once published", async () => {
    const result = await run();
    const file = result.entries[0].file;
    // What a person does when the words are written.
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: draft\n/m, ""));

    const { getAllEntries } = await import("@/lib/entries");
    const entries = getAllEntries(`${USER}/${TRIP}`);
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe("2026-08-14");
    expect(entries[0].gallery).toHaveLength(3);
    // Read back, the owner is prefixed — which is the proof that what ingest
    // wrote was in the shape lib/entries.ts expects.
    expect(entries[0].gallery[0].src).toMatch(new RegExp(`^/${USER}/media/${TRIP}/`));
  });
});

describe("importing the same folder twice", () => {
  beforeEach(async () => {
    const size = { width: 1200, height: 900 };
    await photo("a.jpg", 4, "2026-08-15 09:12:00", BANGKOK, size);
    await photo("b.jpg", 5, "2026-08-15 09:40:00", BANGKOK, size);
  });

  test("changes nothing", async () => {
    await run();
    const before = snapshot(tripDir());

    const second = await run();
    expect(second.imported).toBe(0);
    expect(second.entries).toEqual([]);
    expect(second.skipped).toHaveLength(2);
    expect(snapshot(tripDir())).toEqual(before);
  });

  test("a re-export of the same photo is caught too", async () => {
    await run();
    const before = snapshot(tripDir());

    // Same photograph, different bytes: a smaller, lower-quality export of the
    // kind osxphotos or a messaging app produces. The checksum misses this and
    // the perceptual hash does not.
    const sharp = (await import("sharp")).default;
    const original = fs.readFileSync(path.join(source, "a.jpg"));
    fs.rmSync(path.join(source, "b.jpg"));
    fs.writeFileSync(
      path.join(source, "a.jpg"),
      await sharp(original).resize(400).jpeg({ quality: 45 }).toBuffer(),
    );

    const second = await run();
    expect(second.imported).toBe(0);
    expect(snapshot(tripDir())).toEqual(before);
  });

  test("--force imports them anyway", async () => {
    await run();
    const second = await run({ force: true });
    expect(second.imported).toBe(2);
  });

  test("genuinely new photos from the same day join the existing entry", async () => {
    await run();
    const file = path.join(tripDir(), "entries", fs.readdirSync(path.join(tripDir(), "entries"))[0]);

    // The author has already written the day up by the time the second batch
    // arrives, so their prose and captions have to survive.
    const edited = fs
      .readFileSync(file, "utf8")
      .replace(/^_Write the day.*$/m, "The market smelled of charcoal and lime.");
    fs.writeFileSync(file, edited);

    fs.rmSync(path.join(source, "a.jpg"));
    fs.rmSync(path.join(source, "b.jpg"));
    await photo("c.jpg", 6, "2026-08-15 10:30:00", BANGKOK);

    const second = await run();
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].created).toBe(false);

    const after = fs.readFileSync(file, "utf8");
    expect(after).toContain("The market smelled of charcoal and lime.");
    expect(matter(after).data.gallery).toHaveLength(3);
  });
});

describe("dry run", () => {
  test("reports the plan and writes nothing", async () => {
    await photo("a.jpg", 7, "2026-08-16 09:12:00", BANGKOK);
    const before = snapshot(tripDir());
    const result = await run({ dryRun: true });
    expect(result.entries).toHaveLength(1);
    expect(snapshot(tripDir())).toEqual(before);
  });
});

describe("grouping across a trip", () => {
  test("three days become three entries", async () => {
    await photo("a.jpg", 11, "2026-08-14 09:00:00", BANGKOK);
    await photo("b.jpg", 12, "2026-08-15 09:00:00", BANGKOK);
    await photo("c.jpg", 13, "2026-08-16 09:00:00", BANGKOK);
    const result = await run();
    expect(result.entries.map((e) => e.date)).toEqual(["2026-08-14", "2026-08-15", "2026-08-16"]);
  });

  test("two stops on one day get two files, not one overwritten one", async () => {
    await photo("a.jpg", 14, "2026-08-14 08:00:00", BANGKOK);
    await photo("b.jpg", 15, "2026-08-14 08:30:00", BANGKOK);
    await photo("c.jpg", 16, "2026-08-14 20:00:00", BANGKOK);
    const result = await run();
    expect(result.entries).toHaveLength(2);
    const files = fs.readdirSync(path.join(tripDir(), "entries"));
    expect(new Set(files).size).toBe(2);
  });

  test("photos with no EXIF date fall back to the file's own time", async () => {
    const { makeJpeg } = await import("./support/exif-jpeg");
    const file = path.join(source, "screenshot.jpg");
    fs.writeFileSync(file, await makeJpeg(21));
    fs.utimesSync(file, new Date("2026-08-20T10:00:00"), new Date("2026-08-20T10:00:00"));
    const result = await run();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].date).toBe("2026-08-20");
  });
});

describe.runIf(geodataAvailable())("places", () => {
  test("names the entry and its file after where the photos were taken", async () => {
    await photo("a.jpg", 17, "2026-08-14 09:00:00", CHIANG_MAI);
    const result = await run();
    expect(result.entries[0].location).toBe("Chiang Mai");
    expect(fs.readdirSync(path.join(tripDir(), "entries"))[0]).toBe("2026-08-14-chiang-mai.md");

    const { data } = matter(
      fs.readFileSync(path.join(tripDir(), "entries", "2026-08-14-chiang-mai.md"), "utf8"),
    );
    expect(data.country).toBe("Thailand");
    expect(data.countryCode).toBe("TH");
  });

  test("a flight between two stops is guessed; a bus is not", async () => {
    await photo("a.jpg", 18, "2026-08-14 08:00:00", BANGKOK);
    await photo("b.jpg", 19, "2026-08-14 10:00:00", CHIANG_MAI);
    await run();
    const files = fs.readdirSync(path.join(tripDir(), "entries")).sort();
    const second = matter(fs.readFileSync(path.join(tripDir(), "entries", files[1]), "utf8"));
    expect(second.data.transportMode).toBe("flight");
    expect(second.data.transportFrom).toBe("Bangkok");
  });
});

/**
 * B141. A slug addresses a day inside its **trip**, not inside its date.
 *
 * `getEntryBySlug` takes the first match and has no tiebreak, so two entry
 * files differing only in the date prefix produce one day that is served and
 * one that is on disk, is not a draft, and never can be. B119 made
 * `createDraft` refuse that, which covers REST and MCP; ingest writes its own
 * names and kept `${date}/${slug}` as its collision key, so the third door
 * stayed open.
 *
 * Nothing exotic is needed to reach it — one card holding two visits to the
 * same town, which is what a return leg or a base town looks like. The
 * reverse geocoder names both clusters the same thing and `slugify` is
 * deterministic, so the second one lands on the first one's address.
 */
describe.runIf(geodataAvailable())("a slug is unique across the trip, not the day", () => {
  const ref = `${USER}/${TRIP}`;

  test("the same place on two dates gives two addressable days", async () => {
    await photo("a.jpg", 40, "2026-08-14 09:00:00", CHIANG_MAI);
    await photo("b.jpg", 41, "2026-08-18 09:00:00", CHIANG_MAI);

    const result = await run();
    expect(result.entries).toHaveLength(2);

    // `includeDrafts` throughout: ingest writes `status: draft` like every
    // other agent-facing writer, so these are exactly the entries a person is
    // about to review and publish. That is what makes the shadow expensive —
    // `publishDay` addresses a day by slug, so the file that cannot be looked
    // up cannot be published either.
    const { getAllEntries, getEntryBySlug } = await import("@/lib/entries");
    const drafts = { includeDrafts: true };
    const slugs = getAllEntries(ref, drafts).map((e) => e.slug);
    expect(new Set(slugs).size).toBe(2);

    // The assertion that matters: both days answer to their own address. Under
    // the old key the second file existed and `getEntryBySlug` could never
    // reach it, because the first match won.
    for (const slug of slugs) {
      expect(getEntryBySlug(ref, slug, drafts)?.slug).toBe(slug);
    }
    expect(getAllEntries(ref, drafts).map((e) => e.date).sort()).toEqual([
      "2026-08-14",
      "2026-08-18",
    ]);
  });

  test("re-running joins the day it already imported rather than numbering beside it", async () => {
    await photo("a.jpg", 42, "2026-08-14 09:00:00", CHIANG_MAI);
    await photo("b.jpg", 43, "2026-08-18 09:00:00", CHIANG_MAI);
    await run();

    const first = fs.readdirSync(path.join(tripDir(), "entries")).sort();
    expect(first).toHaveLength(2);

    // A new photograph for a day already imported. The widened `usedSlugs`
    // must not treat the day's own file as somebody else holding the name, or
    // "I found six more photos from Tuesday" writes `chiang-mai-2` instead.
    await photo("c.jpg", 44, "2026-08-14 17:30:00", CHIANG_MAI);
    const second = await run();

    expect(fs.readdirSync(path.join(tripDir(), "entries")).sort()).toEqual(first);
    expect(second.entries.some((e) => e.date === "2026-08-14" && !e.created)).toBe(true);
  });

  test("a dry run prints the names a real run writes", async () => {
    await photo("a.jpg", 45, "2026-08-14 09:00:00", CHIANG_MAI);
    await photo("b.jpg", 46, "2026-08-18 09:00:00", CHIANG_MAI);

    const planned = (await run({ dryRun: true })).entries.map((e) => e.file);
    expect(fs.existsSync(path.join(tripDir(), "entries"))).toBe(false);

    const written = (await run()).entries.map((e) => e.file);
    expect(written).toEqual(planned);
  });
});

/**
 * The same rule, reached without the place index — a slug already held on disk
 * by another date, whatever named it. Photographs with no coordinates get
 * `day-<date>` for a base, so this half of B141 is deterministic wherever the
 * suite runs rather than only where `places.bin.gz` was built.
 */
describe("a slug already on disk under another date", () => {
  test("is not taken twice", async () => {
    const entries = path.join(tripDir(), "entries");
    fs.mkdirSync(entries, { recursive: true });
    fs.writeFileSync(
      path.join(entries, "2026-08-10-day-2026-08-14.md"),
      `---\ntitle: "Squatter"\ndate: "2026-08-10"\nlocation: ""\ncountry: ""\n---\n`,
    );

    await photo("a.jpg", 47, "2026-08-14 09:00:00");
    const result = await run();

    expect(result.entries).toHaveLength(1);
    const written = path.basename(result.entries[0].file);
    expect(written).not.toBe("2026-08-14-day-2026-08-14.md");
    expect(written).toMatch(/^2026-08-14-day-2026-08-14-/);

    const { getAllEntries } = await import("@/lib/entries");
    const slugs = getAllEntries(`${USER}/${TRIP}`, { includeDrafts: true }).map((e) => e.slug);
    expect(slugs).toHaveLength(2);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("notes", () => {
  test("a dated text file becomes that day's prose", async () => {
    await photo("a.jpg", 22, "2026-08-14 09:00:00", BANGKOK);
    fs.writeFileSync(path.join(source, "2026-08-14.md"), "Woke up too early. Worth it.");
    await run();
    const file = fs.readdirSync(path.join(tripDir(), "entries"))[0];
    const { content } = matter(fs.readFileSync(path.join(tripDir(), "entries", file), "utf8"));
    expect(content.trim()).toBe("Woke up too early. Worth it.");
  });
});

describe("originals", () => {
  /**
   * The whole reason they are kept: a derivative is not a source. Ingest
   * writes one image at 2000px and used to drop what it was made from, so the
   * one artefact a photobook plate needs was the one being thrown away.
   */
  test("are kept beside the trip, numbered to match their derivative", async () => {
    await photo("IMG_4471.jpg", 23, "2026-08-14 09:00:00", BANGKOK);
    await run();

    const kept = path.join(tripDir(), "originals", "bangkok");
    // Named after the derivative, not the camera: two cameras produce
    // IMG_0001.JPG on the same day about as often as not, and the photobook
    // needs to be able to ask "what was 01.jpg made from?".
    expect(fs.readdirSync(kept)).toEqual(["01.jpg"]);
    expect(fs.readdirSync(path.join(tripDir(), "media", "bangkok"))).toEqual(["01.jpg"]);

    // The original keeps its GPS — that is what an archive is for — which is
    // exactly why nothing serves it. `resolveMediaFile` is rooted at the
    // trip's `media/`, and `originals/` is its sibling, not its child.
    const exif = readExif(new Uint8Array(fs.readFileSync(path.join(kept, "01.jpg"))));
    expect(exif.lat).toBeCloseTo(BANGKOK.lat, 3);

    // Whereas the derivative carries nothing identifying at all.
    const served = readExif(
      new Uint8Array(fs.readFileSync(path.join(tripDir(), "media", "bangkok", "01.jpg"))),
    );
    expect(served.lat).toBeUndefined();
  });

  test("MEDIA_ORIGINALS_DIR moves them off the content disk", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-originals-"));
    process.env.MEDIA_ORIGINALS_DIR = vault;
    try {
      await photo("a.jpg", 24, "2026-08-14 09:00:00", BANGKOK);
      await run();
      expect(fs.readdirSync(path.join(vault, USER, TRIP, "bangkok"))).toEqual(["01.jpg"]);
      expect(fs.existsSync(path.join(tripDir(), "originals"))).toBe(false);
    } finally {
      delete process.env.MEDIA_ORIGINALS_DIR;
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe("refusals", () => {
  test("will not invent a trip", async () => {
    await photo("a.jpg", 24, "2026-08-14 09:00:00", BANGKOK);
    await expect(ingest({ username: USER, tripId: "no-such-trip", source })).rejects.toThrow(
      /No trip at/,
    );
  });

  test("says so when the folder holds nothing importable", async () => {
    fs.writeFileSync(path.join(source, "notes.pdf"), "x");
    await expect(run()).rejects.toThrow(/No photos or videos/);
  });

  test("rejects a username that is not one", async () => {
    await expect(ingest({ username: "../etc", tripId: TRIP, source })).rejects.toThrow(
      /not a valid username/,
    );
  });
});

describe.runIf(videoToolsAvailable())("video", () => {
  function clip(name: string, seconds: number, filmedAt = "2026-08-14T09:05:00") {
    const file = path.join(source, name);
    const made = spawnSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=size=640x480:rate=15:duration=${seconds}`,
      "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      // `use_metadata_tags` is what lets the Apple key survive the mp4 muxer;
      // both are written so the fallback path is exercised too.
      "-movflags", "use_metadata_tags",
      "-metadata", `creation_time=${filmedAt}`,
      "-metadata", `com.apple.quicktime.creationdate=${filmedAt}+0700`,
      file,
    ]);
    expect(made.status).toBe(0);
    return file;
  }

  // ffmpeg is spawned twice here; under parallel load that exceeds the 5s
  // default. Raised for the tests that spawn a process, not globally, so a
  // genuine hang elsewhere still fails fast.
  test("a short clip is transcoded, given a poster, and filed by its own clock", async () => {
    clip("clip.mp4", 3);
    await photo("a.jpg", 25, "2026-08-14 09:00:00", BANGKOK);
    const result = await run();
    expect(result.failed).toEqual([]);

    // The clip's container timestamp puts it in the same entry as the photo
    // taken five minutes earlier, rather than in an entry dated "today".
    const files = fs.readdirSync(path.join(tripDir(), "entries"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^2026-08-14-/);

    const { data } = matter(fs.readFileSync(path.join(tripDir(), "entries", files[0]), "utf8"));
    const video = data.gallery.find((g: { type: string }) => g.type === "video");
    expect(video).toBeDefined();
    expect(video.src).toMatch(/\.mp4$/);
    expect(video.poster).toMatch(/\.jpg$/);
    const onDisk = path.join(tripDir(), "media", video.src.replace(`/media/${TRIP}/`, ""));
    expect(fs.statSync(onDisk).size).toBeGreaterThan(0);
  }, 20_000);

  test("a clip is not re-imported, even after the folder is renamed", async () => {
    clip("clip.mp4", 2);
    await run();
    const before = snapshot(tripDir());

    // Video identity is size plus a sample from each end, not the path, so
    // moving the staging folder does not produce a second copy of the clip.
    const moved = `${source}-moved`;
    fs.renameSync(source, moved);
    try {
      const second = await ingest({ username: USER, tripId: TRIP, source: moved });
      expect(second.imported).toBe(0);
      expect(snapshot(tripDir())).toEqual(before);
    } finally {
      fs.renameSync(moved, source);
    }
  }, 20_000);

  test("a long clip is refused, never served raw", async () => {
    clip("long.mp4", 4);
    await photo("a.jpg", 26, "2026-08-14 09:00:00", BANGKOK);
    const result = await run({ maxVideoSeconds: 2 });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/the cap is 2s/);
    // The photo alongside it still imported: one bad clip must not cost the
    // author the rest of the day.
    expect(result.imported).toBe(1);
  }, 20_000);
});

describe("markdown shaping", () => {
  test("renders in the same hand-written shape as the rest of content/", () => {
    const markdown = renderEntry({
      title: "Hội An",
      date: "2026-08-23",
      time: "15:42",
      location: "Hội An",
      country: "Vietnam",
      countryCode: "VN",
      lat: 15.88012345,
      lng: 108.338,
      gallery: [{ src: "/media/t/hoi-an/01.jpg", type: "image", width: 2000, height: 1333 }],
      tags: ["lanterns"],
      body: "",
    });
    const { data, content } = matter(markdown);
    expect(data.title).toBe("Hội An");
    // Five decimals, because a consumer GPS does not know more than that.
    expect(String(data.lat)).toBe("15.88012");
    expect(content).toContain("Write the day here");
  });

  test("quotes survive a title", () => {
    const markdown = renderEntry({
      title: 'The "Old" Quarter',
      date: "2026-08-23",
      location: "Hanoi",
      country: "Vietnam",
      gallery: [],
      tags: [],
      body: "x",
    });
    expect(matter(markdown).data.title).toBe('The "Old" Quarter');
  });

  // Ingest names an entry file after the place the photographs were taken,
  // and since B77 it does that with the one shared slugify — the same
  // function the API writes with, so a day called "Zürich" has one permalink
  // whichever door it came in by. Every letter it handles specially is a
  // table in test/slug.test.ts.
  test("an entry file is named with the shared slug rule", () => {
    expect(entryFileName("2026-08-23", slugify("Zürich"))).toBe("2026-08-23-zuerich.md");
    expect(entryFileName("2026-08-23", slugify("Hội An"))).toBe("2026-08-23-hoi-an.md");
    expect(entryFileName("2026-08-23", slugify("Ærøskøbing"))).toBe("2026-08-23-aeroskobing.md");
  });

  test("appending leaves every other byte of the file alone", () => {
    const before = [
      "---",
      'title: "Hoi An"',
      "gallery:",
      '  - src: "/media/t/hoi-an/01.jpg"',
      '    type: "image"',
      '    caption: "Lanterns, obviously"',
      'tags: ["lanterns"]',
      "---",
      "",
      "The tailors work until midnight.",
      "",
    ].join("\n");

    const after = appendGallery(before, [
      { src: "/media/t/hoi-an/02.jpg", type: "image", width: 2000, height: 1333 },
    ]);
    expect(after).not.toBeNull();
    expect(after).toContain('caption: "Lanterns, obviously"');
    expect(after).toContain("The tailors work until midnight.");
    const { data } = matter(after!);
    expect(data.gallery).toHaveLength(2);
    expect(data.tags).toEqual(["lanterns"]);
  });

  test("appending to an entry with no gallery starts one", () => {
    const after = appendGallery('---\ntitle: "Nothing yet"\n---\n\nWords.\n', [
      { src: "/media/t/x/01.jpg", type: "image" },
    ]);
    expect(matter(after!).data.gallery).toHaveLength(1);
  });

  test("a file with no frontmatter is refused rather than mangled", () => {
    expect(appendGallery("Just some words.\n", [{ src: "/x.jpg", type: "image" }])).toBeNull();
  });
});
