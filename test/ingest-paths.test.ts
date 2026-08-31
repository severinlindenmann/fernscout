import { describe, expect, test } from "vitest";
import path from "node:path";
import { contentRoot as siteContentRoot } from "@/lib/contentRoot";
import { tripDir as siteTripDir, tripRef } from "@/lib/trips";
import { mediaUrl, tripMediaDir } from "@/lib/media";
import {
  contentRoot,
  entriesDir,
  frontmatterSrc,
  manifestFile,
  mediaDir,
  tripDir,
} from "@/lib/ingest/paths";

/**
 * Ingest is a CLI and cannot import the site's content model, which sits
 * behind `server-only`. So it restates the layout — and this file is what
 * stops the two drifting apart. Under vitest `server-only` is stubbed, which
 * makes comparing them possible here and nowhere else.
 */
describe("ingest writes where the site reads", () => {
  const user = "alice";
  const trip = "patagonia";

  test("the content root is the same root", () => {
    expect(contentRoot()).toBe(siteContentRoot());
  });

  test("a trip folder is the same folder", () => {
    expect(tripDir(user, trip)).toBe(siteTripDir(tripRef(user, trip)));
  });

  test("the media folder is the same folder", () => {
    expect(mediaDir(user, trip)).toBe(tripMediaDir(tripRef(user, trip)));
  });

  test("entries land beside the ones the site reads", () => {
    expect(entriesDir(user, trip)).toBe(path.join(siteTripDir(tripRef(user, trip)), "entries"));
  });

  test("frontmatter src, once the owner is prefixed, is the URL the site serves", () => {
    // lib/entries.ts turns "/media/<trip>/x.jpg" into "/<user>/media/<trip>/x.jpg"
    // at read time. That has to match what lib/media.ts would have produced.
    const written = frontmatterSrc(trip, path.join("day-one", "01.jpg"));
    expect(`/${user}${written}`).toBe(mediaUrl(tripRef(user, trip), "day-one/01.jpg"));
  });

  test("frontmatter never contains the username", () => {
    expect(frontmatterSrc(trip, "01.jpg")).toBe("/media/patagonia/01.jpg");
  });

  test("the ledger sits at the trip root, so a copied trip carries its history", () => {
    expect(path.dirname(manifestFile(user, trip))).toBe(tripDir(user, trip));
  });

});
