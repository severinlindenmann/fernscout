import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";
import { getTrip, tripRef } from "@/lib/trips";
import { opensForAudience, previewJournal, previewTrip } from "@/lib/studio/audiencePreview";

/**
 * B1833, spec §7.5/§7.6 — "computed by running the real gate across the
 * real trips, never a hand-written table." These prove the computation
 * against real fixtures rather than trusting the function's own reasoning.
 */

const OWNER = "alex";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-audience-preview-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      locales: ["en"],
      defaultLocale: "en",
    }),
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

describe("opensForAudience — mayReadTrip's own three branches", () => {
  test("a traveller always opens a private trip, mirroring mayReadTrip", () => {
    expect(opensForAudience("private", "private")).toBe(true);
  });
  test("a stranger never opens a private or guest trip", () => {
    expect(opensForAudience("private", "public")).toBe(false);
    expect(opensForAudience("guest", "public")).toBe(false);
  });
  test("a guest opens a guest trip but not a private one", () => {
    expect(opensForAudience("guest", "guest")).toBe(true);
    expect(opensForAudience("private", "guest")).toBe(false);
  });
  test("anybody opens a public trip", () => {
    expect(opensForAudience("public", "public")).toBe(true);
    expect(opensForAudience("public", "guest")).toBe(true);
  });
});

describe("previewTrip / previewJournal", () => {
  test("a public trip's published days count, drafts do not", () => {
    writeTripFixture(OWNER, { id: "alps", title: "Alps", start: "2025-01-01", end: "2025-01-05", visibility: "public" });
    writeDayFixture(dir, OWNER, "alps", { slug: "one", date: "2025-01-01", status: "published" });
    writeDayFixture(dir, OWNER, "alps", { slug: "two", date: "2025-01-02", status: "draft" });

    const trip = getTrip(tripRef(OWNER, "alps"))!;
    const preview = previewTrip(OWNER, trip, "public");
    expect(preview.opens).toBe(true);
    expect(preview.publishedDays).toBe(1);
    expect(preview.draftDays).toBe(1);
  });

  test("a private trip is closed to a guest audience — nothing counted", () => {
    writeTripFixture(OWNER, { id: "wedding", title: "Wedding", start: "2025-02-01", end: "2025-02-02", visibility: "private" });
    writeDayFixture(dir, OWNER, "wedding", { slug: "day", date: "2025-02-01", status: "published" });

    const trip = getTrip(tripRef(OWNER, "wedding"))!;
    const preview = previewTrip(OWNER, trip, "guest");
    expect(preview.opens).toBe(false);
    expect(preview.publishedDays).toBe(0);
    expect(preview.draftDays).toBe(0);
  });

  test("previewJournal lists every trip, closed ones included", () => {
    writeTripFixture(OWNER, { id: "open-trip", title: "Open", start: "2025-03-01", end: "2025-03-02", visibility: "public" });
    writeTripFixture(OWNER, { id: "closed-trip", title: "Closed", start: "2025-04-01", end: "2025-04-02", visibility: "private" });

    const preview = previewJournal(OWNER, "guest");
    expect(preview).toHaveLength(2);
    expect(preview.find((p) => p.id === "open-trip")?.opens).toBe(true);
    expect(preview.find((p) => p.id === "closed-trip")?.opens).toBe(false);
  });

  test("a candidate visibility overrides the trip's own stored one — V2's preview-before-writing", () => {
    writeTripFixture(OWNER, { id: "candidate", title: "Candidate", start: "2025-05-01", end: "2025-05-02", visibility: "private" });
    writeDayFixture(dir, OWNER, "candidate", { slug: "day", date: "2025-05-01", status: "published" });

    const trip = getTrip(tripRef(OWNER, "candidate"))!;
    // The trip is actually private, but previewing "what if this were guest"
    // must read the candidate, not what is on disk.
    const preview = previewTrip(OWNER, trip, "guest", "guest");
    expect(preview.opens).toBe(true);
    expect(preview.publishedDays).toBe(1);
  });

  // B2132 — a published day this audience may not read is held back, not a
  // draft. The two are separate facts about the owner's journal.
  test("a published day held back from this audience is not counted as a draft", () => {
    writeTripFixture(OWNER, { id: "mixed", title: "Mixed", start: "2025-06-01", end: "2025-06-05", visibility: "public" });
    writeDayFixture(dir, OWNER, "mixed", { slug: "open", date: "2025-06-01", status: "published" });
    writeDayFixture(dir, OWNER, "mixed", { slug: "draft", date: "2025-06-02", status: "draft" });
    writeDayFixture(dir, OWNER, "mixed", { slug: "hidden", date: "2025-06-03", status: "published", visibility: "guest" });

    const trip = getTrip(tripRef(OWNER, "mixed"))!;
    const toPublic = previewTrip(OWNER, trip, "public");
    expect(toPublic.publishedDays).toBe(1);
    expect(toPublic.draftDays).toBe(1);
    expect(toPublic.heldBackDays).toBe(1);
    // A guest may read the guest-only day: nothing held back from them.
    const toGuest = previewTrip(OWNER, trip, "guest");
    expect(toGuest.publishedDays).toBe(2);
    expect(toGuest.draftDays).toBe(1);
    expect(toGuest.heldBackDays).toBe(0);
  });

  test("a trip with only drafts holds nothing back", () => {
    writeTripFixture(OWNER, { id: "drafts", title: "Drafts", start: "2025-07-01", end: "2025-07-02", visibility: "public" });
    writeDayFixture(dir, OWNER, "drafts", { slug: "a", date: "2025-07-01", status: "draft" });
    writeDayFixture(dir, OWNER, "drafts", { slug: "b", date: "2025-07-02", status: "draft" });

    const preview = previewTrip(OWNER, getTrip(tripRef(OWNER, "drafts"))!, "public");
    expect(preview.draftDays).toBe(2);
    expect(preview.heldBackDays).toBe(0);
  });
});

// B2130 — the sentences about money read this answer, so it has to follow
// the trip's own costs.visibility.
describe("costsVisible follows costs.visibility", () => {
  beforeEach(() => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { costs: { enabled: true } } }),
    );
    clearConfigCache();
    clearUserCache();
  });

  test("public costs are visible to the public audience", () => {
    writeTripFixture(OWNER, { id: "spent", title: "Spent", start: "2025-08-01", end: "2025-08-02", visibility: "public", costsVisibility: "public" });
    const trip = getTrip(tripRef(OWNER, "spent"))!;
    expect(previewTrip(OWNER, trip, "public").costsVisible).toBe(true);
    expect(previewTrip(OWNER, trip, "guest").costsVisible).toBe(true);
  });

  test("guests-only costs are hidden from the public, shown to a guest", () => {
    writeTripFixture(OWNER, { id: "kept", title: "Kept", start: "2025-08-01", end: "2025-08-02", visibility: "public", costsVisibility: "guests" });
    const trip = getTrip(tripRef(OWNER, "kept"))!;
    expect(previewTrip(OWNER, trip, "public").costsVisible).toBe(false);
    expect(previewTrip(OWNER, trip, "guest").costsVisible).toBe(true);
  });
});
