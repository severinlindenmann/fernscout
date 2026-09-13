import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, validateDraft } from "@/lib/api/entries";
import { NO_PROSE } from "@/lib/helper/draft";
import { writeTripFixture } from "./fixtures/content";

/**
 * A day started with no title yet must not be titled with its own date — the
 * ISO string that leaked to every reading surface as though it were somebody's
 * words (B1442). `createDraft` is where the room's "Start this day" and
 * "Write it up for me" both land; neither ever sent a title of its own, and
 * used to send `title: date` as a stand-in that surfaces could not tell from
 * real words. This pins the two things that changed: no title is written at
 * all, and the slug it gets is not the date concatenated with itself.
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

  test("its slug does not carry the date twice", () => {
    const written = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");

    // The bug in one line: this used to be `"2026-01-11-2026-01-11"`.
    expect(written.slug).not.toContain("2026-01-11");
    expect(fs.readdirSync(path.join(dir, "alex", "trips", "kyoto-2026", "entries"))).toEqual([
      "2026-01-11-day.json",
    ]);
  });

  test("two untitled days on different dates get different slugs", () => {
    const first = createDraft(REF, { date: "2026-01-11", content: NO_PROSE });
    const second = createDraft(REF, { date: "2026-01-12", content: NO_PROSE });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(first.slug).not.toBe(second.slug);
    expect(first.slug).toBe("day");
    expect(second.slug).toBe("day-2");
  });

  test("a title sent as an empty string is still refused, unlike an absent one", () => {
    expect(validateDraft({ title: "", date: "2026-01-11", content: NO_PROSE })).toBe(
      "title must not be empty",
    );
    expect(validateDraft({ date: "2026-01-11", content: NO_PROSE })).toBeNull();
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
