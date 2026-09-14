import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, deleteEntry } from "@/lib/api/entries";
import { tripMediaDir } from "@/lib/media";
import { writeTripFixture } from "./fixtures/content";

/**
 * B1539 — a slug freed by deleting its day can still have photographs sitting
 * in its media folder (`deleteEntry`'s own comment: the photographs stay
 * either way). A new day that lands on the same slug must not silently write
 * into that folder: its own uploads would be numbered in after a stranger's
 * leftovers, and deduplicated against photographs that were never its own —
 * the same "two days, one folder" shape the ten Phuket days found, reached
 * here by slug reuse instead of by two days existing at once.
 */

let dir: string;
const REF = "alex/phuket-2026";

function day(over: Partial<{ title: string; date: string; content: string }> = {}) {
  return {
    title: over.title ?? "Phuket Island",
    date: over.date ?? "2026-01-11",
    content: over.content ?? "A day on the beach.",
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-slug-media-collision-"));
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
    id: "phuket-2026",
    title: "Phuket",
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

describe("a slug whose day was deleted but whose media stayed", () => {
  test("refuses a new day that would reuse the folder", () => {
    const first = createDraft(REF, day());
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    // A photograph, left behind exactly as `deleteEntry`'s own doc comment
    // says it will be — no upload pipeline needed to prove the point.
    const folder = path.join(tripMediaDir(REF), first.slug);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "01.jpg"), "not really a jpeg");

    expect(deleteEntry(REF, first.slug).ok).toBe(true);

    // The slug is free again — no entry holds it — but its folder is not.
    const second = createDraft(REF, day({ date: "2026-01-12" }));
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.code).toBe("slug_taken");
    expect(second.error).toContain("phuket-island");

    // The old photograph is still exactly where it was — nothing wrote over
    // it, and nothing silently claimed it for the second day either.
    expect(fs.readFileSync(path.join(folder, "01.jpg"), "utf8")).toBe("not really a jpeg");
  });

  test("a slug whose folder was never used at all still works", () => {
    const result = createDraft(REF, day());
    expect(result.ok).toBe(true);
  });
});
