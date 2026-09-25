import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { receiveInboxUpload } from "@/lib/inboxUpload";
import * as geo from "@/lib/ingest/geo";
import { craftedPng, paintJpegWithExif } from "./support/pictures";

/** Porto, at the same precision `paintJpegWithExif`'s fixtures below use —
 * present in the packed offline index (`lib/ingest/geo.ts`) shipped in this
 * checkout, so B2189's tests exercise the real lookup, not a mock. */
const PORTO = { lat: 41.1579, lon: -8.6291 };

/**
 * `receiveInboxUpload` is exercised through both its callers
 * (`test/inbox-route.test.ts`, `test/helper-inbox-upload.test.ts`) but
 * neither drives it directly, and neither turns on EXIF or reverse-geocode
 * wiring — this file is the direct test of that wiring, added alongside it.
 */

const OWNER_EMAIL = "alex@example.test";

let dir: string;

function writeConfig(features: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features,
    }),
  );
}

/** A journal's own `features` block. `addressLookup` joined
 * `OPERATOR_ONLY_FEATURES` in decision 5 (B1666), so `resolveOne`
 * (`lib/capabilities.ts`) no longer reads this journal's own flag for it —
 * writing it here is harmless and no longer load-bearing for the test below,
 * kept only so this fixture still reads like a real journal's file. */
function writeUserConfig(features: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features,
    }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-inbox-upload-"));
  process.env.CONTENT_DIR = dir;
  writeConfig();
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  writeUserConfig();
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a media upload with EXIF GPS gets lat/lon it never said, tagged measuredFrom exif", async () => {
  const bytes = await paintJpegWithExif(40, 30, { lat: 46.5, lon: 7.9, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([new Uint8Array(bytes)], "hafen.jpg", { type: "image/jpeg" }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { lat?: number; measuredFrom?: string }[] };
  expect(body.items[0].lat).toBeCloseTo(46.5, 2);
  expect(body.items[0].measuredFrom).toBe("exif");
});

test("an explicitly-said lat/lon is never overwritten by EXIF", async () => {
  const bytes = await paintJpegWithExif(40, 30, { lat: 46.5, lon: 7.9, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([new Uint8Array(bytes)], "hafen.jpg", { type: "image/jpeg" }));
  form.set("meta", JSON.stringify({ lat: 1, lon: 1 }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { lat?: number; measuredFrom?: string }[] };
  expect(body.items[0].lat).toBe(1);
  expect(body.items[0].measuredFrom).toBeUndefined();
});

// B2179 — a real 48 MP iPhone photo (8064×6048, 48.8 MP) used to be refused
// only at commit, six steps into adding a day, because this door checked
// nothing but bytes. Both cases below check the same header-only read the
// commit-time check does, so a bad file is refused where it is added.

test("an 8064×6048 photograph — a real 48 MP iPhone photo — is accepted at the inbox door", async () => {
  const bytes = craftedPng(8064, 6048);
  const form = new FormData();
  form.set("files", new File([new Uint8Array(bytes)], "iphone.png", { type: "image/png" }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  expect(response.status).toBe(201);
  const body = (await response.json()) as { items: { dimensions?: { width: number; height: number } }[] };
  expect(body.items[0].dimensions).toEqual({ width: 8064, height: 6048 });
});

test("a 70 MP image is refused at the inbox door, with the file named and its real size — not a fabricated edge", async () => {
  const bytes = craftedPng(8500, 8300); // 70,550,000 px — over the 64,000,000 decode ceiling
  const form = new FormData();
  form.set("files", new File([new Uint8Array(bytes)], "wall-scan.png", { type: "image/png" }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string; problems: { field: string; got: string; expected: string }[] };
  expect(body.error).toBe("invalid_media");
  expect(body.problems).toContainEqual({
    field: "wall-scan.png.pixels",
    got: "8500×8300 (70.6 MP)",
    expected: "at most 64 MP",
  });
  // Never the `.dimensions` shape (B2179 round 2): that would mean an
  // `imageEdge` fabricated from `limits.imageEdge + 1`, a false width.
  expect(body.problems.some((p) => p.field === "wall-scan.png.dimensions")).toBe(false);
});

test("a location-kind item is reverse-geocoded when addressLookup is on", async () => {
  writeConfig({ addressLookup: { enabled: true, provider: "photon" } });
  writeUserConfig({ addressLookup: { enabled: true } });
  clearConfigCache();
  clearUserCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ features: [{ properties: { city: "Bern", country: "Schweiz", countrycode: "CH" } }] }),
      ),
    ),
  );
  const form = new FormData();
  form.set("files", new File([Buffer.from(JSON.stringify({ lat: 46.02, lon: 7.75 }))], "location.json"));
  form.set("kind", "location");
  form.set("meta", JSON.stringify({ lat: 46.02, lon: 7.75 }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { location?: string }[] };
  // The provider is whatever this checkout's test config points `addressLookup` at —
  // assert only that the field was attempted, not a specific place name.
  expect("location" in body.items[0]).toBe(true);
});

// B2189 — a photograph's own EXIF fix names a place too, offline: the packed
// place index (`lib/ingest/geo.ts`), the same lookup `placeForDay` uses, so a
// camera's coordinates never reach a third party the way `reversePlace`
// (Photon) does for the `location` kind above.

test("a media photo with EXIF GPS in Porto gets location Porto, country Portugal, offline", async () => {
  writeConfig({ addressLookup: { enabled: true } });
  writeUserConfig({ addressLookup: { enabled: true } });
  clearConfigCache();
  clearUserCache();
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const bytes = await paintJpegWithExif(40, 30, { ...PORTO, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([new Uint8Array(bytes)], "ribeira.jpg", { type: "image/jpeg" }));
  const response = await receiveInboxUpload(
    "alex",
    new Request("https://t.test/x", { method: "POST", body: form }),
  );
  const body = (await response.json()) as {
    items: { location?: string; country?: string; countryCode?: string; locationSource?: string }[];
  };
  expect(body.items[0].location).toBe("Porto");
  expect(body.items[0].country).toBe("Portugal");
  expect(body.items[0].countryCode).toBe("PT");
  expect(body.items[0].locationSource).toBe("offline");
  // The whole point: no coordinate left the process to answer this.
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("addressLookup off: an EXIF photo gets no location, and no request is made", async () => {
  // Default config from beforeEach — addressLookup absent, so off.
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const bytes = await paintJpegWithExif(40, 30, { ...PORTO, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([new Uint8Array(bytes)], "ribeira.jpg", { type: "image/jpeg" }));
  const response = await receiveInboxUpload(
    "alex",
    new Request("https://t.test/x", { method: "POST", body: form }),
  );
  const body = (await response.json()) as { items: { location?: string; locationSource?: string }[] };
  expect(body.items[0].location).toBeUndefined();
  expect(body.items[0].locationSource).toBeUndefined();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("two photos at the same rounded place look it up once", async () => {
  writeConfig({ addressLookup: { enabled: true } });
  writeUserConfig({ addressLookup: { enabled: true } });
  clearConfigCache();
  clearUserCache();
  const spy = vi.spyOn(geo, "reverseGeocode");
  const a = await paintJpegWithExif(40, 30, { lat: PORTO.lat, lon: PORTO.lon, takenAt: "2026-05-04T10:00:00.000Z" });
  const b = await paintJpegWithExif(40, 30, {
    lat: PORTO.lat + 0.0001,
    lon: PORTO.lon - 0.0001,
    takenAt: "2026-05-04T11:00:00.000Z",
  });
  const form = new FormData();
  form.append("files", new File([new Uint8Array(a)], "one.jpg", { type: "image/jpeg" }));
  form.append("files", new File([new Uint8Array(b)], "two.jpg", { type: "image/jpeg" }));
  const response = await receiveInboxUpload(
    "alex",
    new Request("https://t.test/x", { method: "POST", body: form }),
  );
  const body = (await response.json()) as { items: { location?: string }[] };
  expect(body.items).toHaveLength(2);
  expect(body.items[0].location).toBe("Porto");
  expect(body.items[1].location).toBe("Porto");
  // Both photos round to the same key (0.01° ≈ 1 km), so the underlying
  // lookup ran once, not once per photo.
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
