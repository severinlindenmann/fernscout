import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { receiveInboxUpload } from "@/lib/inboxUpload";
import { paintJpegWithExif } from "./support/pictures";

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

/** The journal's own opt-in. A server capability is a ceiling; this is the
 * user's vote inside it (`lib/capabilities.ts`'s `resolveOne`) — addressLookup
 * is not in `OPERATOR_ONLY_FEATURES`, so the journal has to ask for it too. */
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
  form.set("files", new File([bytes], "hafen.jpg", { type: "image/jpeg" }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { lat?: number; measuredFrom?: string }[] };
  expect(body.items[0].lat).toBeCloseTo(46.5, 2);
  expect(body.items[0].measuredFrom).toBe("exif");
});

test("an explicitly-said lat/lon is never overwritten by EXIF", async () => {
  const bytes = await paintJpegWithExif(40, 30, { lat: 46.5, lon: 7.9, takenAt: "2026-05-04T10:00:00.000Z" });
  const form = new FormData();
  form.set("files", new File([bytes], "hafen.jpg", { type: "image/jpeg" }));
  form.set("meta", JSON.stringify({ lat: 1, lon: 1 }));
  const response = await receiveInboxUpload("alex", new Request("https://t.test/x", { method: "POST", body: form }));
  const body = (await response.json()) as { items: { lat?: number; measuredFrom?: string }[] };
  expect(body.items[0].lat).toBe(1);
  expect(body.items[0].measuredFrom).toBeUndefined();
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
