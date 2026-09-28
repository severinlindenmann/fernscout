import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { patchTripDetails } from "@/lib/api/tripDetails";
import { readTripJson } from "@/lib/api/tripFile";
import { getTrip, tripRef } from "@/lib/trips";
import { writeTripFixture } from "./fixtures/content";

/**
 * A trip's `cover` is stored trip-relative (`/media/<trip>/…`) and served
 * owner-prefixed (`/@<user>/media/<trip>/…` — `mediaWithOwner`). Saving the
 * trip's details strips the owner back off. It used to strip `/<user>/`,
 * which stopped matching once journals moved under `@`, so every title edit
 * wrote the served form into trip.json.
 */

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-cover-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "USD",
    }),
  );
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

test("a details edit keeps the stored cover trip-relative", () => {
  const { ref } = writeTripFixture("alex", { id: "alps", start: "2026-01-01", end: "2026-01-05" });
  const stored = readTripJson(ref)!;
  fs.writeFileSync(stored.file, JSON.stringify({ ...stored.trip, cover: "/media/alps/one/01.jpg" }, null, 2));

  expect(getTrip(tripRef("alex", "alps"))?.cover).toBe("/@alex/media/alps/one/01.jpg");

  const result = patchTripDetails(tripRef("alex", "alps"), { title: "Alps again" });
  expect(result.ok).toBe(true);
  const after = readTripJson(ref)!.trip as { cover?: string; title?: string };
  expect(after.title).toBe("Alps again");
  expect(after.cover).toBe("/media/alps/one/01.jpg");
});
