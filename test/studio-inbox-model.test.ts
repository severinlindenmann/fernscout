import { describe, expect, test, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { moveInboxFileToDay, storeInboxFile } from "@/lib/inbox";
import { buildInboxHubModel, inboxFileType, inboxSummary } from "@/lib/studio/inbox";
import { earliestTodayISO } from "@/lib/tripTime";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"ux"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-inbox-model-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "ux"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ux", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("inboxFileType", () => {
  test("media splits into photo and video by extension", () => {
    expect(inboxFileType("media", "a.jpg")).toBe("photo");
    expect(inboxFileType("media", "a.HEIC")).toBe("photo");
    expect(inboxFileType("media", "a.mov")).toBe("video");
    expect(inboxFileType("media", "a.MP4")).toBe("video");
  });

  test("location and contact are unambiguous by kind", () => {
    expect(inboxFileType("location", "history.json")).toBe("location");
    expect(inboxFileType("contact", "friend.vcf")).toBe("contact");
  });

  test("a gpx or vcf that landed in files falls back to its extension", () => {
    expect(inboxFileType("files", "history.gpx")).toBe("location");
    expect(inboxFileType("files", "friend.vcf")).toBe("contact");
  });

  test("csv, txt/md and pdf/json read as statement, transcript and document", () => {
    expect(inboxFileType("files", "statement.csv")).toBe("statement");
    expect(inboxFileType("files", "notes.txt")).toBe("transcript");
    expect(inboxFileType("files", "notes.md")).toBe("transcript");
    expect(inboxFileType("files", "scan.pdf")).toBe("document");
    expect(inboxFileType("files", "export.json")).toBe("document");
  });
});

describe("buildInboxHubModel", () => {
  test("groups the flat bucket as waiting and each date folder on its own", () => {
    journal();
    const { entry: waiting } = storeInboxFile("ux", "media", "a.jpg", Buffer.from("a"), {});
    const { entry: filed } = storeInboxFile("ux", "media", "b.jpg", Buffer.from("b"), {});
    moveInboxFileToDay("ux", filed.id, "2026-05-04");

    const model = buildInboxHubModel("ux");
    expect(model.waiting.map((r) => r.id)).toEqual([waiting.id]);
    expect(model.days).toEqual([{ date: "2026-05-04", rows: [expect.objectContaining({ id: filed.id, day: "2026-05-04" })] }]);
  });

  test("a Timeline export in the general files bucket is a location tile, a plain JSON is not — B2082", () => {
    journal();
    const timeline = '[{"startTime":"2026-05-04T08:00:00.000+02:00","endTime":"2026-05-04T09:00:00.000+02:00","timelinePath":[]}]';
    const { entry: exported } = storeInboxFile("ux", "files", "Timeline.json", Buffer.from(timeline), {});
    const { entry: other } = storeInboxFile("ux", "files", "notes.json", Buffer.from('{"hello":"world"}'), {});
    const types = Object.fromEntries(buildInboxHubModel("ux").waiting.map((r) => [r.id, r.type]));
    expect(types[exported.id]).toBe("location");
    expect(types[other.id]).toBe("document");
  });

  test("day bounds run from the earliest trip's start to today", () => {
    journal();
    writeTripFixture("ux", { id: "early", title: "Early", start: "2020-01-01", end: "2020-01-10", status: "past" });
    writeTripFixture("ux", { id: "later", title: "Later", start: "2024-06-01", end: "2024-06-10", status: "past" });
    const model = buildInboxHubModel("ux");
    expect(model.dayBounds.start).toBe("2020-01-01");
    expect(model.dayBounds.end).toBe(earliestTodayISO());
  });

  test("day bounds widen to an oldest waiting file that predates every trip", () => {
    journal();
    writeTripFixture("ux", { id: "t", title: "T", start: "2024-06-01", end: "2024-06-10", status: "past" });
    storeInboxFile("ux", "media", "old.jpg", Buffer.from("a"), { takenAt: "2019-03-02T10:00:00Z" });

    const model = buildInboxHubModel("ux");
    expect(model.dayBounds.start).toBe("2019-03-02");
  });

  test("a waiting file with no taken-at falls back to when it was uploaded", () => {
    journal();
    const { entry } = storeInboxFile("ux", "media", "no-exif.jpg", Buffer.from("a"), {});
    expect(entry.takenAt).toBeUndefined();

    const model = buildInboxHubModel("ux");
    expect(model.dayBounds.start).toBe(entry.uploadedAt.slice(0, 10));
  });

  test("a trip that starts before every waiting file still wins the bound", () => {
    journal();
    writeTripFixture("ux", { id: "t", title: "T", start: "2018-01-01", end: "2018-01-10", status: "past" });
    storeInboxFile("ux", "media", "recent.jpg", Buffer.from("a"), { takenAt: "2024-06-01T10:00:00Z" });

    const model = buildInboxHubModel("ux");
    expect(model.dayBounds.start).toBe("2018-01-01");
  });

  test("written dates cover both day folders and days actually written on a trip", () => {
    const dir = journal();
    writeTripFixture("ux", { id: "t", title: "T", start: "2026-01-01", end: "2026-01-10", status: "past" });
    writeDayFixture(dir, "ux", "t", {
      slug: "first-day",
      date: "2026-01-02",
      title: "first-day",
      status: "draft",
      content: "Words.",
    });
    const { entry } = storeInboxFile("ux", "media", "a.jpg", Buffer.from("a"), {});
    moveInboxFileToDay("ux", entry.id, "2026-01-05");

    const model = buildInboxHubModel("ux");
    expect(model.writtenDates).toEqual(["2026-01-02", "2026-01-05"]);
  });
});

describe("buildInboxHubModel — dimensions and .vcf contact rows (B1995)", () => {
  test("a photo's dimensions on the sidecar ride straight through to its row", () => {
    journal();
    storeInboxFile("ux", "media", "a.jpg", Buffer.from("a"), { dimensions: { width: 1920, height: 1080 } });

    const model = buildInboxHubModel("ux");
    expect(model.waiting[0].dimensions).toEqual({ width: 1920, height: 1080 });
  });

  test("a photo with no measured dimensions (uploaded before B1995) has none, not zeros", () => {
    journal();
    storeInboxFile("ux", "media", "a.jpg", Buffer.from("a"), {});

    const model = buildInboxHubModel("ux");
    expect(model.waiting[0].dimensions).toBeUndefined();
  });

  test("a .vcf tile carries its name, first email and counts", () => {
    const dir = journal();
    const vcf = ["BEGIN:VCARD", "FN:Maria", "TEL:+41791234567", "TEL:+41797654321", "EMAIL:maria@example.test", "END:VCARD"].join("\n");
    fs.writeFileSync(path.join(dir, "friend.vcf"), vcf);
    storeInboxFile("ux", "contact", "friend.vcf", fs.readFileSync(path.join(dir, "friend.vcf")), {});

    const model = buildInboxHubModel("ux");
    expect(model.waiting[0].contact).toEqual({
      name: "Maria",
      email: "maria@example.test",
      phones: 2,
      emails: 1,
    });
  });

  test("a malformed .vcf falls back to no contact block rather than breaking the page", () => {
    journal();
    storeInboxFile("ux", "contact", "broken.vcf", Buffer.from("not a vcard at all"), {});

    const model = buildInboxHubModel("ux");
    // No FN:/TEL:/EMAIL: lines at all — readVCard answers empty, not a throw.
    expect(model.waiting[0].contact).toEqual({ name: undefined, email: undefined, phones: 0, emails: 0 });
  });

  test("a .vcf over the 64 KB bound is never read, even though it is a real card", () => {
    journal();
    const huge = "BEGIN:VCARD\nFN:Maria\n" + "TEL:+41791234567\n".repeat(5000) + "END:VCARD\n";
    expect(Buffer.byteLength(huge)).toBeGreaterThan(64 * 1024);
    storeInboxFile("ux", "contact", "huge.vcf", Buffer.from(huge), {});

    const model = buildInboxHubModel("ux");
    expect(model.waiting[0].contact).toBeUndefined();
  });

  test("one malformed .vcf does not take down another file's own row", () => {
    journal();
    storeInboxFile("ux", "contact", "broken.vcf", Buffer.from("\x00\x01garbage"), {});
    storeInboxFile("ux", "media", "a.jpg", Buffer.from("a"), {});

    const model = buildInboxHubModel("ux");
    expect(model.waiting).toHaveLength(2);
  });
});

describe("buildInboxHubModel — previews (B2084)", () => {
  test("a CSV carries its first rows as a small table, quotes and semicolons honoured", () => {
    journal();
    const csv = 'Date;Description;Amount\n2026-08-01;Bakery;-7.40\n2026-08-02;"Hotel; two nights";-420.00\n2026-08-03;Refund;12.00\n2026-08-04;More;1\n';
    storeInboxFile("ux", "files", "statement.csv", Buffer.from(csv), {});

    const [row] = buildInboxHubModel("ux").waiting;
    expect(row.preview).toEqual({
      kind: "table",
      rows: [
        ["Date", "Description", "Amount"],
        ["2026-08-01", "Bakery", "-7.40"],
        ["2026-08-02", "Hotel; two nights", "-420.00"],
        ["2026-08-03", "Refund", "12.00"],
      ],
    });
  });

  test("a location export is named by its format and never carries a coordinate", () => {
    journal();
    const json = JSON.stringify({
      semanticSegments: [{ startTime: "2026-08-01T08:00:00Z", timelinePath: [{ point: "46.0200°, 7.7490°", time: "2026-08-01T08:10:00Z" }] }],
    });
    storeInboxFile("ux", "files", "Timeline.json", Buffer.from(json), {});

    const [row] = buildInboxHubModel("ux").waiting;
    expect(row.preview).toEqual({ kind: "location", format: "Google Maps Timeline (phone export)" });
    expect(JSON.stringify(row)).not.toContain("46.02");
  });

  test("a JSON nothing recognises, a photo and a PDF carry no preview block", () => {
    journal();
    storeInboxFile("ux", "files", "other.json", Buffer.from('{"a":1}'), {});
    storeInboxFile("ux", "files", "scan.pdf", Buffer.from("%PDF"), {});
    storeInboxFile("ux", "media", "a.jpg", Buffer.from("a"), {});

    expect(buildInboxHubModel("ux").waiting.map((r) => r.preview)).toEqual([undefined, undefined, undefined]);
  });
});

describe("inboxSummary", () => {
  /** B2134 — the hub chip counts what the inbox page renders, day folders
   *  included; B1990 counted only the flat bucket (11 files over 12 cards). */
  test("counts and sizes every card the inbox page renders", () => {
    journal();
    storeInboxFile("ux", "media", "a.jpg", Buffer.from("abcd"), {});
    const { entry: filed } = storeInboxFile("ux", "media", "b.jpg", Buffer.from("abcdefgh"), {});
    moveInboxFileToDay("ux", filed.id, "2026-05-04");
    storeInboxFile("ux", "contact", "anna.vcf", Buffer.from("BEGIN:VCARD\nEND:VCARD\n"), {});

    const summary = inboxSummary("ux");
    const model = buildInboxHubModel("ux");
    const rows = [...model.waiting, ...model.days.flatMap((d) => d.rows)];
    expect(summary.count).toBe(3);
    expect(summary.count).toBe(rows.length);
    expect(summary.bytes).toBe(rows.reduce((n, r) => n + r.bytes, 0));
  });
});
