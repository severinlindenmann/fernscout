import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B318 — a draft day showed three of its nine photographs, all nine once
 * published.
 *
 * Both gallery pages (`/[user]/gallery`, the current trip's; and
 * `/[user]/trips/[trip]/gallery`, every other trip's) called
 * `getAllMedia`/`getPlaces` with no `ReadOptions` at all — unlike the day page
 * and the trip page, which both resolve `isOwner` and pass
 * `{ includeDrafts: owner }` through. So the gallery page filtered drafts out
 * for *every* viewer, owner included: it was never "the owner sees less than
 * they wrote", it was "this one page never checked who was asking".
 *
 * The reported "three of nine" is explained by this fixture, not by a second
 * bug: the trip already had three published photographs (one each on three
 * already-published days) before an agent added three more draft days with
 * two photographs apiece. `getAllMedia(ref)` with no options returns exactly
 * the three published ones on both pages — the owner saw the old total, not a
 * capped preview of the new one, and publishing made the other six appear
 * because that is the only thing that changed.
 */

let dir: string;

function entry(name: string, date: string, photos: number, draft: boolean) {
  const gallery = Array.from({ length: photos }, (_, i) => [
    `  - src: "/media/asia-2023/${name.replace(".md", "")}/0${i + 1}.jpg"`,
    "    type: image",
  ].join("\n")).join("\n");
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "asia-2023", "entries", name),
    [
      "---",
      `title: "${name}"`,
      `date: "${date}"`,
      'location: "Bangkok"',
      'country: "Thailand"',
      "lat: 13.7",
      "lng: 100.5",
      "gallery:",
      gallery,
      ...(draft ? ["status: draft"] : []),
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

function writeTrip(id: string, status: "current" | "past") {
  fs.mkdirSync(path.join(dir, "alex", "trips", id, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "trips", id, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      'title: "Asia"',
      'start: "2026-01-01"',
      'end: "2026-01-09"',
      `status: "${status}"`,
      'visibility: "public"',
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gallery-drafts-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: "alex" },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" },
      startLocation: "X", defaultLocale: "en", locales: ["en"],
      baseCurrency: "CHF", displayCurrencies: ["CHF"], units: "metric", features: {},
    }),
  );
  writeTrip("asia-2023", "current");
  // Three already-published days, one photo each — the trip's total before
  // the agent's visit.
  entry("2026-01-01-a.md", "2026-01-01", 1, false);
  entry("2026-01-02-b.md", "2026-01-02", 1, false);
  entry("2026-01-03-c.md", "2026-01-03", 1, false);
  // Three new draft days, two photos each — nine photographs on disk in all.
  entry("2026-01-04-d.md", "2026-01-04", 2, true);
  entry("2026-01-05-e.md", "2026-01-05", 2, true);
  entry("2026-01-06-f.md", "2026-01-06", 2, true);
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

/** The current-trip gallery page's own output tree, for the given viewer —
 * not a call to `getAllMedia` in isolation, but the actual `page.tsx` this
 * fixture is about. */
async function currentGalleryProps(owner: boolean) {
  vi.resetModules();
  vi.doMock("@/lib/contacts/session", () => ({ isOwner: async () => owner }));
  const { default: GalleryPage } = await import("@/app/[user]/(trip)/gallery/page");
  const element = (await GalleryPage({
    params: Promise.resolve({ user: "alex" }),
  } as never)) as {
    props: { children: { props: { media: unknown[]; places: unknown[] } } };
  };
  return element.props.children.props;
}

describe("the current trip's gallery page (/[user]/gallery)", () => {
  test("the owner sees every photograph, including the draft days' six", async () => {
    const props = await currentGalleryProps(true);
    expect(props.media).toHaveLength(9);
  });

  /** Acceptance's second half, and the one that matters most: a stranger's
   * page is untouched, asserted against the page's real output rather than
   * against `getAllMedia`'s return value. */
  test("a stranger sees none of the draft days' photographs", async () => {
    const props = await currentGalleryProps(false);
    expect(props.media).toHaveLength(3);
  });
});
