import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { resolutionNote } from "@/lib/postcard/preview";
import { A6_LANDSCAPE, PRINT_FLOOR_DPI } from "@/lib/postcard/spec";
import { orderPhotoFile, orderPrintPhoto } from "@/lib/postcard/send";
import type { PostcardOrder } from "@/lib/postcard/orders";
import { makeJpeg } from "./support/exif-jpeg";

/**
 * B1010 — which copy of the photograph goes on the card, and when that is
 * worth saying anything about.
 *
 * The card was printed from the 2000px web derivative while the original sat
 * beside it, and the preview then told the owner the photograph was too small
 * — about a file this product had chosen for them. The photobook fixed the
 * same thing in B13; this asserts that the postcard now asks the same
 * question, and that the guard in front of it did not move.
 */

const OWNER = "ana";
const TRIP = "alps-2026";
let dir: string;

function orderFor(photo: string, trip = `${OWNER}/${TRIP}`): PostcardOrder {
  return {
    id: "order-1",
    owner: OWNER,
    status: "draft",
    provider: "dry-run",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    payload: {
      trip,
      day: "over-the-pass",
      photo,
      message: "Hello.",
      from: "Ana",
      recipients: [],
      creditsEach: 20,
      locale: "en",
      expiresAt: "2026-07-08T00:00:00.000Z",
    },
  } as PostcardOrder;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-print-source-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" }, users: { reserved: [] } }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({ title: "Ana", owner: { name: "A", email: "a@example.test" } }),
  );
  const media = path.join(dir, OWNER, "trips", TRIP, "media", "pass");
  fs.mkdirSync(media, { recursive: true });
  // The web copy: what ingest serves, and what the card used to be printed from.
  fs.writeFileSync(path.join(media, "01.jpg"), await makeJpeg(1, 1200, 900));
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  clearConfigCache();
  clearUserCache();
});

async function keepOriginal(width: number, height: number) {
  const originals = path.join(dir, OWNER, "trips", TRIP, "originals", "pass");
  fs.mkdirSync(originals, { recursive: true });
  fs.writeFileSync(path.join(originals, "01.jpg"), await makeJpeg(1, width, height));
}

describe("which copy of the photograph is printed", () => {
  test("the original, when ingest kept one", async () => {
    await keepOriginal(4032, 3024);
    const source = orderPrintPhoto(orderFor("pass/01.jpg"));
    expect(source?.absolute).toContain(path.join("originals", "pass", "01.jpg"));
    expect(source?.size).toEqual({ width: 4032, height: 3024 });
  });

  test("the derivative, when it did not — a card still prints", () => {
    const source = orderPrintPhoto(orderFor("pass/01.jpg"));
    expect(source?.absolute).toContain(path.join("media", "pass", "01.jpg"));
    // No `size`: the caller then measures the file it actually has.
    expect(source?.size).toBeUndefined();
  });

  test("a path escaping the trip is refused before any of that", () => {
    // The guard is `orderPhotoFile`, and looking for a better copy must not be
    // a way around it — `payload.photo` arrives from an API call.
    const escaping = orderFor("../../../etc/passwd");
    expect(orderPhotoFile(escaping)).toBeNull();
    expect(orderPrintPhoto(escaping)).toBeNull();
  });

  test("a photograph belonging to no trip is refused", () => {
    expect(orderPrintPhoto(orderFor("pass/01.jpg", "not-a-ref"))).toBeNull();
  });
});

describe("when the page says a photograph is small", () => {
  const { trimWidthMm, trimHeightMm, bleedMm } = A6_LANDSCAPE;
  /** The pixels that land exactly on a given dpi across the bleed box. */
  const pixelsFor = (dpi: number) => ({
    width: Math.ceil(((trimWidthMm + bleedMm * 2) / 25.4) * dpi),
    height: Math.ceil(((trimHeightMm + bleedMm * 2) / 25.4) * dpi),
  });

  test("a phone photograph says nothing at all", () => {
    expect(resolutionNote(4032, 3024).ok).toBe(true);
  });

  test("the 2000px web derivative says nothing either", () => {
    // The case that produced the complaint: about 244 dpi, and fine.
    const note = resolutionNote(1500, 1125);
    expect(note.dpi).toBeGreaterThan(200);
    expect(note.ok).toBe(true);
  });

  test("the floor is where it says it is, and it is not the ideal", () => {
    const floor = pixelsFor(PRINT_FLOOR_DPI);
    expect(resolutionNote(floor.width, floor.height).ok).toBe(true);
    const under = pixelsFor(PRINT_FLOOR_DPI - 20);
    expect(resolutionNote(under.width, under.height).ok).toBe(false);
    // 300 is still the renderer's target, and is no longer the pass mark.
    expect(A6_LANDSCAPE.dpi).toBe(300);
    expect(PRINT_FLOOR_DPI).toBeLessThan(A6_LANDSCAPE.dpi);
  });

  test("an old web-sized picture is still called out", () => {
    expect(resolutionNote(640, 480).ok).toBe(false);
  });

  test("a portrait photograph is measured on the axis that has to stretch", () => {
    // Cover, not fit: the binding constraint is the short edge, and a portrait
    // original is why this was ever a common complaint.
    expect(resolutionNote(1200, 1600).dpi).toBeLessThan(
      resolutionNote(1600, 1200).dpi,
    );
  });
});
