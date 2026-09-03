import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, publishDraft } from "@/lib/api/entries";
import { createTrip } from "@/lib/tripWrite";
import { getAllEntries, getEntryBySlug } from "@/lib/entries";
import { slugify } from "@/lib/slug.ts";

/**
 * Two days in one trip cannot hold the same slug (B119).
 *
 * A slug is a day's address inside its trip: `getEntryBySlug` takes the first
 * match and there is no tiebreak. Before this, a second day holding one was
 * written anyway — a `201`, a slug echoed back that already belonged to
 * something else, a file on disk that was not a draft and could never be
 * served. `/agent.md` said "a slug is unique within a trip" the whole time,
 * which is the sentence an agent writes against, so nothing prompted anyone to
 * check.
 *
 * It needs no exotic input. `Đà Lạt` (U+0110, d-with-stroke) and `Ðà Lạt`
 * (U+00D0, eth) both fold to `da-lat` — deliberately, B77 settled that — and so
 * does any pair of titles differing only in punctuation or accents.
 */

let dir: string;
const REF = "alex/vietnam-2026";

/** The pair from the field report, and the reason this is not a corner case. */
const D_STROKE = "Đà Lạt";
const ETH = "Ðà Lạt";

function day(over: Partial<{ title: string; date: string; content: string }> = {}) {
  return {
    title: over.title ?? D_STROKE,
    date: over.date ?? "2026-01-11",
    content: over.content ?? "The pines and the cold air.",
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-slug-collision-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "vietnam-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A" } }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "vietnam-2026", "trip.md"),
    [
      "---",
      "id: vietnam-2026",
      'title: "Vietnam"',
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: current",
      "visibility: public",
      "---",
      "",
      "Body.",
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

/** Entry files on disk, drafts included — what `getAllEntries` will not show. */
function filesOnDisk(): string[] {
  return fs
    .readdirSync(path.join(dir, "alex", "trips", "vietnam-2026", "entries"))
    .filter((f) => f.endsWith(".md"))
    .sort();
}

describe("the premise", () => {
  test("two titles a person would call different produce one slug", () => {
    expect(slugify(D_STROKE)).toBe("da-lat");
    expect(slugify(ETH)).toBe("da-lat");
    expect(D_STROKE).not.toBe(ETH);
  });
});

describe("a second day claiming a taken slug", () => {
  test("is refused, naming the day that already holds it", () => {
    expect(createDraft(REF, day()).ok).toBe(true);

    const second = createDraft(REF, day({ title: ETH, date: "2026-01-12" }));
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error).toContain('slug "da-lat"');
    // The file, so the caller can go and look at what it collided with.
    expect(second.error).toContain("2026-01-11-da-lat.md");
    // The prefix the REST route maps to 409 rather than 400.
    expect(second.error.startsWith("an entry already exists")).toBe(true);
  });

  test("and is not written, so the day that exists stays the only one", () => {
    createDraft(REF, day());
    createDraft(REF, day({ title: ETH, date: "2026-01-12" }));

    expect(filesOnDisk()).toEqual(["2026-01-11-da-lat.md"]);
    // The bug in one line: this used to be the first of two files, with the
    // second unreachable for ever.
    expect(getAllEntries(REF, { includeDrafts: true }).map((e) => e.slug)).toEqual(["da-lat"]);
  });

  /**
   * A draft holds the slug just as firmly as a published day. It is the file
   * that decides the address, and publishing it later is exactly the moment
   * the shadow would appear — which is the worst time to find out.
   */
  test("including when the day holding it is still a draft", () => {
    createDraft(REF, day());
    expect(getAllEntries(REF)).toHaveLength(0); // still a draft, invisible to readers

    const second = createDraft(REF, day({ title: ETH, date: "2026-01-12" }));
    expect(second.ok).toBe(false);
  });

  test("and once it is published, which is the same answer", () => {
    createDraft(REF, day());
    expect(publishDraft(REF, "da-lat").ok).toBe(true);

    expect(createDraft(REF, day({ title: ETH, date: "2026-01-12" })).ok).toBe(false);
    expect(filesOnDisk()).toEqual(["2026-01-11-da-lat.md"]);
  });
});

describe("what still works", () => {
  test("a first day in an empty trip collides with nothing", () => {
    const result = createDraft(REF, day());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.slug).toBe("da-lat");
  });

  test("a genuinely different title on the same date is fine", () => {
    expect(createDraft(REF, day()).ok).toBe(true);
    expect(createDraft(REF, day({ title: "Nha Trang" })).ok).toBe(true);
    expect(filesOnDisk()).toEqual(["2026-01-11-da-lat.md", "2026-01-11-nha-trang.md"]);
  });

  /** The narrower check that was already there, kept: an agent retrying a
   * request must not silently replace yesterday's writing. */
  test("the same title on the same date still names the exact file", () => {
    createDraft(REF, day());
    const again = createDraft(REF, day());
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error).toBe("an entry already exists at 2026-01-11-da-lat");
  });

  test("the day that holds the slug is addressable by it, as it always was", () => {
    createDraft(REF, day());
    publishDraft(REF, "da-lat");
    expect(getEntryBySlug(REF, "da-lat")?.date).toBe("2026-01-11");
  });
});

/**
 * The neighbouring question B119 asked to check, answered here rather than left
 * as a note: can two *trips* in one journal collide the same way?
 *
 * They cannot, and for a structural reason rather than a check somebody
 * remembered to write. A trip id is given by the caller and validated, never
 * derived from a title — so there is no folding step for two different inputs
 * to survive — and the id is the directory name, which the filesystem will not
 * hand out twice. `createTrip` refuses an existing one outright.
 */
describe("trip ids, the same question one level up", () => {
  const NEW_TRIP = { title: "Vietnam again", start: "2027-01-01", end: "2027-01-31" };

  test("a second trip with a taken id is refused, not silently merged into it", () => {
    const again = createTrip("alex", { id: "vietnam-2026", ...NEW_TRIP });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("unreachable");
    expect(again.error).toBe("trip_exists");
  });

  test("and an id is never derived from a title, so two titles cannot fold into one", () => {
    // The pair that collides for days is simply not how a trip is named: the
    // id is a separate, explicit field, and an invalid one is refused rather
    // than transliterated into a valid one.
    const refused = createTrip("alex", { id: D_STROKE, ...NEW_TRIP });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.error).toBe("invalid_trip_id");
  });
});
