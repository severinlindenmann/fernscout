import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildUserExportZipBuffer } from "@/lib/exportZip";
import { clearConfigCache } from "@/lib/config";
import { getAllEntries } from "@/lib/entries";
import { getTrips, tripRef } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";

/**
 * M6 — "download my whole trip as a zip of markdown + photos", proven by
 * actually restoring from it: unzip into a fresh content/<username>/ and
 * confirm the app reads it back identically, using the real system `unzip`
 * (not the library that wrote it) so this proves genuine interoperability,
 * not just that our writer and our own reader agree with each other.
 */

let srcDir: string;
let workDir: string;

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function seedSource() {
  write(
    path.join(srcDir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" }, users: {}, features: {} }),
  );
  write(
    path.join(srcDir, "traveller", "config.json"),
    JSON.stringify({
      title: "Traveller's journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { reactions: { enabled: true }, costs: { enabled: true } },
    }),
  );

  write(
    path.join(srcDir, "traveller", "trips", "open-2026", "trip.md"),
    [
      "---",
      "id: open-2026",
      'title: "Open Trip"',
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      "status: past",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  write(
    path.join(srcDir, "traveller", "trips", "open-2026", "entries", "2026-01-03-unpublished.md"),
    [
      "---",
      'title: "Unpublished"',
      'date: "2026-01-03"',
      'location: "Beta"',
      'country: "Testland"',
      "lat: 1.0",
      "lng: 2.0",
      "status: draft",
      "---",
      "",
      "Entry content, marker DRAFT-MARKER.",
      "",
    ].join("\n"),
  );
  write(
    path.join(srcDir, "traveller", "trips", "open-2026", "entries", "2026-01-02-alpha.md"),
    [
      "---",
      'title: "Alpha"',
      'date: "2026-01-02"',
      'location: "Alpha"',
      'country: "Testland"',
      "lat: 1.0",
      "lng: 2.0",
      "gallery:",
      '  - src: "/media/open-2026/alpha/photo.jpg"',
      "    type: image",
      "---",
      "",
      "Entry content, marker OPEN-MARKER.",
      "",
    ].join("\n"),
  );
  write(
    path.join(srcDir, "traveller", "trips", "open-2026", "media", "alpha", "photo.jpg"),
    "not really a jpeg, just bytes to round-trip",
  );

  write(
    path.join(srcDir, "traveller", "trips", "secret-2026", "trip.md"),
    [
      "---",
      "id: secret-2026",
      'title: "Secret Trip"',
      'start: "2026-02-01"',
      'end: "2026-02-05"',
      "status: past",
      "visibility: password",
      "passwordHash: scrypt$32768$8$1$AAAA$AAAA",
      "---",
      "",
      "Secret body.",
      "",
    ].join("\n"),
  );
  write(
    path.join(srcDir, "traveller", "trips", "secret-2026", "entries", "2026-02-02-hidden.md"),
    [
      "---",
      'title: "Hidden"',
      'date: "2026-02-02"',
      'location: "Hidden"',
      'country: "Testland"',
      "lat: 3.0",
      "lng: 4.0",
      "---",
      "",
      "Entry content, marker SECRET-MARKER.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-export-src-"));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-export-work-"));
  seedSource();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** Writes the zip to disk, unzips it with the real `unzip` binary, and
 * returns the directory it was extracted into. */
function unzipInto(buffer: Buffer, label: string): string {
  const zipPath = path.join(workDir, `${label}.zip`);
  fs.writeFileSync(zipPath, buffer);
  const dest = path.join(workDir, `${label}-restored`);
  fs.mkdirSync(dest, { recursive: true });
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", dest]);
  return dest;
}

describe("buildUserExportZipBuffer — scope 'all'", () => {
  /** The owner's backup is a backup: drafts are their unpublished work, and
   * an export that silently dropped them would lose it. */
  test("keeps a draft entry", async () => {
    process.env.CONTENT_DIR = srcDir;
    const buffer = await buildUserExportZipBuffer("traveller", "all");
    const extracted = unzipInto(buffer, "all-drafts");
    expect(
      fs.readdirSync(path.join(extracted, "trips", "open-2026", "entries")),
    ).toContain("2026-01-03-unpublished.md");
  });

  test("round-trips: unzip into content/<user>/, the app reads it back identically", async () => {
    process.env.CONTENT_DIR = srcDir;
    const buffer = await buildUserExportZipBuffer("traveller", "all");

    // The zip's own contents become content/<user>/, restored fresh.
    const restoredRoot = fs.mkdtempSync(path.join(workDir, "content-"));
    const restoredUserDir = path.join(restoredRoot, "traveller");
    const extracted = unzipInto(buffer, "all");
    fs.mkdirSync(restoredUserDir, { recursive: true });
    fs.cpSync(extracted, restoredUserDir, { recursive: true });

    process.env.CONTENT_DIR = restoredRoot;
    clearConfigCache();
    clearUserCache();

    const trips = getTrips("traveller")
      .map((t) => t.id)
      .sort();
    expect(trips).toEqual(["open-2026", "secret-2026"]);

    const openEntries = getAllEntries(tripRef("traveller", "open-2026"));
    expect(openEntries.map((e) => e.slug)).toEqual(["alpha"]);
    expect(openEntries[0].content).toContain("OPEN-MARKER");

    const secretEntries = getAllEntries(tripRef("traveller", "secret-2026"));
    expect(secretEntries[0].content).toContain("SECRET-MARKER");

    // The password hash survives — this is the owner's own full backup.
    const secretTripMd = fs.readFileSync(
      path.join(restoredUserDir, "trips", "secret-2026", "trip.md"),
      "utf8",
    );
    expect(secretTripMd).toContain("passwordHash: scrypt$32768$8$1$AAAA$AAAA");

    // Media round-trips too.
    const photo = fs.readFileSync(
      path.join(restoredUserDir, "trips", "open-2026", "media", "alpha", "photo.jpg"),
      "utf8",
    );
    expect(photo).toBe("not really a jpeg, just bytes to round-trip");
  });
});

describe("buildUserExportZipBuffer — scope 'open-to-link'", () => {
  /**
   * The scope means "what an anonymous visitor could already see", and a draft
   * is exactly what they cannot: it is absent from the story, the feed, the
   * sitemap, the search index and its own permalink. Only the trip filter was
   * being applied, so a public trip handed over every unreviewed thing an
   * agent had written in it, to anybody, on a plain GET.
   */
  test("leaves out a draft entry", async () => {
    process.env.CONTENT_DIR = srcDir;
    const buffer = await buildUserExportZipBuffer("traveller", "open-to-link");
    const extracted = unzipInto(buffer, "drafts");
    const entries = fs.readdirSync(path.join(extracted, "trips", "open-2026", "entries"));

    expect(entries).toContain("2026-01-02-alpha.md");
    expect(entries).not.toContain("2026-01-03-unpublished.md");
  });

  test("excludes the password-protected trip entirely", async () => {
    process.env.CONTENT_DIR = srcDir;
    const buffer = await buildUserExportZipBuffer("traveller", "open-to-link");
    const extracted = unzipInto(buffer, "open");

    expect(fs.existsSync(path.join(extracted, "trips", "open-2026"))).toBe(true);
    expect(fs.existsSync(path.join(extracted, "trips", "secret-2026"))).toBe(false);

    const listing = fs.readdirSync(path.join(extracted, "trips"));
    expect(listing).toEqual(["open-2026"]);
  });

  test("the public trip still restores and reads correctly", async () => {
    process.env.CONTENT_DIR = srcDir;
    const buffer = await buildUserExportZipBuffer("traveller", "open-to-link");
    const extracted = unzipInto(buffer, "open-restore");

    const restoredRoot = fs.mkdtempSync(path.join(workDir, "content2-"));
    const restoredUserDir = path.join(restoredRoot, "traveller");
    fs.mkdirSync(restoredUserDir, { recursive: true });
    fs.cpSync(extracted, restoredUserDir, { recursive: true });

    process.env.CONTENT_DIR = restoredRoot;
    clearConfigCache();
    clearUserCache();

    expect(getTrips("traveller").map((t) => t.id)).toEqual(["open-2026"]);
    expect(getAllEntries(tripRef("traveller", "open-2026"))[0].content).toContain("OPEN-MARKER");
  });

  test("strips a stale passwordHash even from a trip that is included", async () => {
    // Flip the secret trip to public but leave its old hash in place — the
    // kind of half-edited frontmatter a real trip.md could end up with.
    const tripMdPath = path.join(srcDir, "traveller", "trips", "secret-2026", "trip.md");
    const flipped = fs
      .readFileSync(tripMdPath, "utf8")
      .replace("visibility: password", "visibility: public");
    fs.writeFileSync(tripMdPath, flipped);

    process.env.CONTENT_DIR = srcDir;
    clearConfigCache();
    clearUserCache();
    const buffer = await buildUserExportZipBuffer("traveller", "open-to-link");
    const extracted = unzipInto(buffer, "redact");

    const restoredTripMd = fs.readFileSync(
      path.join(extracted, "trips", "secret-2026", "trip.md"),
      "utf8",
    );
    expect(restoredTripMd).not.toContain("passwordHash");
    expect(restoredTripMd).not.toContain("scrypt$");
  });
});
