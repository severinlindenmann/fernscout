import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import TripProvider from "@/components/TripProvider";
import GalleryGrid from "@/components/GalleryGrid";
import { getAllMedia } from "@/lib/entries";
import { dictionaryFor } from "@/lib/locales";
import type { Trip } from "@/lib/types";

/**
 * B631 — the owner's own view showed no difference between a held-back
 * photograph and an ordinary one, so there was no way to check that
 * `visibility: guest`/`private` (B596) actually did anything.
 *
 * Two layers, matching the two halves the feature itself has: `getAllMedia`
 * (lib/entries.ts) is what makes the *item* absent to a reader below the
 * label's level — already covered end to end by `test/photo-visibility.test.ts`
 * — and `GalleryGrid` (via `PhotoVisibilityBadge`) is what marks the item for
 * a reader who is allowed to see it at all. This fixture drives both from one
 * trip, so a change that widens either one is caught here rather than only in
 * the piece it happened to touch.
 */

let dir: string;
const OWNER = "alex";
const REF = `${OWNER}/reise-2026`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photo-marker-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", "reise-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", "reise-2026", "trip.md"),
    [
      "---",
      'id: "reise-2026"',
      'title: "Reise"',
      'start: "2026-08-01"',
      'end: "2026-08-02"',
      'status: "past"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", "reise-2026", "entries", "2026-08-01-bellinzona.md"),
    [
      "---",
      'title: "Ankunft"',
      'date: "2026-08-01"',
      'location: "Bellinzona"',
      'country: "Switzerland"',
      "gallery:",
      '  - src: "/media/reise-2026/bellinzona/01.jpg"',
      '    type: "image"',
      '  - src: "/media/reise-2026/bellinzona/02.jpg"',
      '    type: "image"',
      '    visibility: "private"',
      "---",
      "",
      "Ankunft.",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const trip = {
  id: "reise-2026",
  username: OWNER,
  ref: REF,
} as unknown as Trip;

function markup(reader: "public" | "person") {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <TripProvider trip={trip} isCurrent reader={reader}>
        <GalleryGrid media={getAllMedia(REF, { reader })} />
      </TripProvider>
    </LocaleProvider>,
  );
}

describe("a held-back photograph, as the gallery draws it", () => {
  test("a public reader sees neither the photograph nor a marker", () => {
    const html = markup("public");
    expect(html).not.toContain("02.jpg");
    expect(html).not.toContain("Private");
  });

  test("the owner sees the photograph, marked — and only that one", () => {
    const html = markup("person");
    expect(html).toContain("02.jpg");
    // Exactly one marker: the labelled photograph's, and not the unlabelled
    // one beside it.
    expect(html.match(/Private/g)).toHaveLength(1);
  });
});
