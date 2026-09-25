import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, validateDraft } from "@/lib/api/entries";
import { NO_PROSE } from "@/lib/helper/draft";
import { tripOriginalsDir } from "@/lib/media";
import { writeTripFixture } from "./fixtures/content";

/**
 * A day started with no title yet must not be titled with its own date — the
 * ISO string that leaked to every reading surface as though it were somebody's
 * words (B1442). `createDraft` is where the room's "Start this day" and
 * "Write it up for me" both land; neither ever sent a title of its own, and
 * used to send `title: date` as a stand-in that surfaces could not tell from
 * real words. This pins the title half of that fix: no title is written at
 * all, so every surface renders the formatted date instead.
 *
 * The slug half was revised by B2239: an untitled day's address is now its
 * own date ("2026-01-11", suffixed on a collision), not "day"/"day-2" — a
 * shared link naming nothing was worse than one carrying a date twice.
 */

let dir: string;
const REF = "alex/kyoto-2026";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-untitled-day-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A" } }),
  );
  writeTripFixture("alex", {
    id: "kyoto-2026",
    title: "Kyoto",
    start: "2026-01-01",
    end: "2026-01-31",
    status: "current",
    visibility: "public",
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function fileOnDisk() {
  const entries = fs.readdirSync(path.join(dir, "alex", "trips", "kyoto-2026", "entries"));
  expect(entries).toHaveLength(1);
  return fs.readFileSync(
    path.join(dir, "alex", "trips", "kyoto-2026", "entries", entries[0]),
    "utf8",
  );
}

describe("a day created with no title", () => {
  test("writes no title at all, not its own date", () => {
    const written = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");

    // The bug in one line: this used to be `"2026-01-11"`.
    const parsed = JSON.parse(fileOnDisk()) as { title: string };
    expect(parsed.title).toBe("");
  });

  test("B2239: its slug is its own date, a real address rather than 'day'", () => {
    const written = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");

    expect(written.slug).toBe("2026-01-11");
    // The date reads twice in the file name (once as the sort prefix every
    // file carries, once as the slug) — invisible on disk, and irrelevant:
    // `entrySlugFromFile` strips only the leading prefix, so the address a
    // reader sees is the slug alone.
    expect(fs.readdirSync(path.join(dir, "alex", "trips", "kyoto-2026", "entries"))).toEqual([
      "2026-01-11-2026-01-11.json",
    ]);
  });

  test("two untitled days on different dates get different slugs", () => {
    const first = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    const second = createDraft(REF, { date: "2026-01-12", content: NO_PROSE });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(first.slug).toBe("2026-01-11");
    expect(second.slug).toBe("2026-01-12");
  });

  test("B2239: a date already taken (trip-wide, any day) gets a numbered suffix", () => {
    // A slug is unique trip-wide, not per date (B119) — the collision check
    // `nextUntitledSlug` shares with "day"/"day-2" before it. Simplest way to
    // make "2026-01-11" already taken without a second day dated that day:
    // a real title that happens to slugify to the same string.
    const titled = createDraft(REF, { date: "2025-06-01", title: "2026-01-11", content: NO_PROSE });
    expect(titled.ok).toBe(true);
    if (!titled.ok) throw new Error("unreachable");
    expect(titled.slug).toBe("2026-01-11");

    const untitled = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    expect(untitled.ok).toBe(true);
    if (!untitled.ok) throw new Error("unreachable");
    expect(untitled.slug).toBe("2026-01-11-2");
  });

  test("a title sent as an empty string is still refused, unlike an absent one", () => {
    expect(validateDraft({ title: "", date: "2026-01-11", content: NO_PROSE })).toBe(
      "title must not be empty",
    );
    expect(validateDraft({ date: "2026-01-11", content: NO_PROSE })).toBeNull();
  });

  test("a trip whose originals already hold an unrelated folder at that date still lands — B1827", () => {
    // Left behind by an earlier, unrelated import — no current day owns this
    // folder, the same shape the walk in B1827 hit against `asia-2023`.
    const folder = path.join(tripOriginalsDir(REF), "2026-01-11");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "IMG_0001.jpg"), "not really a jpeg");

    const written = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");
    // Skipped straight past the taken placeholder rather than refusing.
    expect(written.slug).toBe("2026-01-11-2");

    // The orphaned original is untouched — nothing claimed its folder.
    expect(fs.readFileSync(path.join(folder, "IMG_0001.jpg"), "utf8")).toBe("not really a jpeg");
  });

  test("a real title still slugs and titles normally", () => {
    const written = createDraft(REF, {
      title: "Kinkaku-ji",
      date: "2026-01-11",
      content: NO_PROSE,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");
    expect(written.slug).toBe("kinkaku-ji");
    const parsed = JSON.parse(fileOnDisk()) as { title: string };
    expect(parsed.title).toBe("Kinkaku-ji");
  });
});
