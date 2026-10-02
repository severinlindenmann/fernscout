import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createJournal } from "@/lib/journals";
import { writeTripFixture } from "./fixtures/content";

vi.mock("server-only", () => ({}));
const { dateInMessage, tripForDate, describeDate } = await import("@/lib/helper/tools/resolve");

/** B1760 — a date in the message and exactly one trip containing it is a fact, not a choice. */
describe("dateInMessage", () => {
  test.each([
    ["3.6 eger burg den ganzen tag sehr heiss", { month: 6, day: 3 }],
    ["3.6.26 Eger", { year: 2026, month: 6, day: 3 }],
    ["03/06/2026 Eger", { year: 2026, month: 6, day: 3 }],
    ["2026. 06. 03. Eger vár", { year: 2026, month: 6, day: 3 }],
    ["2026-06-03 Eger", { year: 2026, month: 6, day: 3 }],
    ["am 3. Juni in Eger", { month: 6, day: 3 }],
    ["June 3 Eger", { month: 6, day: 3 }],
    ["június 3 Eger", { month: 6, day: 3 }],
    ["3 március 2026", { year: 2026, month: 3, day: 3 }],
  ])("%s", (said, want) => expect(dateInMessage(said)).toMatchObject(want));

  test.each(["Eger burg, heiss", "kostete 12.50 CHF", "wir fahren nach Mai", "31.13 Eger", ""])(
    "no date in %j",
    (said) => expect(dateInMessage(said)).toBeUndefined(),
  );
});

describe("tripForDate", () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-resolve-date-"));
    process.env.CONTENT_DIR = dir;
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ site: { name: "T", url: "https://t.test" }, users: { reserved: [] } }));
    clearConfigCache();
    clearUserCache();
    await migrateToLatest(await getDatabase());
    expect(
      createJournal({ username: "ulrike", title: "U", ownerEmail: "ulrike@example.test", ownerName: "U", ownerNickname: "U", defaultLocale: "en" }).ok,
    ).toBe(true);
  });
  afterEach(async () => {
    await closeDatabase();
    delete process.env.CONTENT_DIR;
  });

  test("one trip contains the date", () => {
    writeTripFixture("ulrike", { id: "ungarn", title: "Ungarn", start: "2026-05-30", end: "2026-06-10" });
    expect(tripForDate("ulrike", "3.6 eger burg")).toEqual({ id: "ungarn", title: "Ungarn", date: "2026-06-03" });
    expect(describeDate("ulrike", "3.6 eger burg")).toContain("ungarn");
  });
  test("two trips contain it, none contains it, no date: nothing", () => {
    writeTripFixture("ulrike", { id: "a", start: "2026-05-30", end: "2026-06-10" });
    writeTripFixture("ulrike", { id: "b", start: "2026-06-01", end: "2026-06-05" });
    expect(tripForDate("ulrike", "3.6 eger")).toBeUndefined();
    expect(tripForDate("ulrike", "20.8 eger")).toBeUndefined();
    expect(tripForDate("ulrike", "eger burg")).toBeUndefined();
    expect(describeDate("ulrike", "3.6 eger")).toBe("");
  });
  test("an explicit year outside the trip does not match", () => {
    writeTripFixture("ulrike", { id: "a", start: "2026-05-30", end: "2026-06-10" });
    expect(tripForDate("ulrike", "3.6.2025")).toBeUndefined();
    expect(tripForDate("ulrike", "3.6.26")?.id).toBe("a");
  });
});
