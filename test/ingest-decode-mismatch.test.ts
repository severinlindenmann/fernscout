import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import sharp from "sharp";

/**
 * B869 — a decoder that answers with the wrong picture is not a success.
 *
 * A HEIC carries an embedded thumbnail beside the photograph. On the live
 * server, where the only decoder on `PATH` was ffmpeg, something handed back a
 * 512×512 strip of sky for a 1600×1200 photograph, exit 0, and the upload
 * answered `201` with those fabricated dimensions in `items` **and** in
 * `kept` — the one field that exists so a caller can see the print original
 * survived rather than infer it from a promise.
 *
 * The invariant is cheap and holds whatever decoder is installed: sharp reads
 * the container's declared size even when it cannot decode a pixel of the
 * payload, so the two numbers can be compared.
 *
 * This file stands alone because `findHeifDecoder` caches its probe for the
 * life of the process (deliberately — see the comment on it). vitest gives
 * each test file its own module registry, so a `PATH` planted here is the one
 * that gets probed. `phone.heic` is 80×120 and sharp's prebuilt libvips has no
 * HEVC decoder, so the fallback chain is genuinely entered.
 */

const FIXTURES = path.join(process.cwd(), "test/fixtures/ingest");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-decoder-stub-"));
const realPath = process.env.PATH;

afterAll(() => {
  process.env.PATH = realPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

// Planted before anything imports the decoder: the probe is cached from the
// first call onwards, so both tests below must find the stub already on PATH.
beforeAll(async () => {
  // The thumbnail this stub stands in for: a real PNG, and the wrong size.
  const wrong = path.join(dir, "thumbnail.png");
  await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#88aacc" },
  })
    .png()
    .toFile(wrong);

  const stub = path.join(dir, "heif-convert");
  fs.writeFileSync(stub, `#!/bin/sh\n[ "$1" = "--help" ] && exit 0\ncp ${wrong} "$2"\n`);
  fs.chmodSync(stub, 0o755);
  process.env.PATH = `${dir}:${realPath}`;
});

test("a decoder that returns a different-sized picture is refused, not served", async () => {
  const { decodeSource } = await import("@/lib/ingest/image");

  await expect(decodeSource(path.join(FIXTURES, "phone.heic"))).rejects.toThrow(
    /40×40 image for a file that declares 80×120/,
  );
});

test("the upload is refused, nothing is written, and the reason travels", async () => {
  const content = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-decoder-upload-"));
  process.env.CONTENT_DIR = content;
  delete process.env.MEDIA_ORIGINALS_DIR;
  const trip = path.join(content, "alex", "trips", "asia-2026");
  fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(content, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://e.test", defaultUser: "alex" },
      users: {},
      features: {},
    }),
  );
  fs.writeFileSync(
    path.join(content, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  fs.writeFileSync(
    path.join(trip, "trip.md"),
    ['---', 'id: asia-2026', 'title: "Asia"', 'start: "2026-01-01"', 'end: "2026-02-01"', 'status: current', '---', '', 'Body.', ''].join("\n"),
  );
  fs.writeFileSync(
    path.join(trip, "entries", "2026-01-02-lanterns.md"),
    ['---', 'title: "Lanterns"', 'date: "2026-01-02"', 'location: "Hoi An"', 'country: "Vietnam"', '---', '', 'Words.', ''].join("\n"),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
  const { storeUploads } = await import("@/lib/api/media");

  const result = await storeUploads("alex/asia-2026", "lanterns", [
    { filename: "IMG_0001.HEIC", bytes: fs.readFileSync(path.join(FIXTURES, "phone.heic")) },
  ]);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  // Naming the reason is the point: "could not be decoded" alone left an agent
  // with nothing to tell the owner, and nothing to act on.
  expect(result.problems[0].hint).toMatch(/Nothing was stored/);
  expect(result.problems[0].hint).toMatch(/40×40 image for a file that declares 80×120/);

  // Not the wrong picture reported as a success: no derivative, no kept
  // original, no gallery line.
  expect(fs.existsSync(path.join(trip, "media", "lanterns"))).toBe(false);
  expect(fs.existsSync(path.join(trip, "originals", "lanterns"))).toBe(false);
  expect(fs.readFileSync(path.join(trip, "entries", "2026-01-02-lanterns.md"), "utf8")).not.toMatch(
    /gallery/,
  );

  fs.rmSync(content, { recursive: true, force: true });
});
