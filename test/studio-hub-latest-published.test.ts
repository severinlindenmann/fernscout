// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildStudioHubModel } from "@/lib/studio/hub";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2678 — the hub's "Share as a story" card names the most recently
 * published day of the *current* trip, never a draft and never a different
 * trip's day.
 */
const OWNER = "alex";

describe("buildStudioHubModel — latestPublishedDay (B2678)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hub-latest-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }));
    fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({ title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A", email: "alex@example.test" }, locales: ["en"], defaultLocale: "en" }),
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

  test("picks the most recent published day of the current trip, skipping drafts and other trips", async () => {
    writeTripFixture(OWNER, { id: "alps", title: "Alps", start: "2020-01-01", end: "2099-01-01", visibility: "public", listed: true });
    writeTripFixture(OWNER, { id: "jp", title: "Japan", start: "2015-01-01", end: "2015-01-10" });
    writeDayFixture(dir, OWNER, "alps", { slug: "first", title: "First day", date: "2020-06-01", status: "published" });
    writeDayFixture(dir, OWNER, "alps", { slug: "second", title: "Second day", date: "2020-06-05", status: "published" });
    writeDayFixture(dir, OWNER, "alps", { slug: "newer-draft", title: "Still a draft", date: "2020-06-09", status: "draft" });
    writeDayFixture(dir, OWNER, "jp", { slug: "far-away", title: "Not this trip", date: "2099-01-05", status: "published" });

    const model = await buildStudioHubModel(OWNER);
    expect(model.kind).toBe("full");
    if (model.kind !== "full") return;
    expect(model.addDayTrip?.id).toBe("alps");
    expect(model.latestPublishedDay).toEqual({ tripId: "alps", slug: "second", title: "Second day", date: "2020-06-05" });
  });

  test("null when the current trip has no published day", async () => {
    writeTripFixture(OWNER, { id: "alps", title: "Alps", start: "2020-01-01", end: "2099-01-01" });
    writeDayFixture(dir, OWNER, "alps", { slug: "only-draft", title: "Draft", date: "2020-06-01", status: "draft" });

    const model = await buildStudioHubModel(OWNER);
    expect(model.kind).toBe("full");
    if (model.kind !== "full") return;
    expect(model.latestPublishedDay).toBeNull();
  });

  test("B2828 — null for a day only the owner can open (private trip, nobody else on it)", async () => {
    writeTripFixture(OWNER, { id: "alps", title: "Alps", start: "2020-01-01", end: "2099-01-01", visibility: "private" });
    writeDayFixture(dir, OWNER, "alps", { slug: "mine", title: "Mine", date: "2020-06-01", status: "published" });

    const model = await buildStudioHubModel(OWNER);
    expect(model.kind).toBe("full");
    if (model.kind !== "full") return;
    expect(model.latestPublishedDay).toBeNull();
  });
});
