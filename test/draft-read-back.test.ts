import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft } from "@/lib/api/entries";
import { getEntryBySlug } from "@/lib/entries";
import { writeTripFixture } from "./fixtures/content";

/**
 * `createDraft` reads its day back — B208, the day half of B204.
 *
 * The trip writer has read its trip back since B204 and rolls the folder back
 * if it does not parse. The day writer did neither: it wrote the file, cleared
 * the entry cache and answered `201 {"status":"draft"}`, so a file no reading
 * path could load was reported to somebody as their day, written and waiting.
 *
 * There is no known input that produces one — days are now serialised with
 * `JSON.stringify` (`dayToJson`, `lib/api/v2/documents.ts`), which cannot emit
 * invalid JSON or the wrong value for a key whatever it is handed: a string
 * is a string, quoted once, and there is no delimiter a body can be mistaken
 * for the way YAML frontmatter had. That is exactly why the failure has to be
 * *forced* here: the guard is the one that does not depend on anybody having
 * thought of the input, so a test that waited for a real one would be testing
 * nothing.
 *
 * `dayToJson` is mocked to misbehave instead — the only way to reach the
 * branch without pretending `fs` failed.
 */

const broken = vi.hoisted(() => ({ mode: null as null | "corrupt" | "status" }));

vi.mock("@/lib/api/v2/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/v2/documents")>();
  return {
    ...actual,
    dayToJson: (day: Parameters<typeof actual.dayToJson>[0]) => {
      // A file that is not valid JSON at all — the read-back can't even parse it.
      if (broken.mode === "corrupt") return "{ not json";
      // A file that parses, but reports the wrong status — the one outcome
      // worse than an invisible file, since it would put a day on the site
      // that reported itself a draft.
      if (broken.mode === "status") return actual.dayToJson({ ...day, status: "published" });
      return actual.dayToJson(day);
    },
  };
});

let dir: string;
const REF = "alex/asia-2026";
const entriesDir = () => path.join(dir, "alex", "trips", "asia-2026", "entries");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-readback-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
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
      title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" },
      startLocation: "X", defaultLocale: "en", locales: ["en"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
    }),
  );
  writeTripFixture("alex", {
    id: "asia-2026",
    title: "Asia",
    start: "2026-01-01",
    end: "2026-01-09",
    status: "past",
    visibility: "public",
    intro: "Body.",
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  broken.mode = null;
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a day that does not read back", () => {
  test("is refused, and leaves no file behind", () => {
    broken.mode = "corrupt";
    const result = createDraft(REF, {
      title: "Lanterns",
      date: "2026-01-02",
      location: "Hội An",
      content: "Words.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("does not parse");
    // Blamed on the software rather than on the caller — the days route turns
    // this into a 500, not a 400.
    expect(result.bug).toBe(true);
    // The slug has to be usable again immediately: a file nothing can read,
    // holding an address, would refuse the retry and show nothing.
    expect(result.error).toContain('the slug "lanterns" is still free');
    expect(fs.readdirSync(entriesDir())).toEqual([]);
  });

  /**
   * The failure that parses. A block that ends early does not always throw —
   * the rest of it can land in the prose, taking `status: draft` with it, and
   * the day is then on the site. That is the one outcome here worse than an
   * invisible file, so it is asserted separately rather than assumed to be
   * covered by the parse error above.
   */
  test("a day whose status line ended up in the prose is refused too", () => {
    broken.mode = "status";
    const result = createDraft(REF, {
      title: "Ferry",
      date: "2026-01-03",
      location: "Cat Ba",
      content: "Words.",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('does not read back as "status: draft"');
    expect(fs.readdirSync(entriesDir())).toEqual([]);
  });
});

describe("an ordinary draft", () => {
  test("is written and reads back, unchanged by the guard", () => {
    const result = createDraft(REF, {
      title: "Lanterns of Hội An",
      date: "2026-01-02",
      location: "Hội An",
      content: "Words.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("draft");
    const entry = getEntryBySlug(REF, result.slug, { includeDrafts: true });
    expect(entry?.title).toBe("Lanterns of Hội An");
    expect(entry?.draft).toBe(true);
  });

  /**
   * The acceptance line about cost. `getEntryBySlug` would have been the
   * obvious read-back and goes through `getAllEntries`, which re-reads and
   * re-parses every entry in the trip — on a trip with two hundred days, two
   * hundred file reads to check one file, on the commonest write there is.
   *
   * Asserted rather than argued: the only entry file read while writing is the
   * one just written.
   */
  test("costs one file read, not a read of the whole trip", () => {
    for (const [date, slug] of [["2026-01-04", "first"], ["2026-01-05", "second"]]) {
      fs.writeFileSync(
        path.join(entriesDir(), `${date}-${slug}.md`),
        ["---", `title: "${slug}"`, `date: "${date}"`, "---", "", "Words.", ""].join("\n"),
      );
    }

    const read: string[] = [];
    const real = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      file: fs.PathOrFileDescriptor,
      options?: unknown,
    ) => {
      if (typeof file === "string" && file.startsWith(entriesDir())) read.push(path.basename(file));
      return (real as (f: fs.PathOrFileDescriptor, o?: unknown) => unknown)(file, options);
    }) as unknown as typeof fs.readFileSync);

    try {
      expect(createDraft(REF, { title: "Third", date: "2026-01-06", content: "Words." }).ok).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }

    expect(read).toEqual(["2026-01-06-third.json"]);
  });
});
