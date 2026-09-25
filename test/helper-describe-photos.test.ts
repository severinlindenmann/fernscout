import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { tripMediaDir } from "@/lib/media";
import { DESCRIBED_SCHEMA_VERSION } from "@/lib/photos/described";
import { readTripSidecar } from "@/lib/sidecar";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { paintJpeg } from "./support/pictures";
import { writeTripFixture } from "./fixtures/content";
import { dayToJson } from "@/lib/api/v2/documents";

/**
 * Photographs → captions — B687.
 *
 * **The model is stubbed; nothing here reaches a network.** `describeImage`
 * is mocked, the same discipline `test/helper-write-day.test.ts` uses for
 * `writeDay` — what a vision model actually says is not assertable, and the
 * things that go wrong are on either side of it: what was spent, and under
 * what consent.
 *
 * Since B1866 the call is **one request per photograph**, not one per day, so
 * every "called once" here about a batch of N photographs is a call count of
 * N. The assertion each one was making — that the model saw exactly the
 * photographs, and only when it was allowed to — is unchanged.
 *
 * The gallery files themselves are real — `paintJpeg` and the ordinary
 * `resizedCopy`/`sharp` pipeline, which is entirely local and needs no key —
 * so this also exercises the one thing worth exercising for real: that a
 * derivative is what gets sent, not the original, and that a day with twelve
 * photographs charges exactly two credits.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { describeImage } = vi.hoisted(() => ({ describeImage: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  describeImage,
}));

/** What the stubbed model answers with — a whole `DescribedForm` for the
 *  journal's one locale, since that is what the route stores and reads back. */
function form(locale = "en", caption = "A quiet street.") {
  return {
    caption: { [locale]: caption },
    altText: { [locale]: "A street, seen from a doorway." },
    longDescription: { [locale]: null },
    tags: ["cityscape"],
    confidence: "high" as const,
  };
}

const { POST } = await import("@/app/api/helper/[user]/day/describe-photos/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

let dir: string;
const TRIP = "a-trip";
const REF = `alex/${TRIP}`;
const SLUG = "the-pass";
const params = { params: Promise.resolve({ user: "alex" }) };

function json(body: unknown) {
  return new Request("https://t.test/api/helper/alex/day/describe-photos", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function call(over: Record<string, unknown> = {}) {
  return POST(json({ trip: TRIP, slug: SLUG, idempotency_key: "one", ...over }), params);
}

async function consent(scope: "words" | "photos" = "photos") {
  await consentRoute(
    new Request("https://t.test/api/helper/alex/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    }),
    params,
  );
}

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }),
  );
  clearConfigCache();
  clearUserCache();
}

/** The path `writeDayWithPhotos` and its callers agree the day file sits at.
 * `.json` now (B1598) — `getAllEntries` only reads that extension. */
function entryPath(): string {
  return path.join(dir, "alex", "trips", TRIP, "entries", `2026-05-04-${SLUG}.json`);
}

/**
 * Writes a day with `n` photographs, real files on disk, gallery items
 * pointing at them exactly as ingest or an upload would.
 *
 * Not on writeDayFixture (B1630): `width`/`height` on a gallery item are not
 * fields the fixture's `media` entries expose, so this is built with the
 * real production serialiser (`dayToJson`) instead.
 */
async function writeDayWithPhotos(n: number) {
  // Trip first — `createTrip` refuses a directory that already exists, and
  // `mkdirSync(media, {recursive: true})` below would otherwise have created
  // `trips/<id>/` itself as a side effect of creating `media/` under it.
  writeTripFixture("alex", {
    id: TRIP,
    title: "Over the pass",
    start: "2026-05-01",
    end: "2026-05-31",
    visibility: "public",
    intro: "Trip.",
  });
  const media = tripMediaDir(REF);
  fs.mkdirSync(path.join(media, SLUG), { recursive: true });
  const gallery = [];
  for (let i = 1; i <= n; i += 1) {
    const name = `${String(i).padStart(2, "0")}.jpg`;
    fs.writeFileSync(path.join(media, SLUG, name), await paintJpeg(400, 300, i));
    gallery.push({
      src: `/media/${TRIP}/${SLUG}/${name}`,
      type: "image" as const,
      width: 400,
      height: 300,
    });
  }
  fs.writeFileSync(
    entryPath(),
    dayToJson({
      slug: SLUG,
      title: "The pass",
      date: "2026-05-04",
      status: "draft",
      content: "Words.",
      media: gallery,
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-photos-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-describe-photos-secret-b687";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  describeImage.mockReset();
  describeImage.mockImplementation(async (_image: unknown, _owner: string, locales: string[]) =>
    form(locales[0]),
  );
  clearIdempotencyStore();

  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  writeConfig({ auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } });
  await migrateToLatest(await getDatabase());
  await grant("alex", 10);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("consent, and that words alone is not enough", () => {
  test("is refused with no consent at all", async () => {
    await writeDayWithPhotos(2);
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(describeImage).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("consenting to words alone does not cover photographs", async () => {
    await writeDayWithPhotos(2);
    await consent("words");
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(describeImage).not.toHaveBeenCalled();
  });

  test("consenting to photographs specifically lets the call through", async () => {
    await writeDayWithPhotos(2);
    await consent("photos");
    const done = await read(await call());
    expect(done.status).toBe(200);
    // One call per photograph since B1866, where this was one per day.
    expect(describeImage).toHaveBeenCalledTimes(2);
  });
});

describe("what it costs", () => {
  beforeEach(async () => {
    await consent("photos");
  });

  test("twelve photographs cost two credits, rounding up", async () => {
    await writeDayWithPhotos(12);
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(done.body.spent).toBe(2);
    expect(await balanceOf("alex")).toBe(8);
  });

  test("a retry under the same idempotency key spends once", async () => {
    await writeDayWithPhotos(12);
    const first = await read(await call());
    const again = await read(await call());
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    // Twelve photographs, twelve calls, and the replay adds none.
    expect(describeImage).toHaveBeenCalledTimes(12);
    expect(await balanceOf("alex")).toBe(8);
  });

  test("a failed model call refunds the credit", async () => {
    await writeDayWithPhotos(2);
    describeImage.mockRejectedValueOnce(new Error("provider is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
    expect(await balanceOf("alex")).toBe(10);
  });

  test("every photograph failing to resize refunds the credit — B1795", async () => {
    await writeDayWithPhotos(2);
    // Real files, but not real JPEGs — `resizedCopy` returns null for these
    // (see `test/media-resize.test.ts`'s own "broken.jpg"), the same as a
    // corrupt original or a permissions problem on the day's actual media.
    for (const name of ["01.jpg", "02.jpg"]) {
      fs.writeFileSync(path.join(tripMediaDir(REF), SLUG, name), "not really a jpeg");
    }
    // Its own rate-limit bucket, same reason `describe("a photograph is
    // described once")` below gives every one of its own calls one — this
    // file's shared "unknown" bucket is sized to exactly the calls already
    // using it.
    const request = json({ trip: TRIP, slug: SLUG, idempotency_key: "broken-resize" });
    request.headers.set("x-forwarded-for", "203.0.113.201");
    const failed = await read(await POST(request, params));
    expect(failed.status).toBe(502);
    expect(describeImage).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("a day with no photographs is refused before any spend", async () => {
    writeTripFixture("alex", {
      id: TRIP,
      title: "Over the pass",
      start: "2026-05-01",
      end: "2026-05-31",
      visibility: "public",
      intro: "Trip.",
    });
    const tripDir = path.join(dir, "alex", "trips", TRIP);
    fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(tripDir, "entries", `2026-05-04-${SLUG}.json`),
      dayToJson({
        slug: SLUG,
        title: "The pass",
        date: "2026-05-04",
        status: "draft",
        content: "Words.",
      }),
    );
    const refused = await read(await call());
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("no_photos");
    expect(await balanceOf("alex")).toBe(10);
  });
});

describe("a mixed day — B873", () => {
  test("a video on the day gets its own row, marked skipped, not silently dropped", async () => {
    await writeDayWithPhotos(2);
    // A third gallery item, a video, appended to the day already written by
    // writeDayWithPhotos — no file needs to exist on disk for it, since a
    // video is never resolved or resized here.
    const day = JSON.parse(fs.readFileSync(entryPath(), "utf8"));
    day.media.push({ src: "/media/a-trip/the-pass/clip.mp4", type: "video" });
    fs.writeFileSync(entryPath(), JSON.stringify(day, null, 2) + "\n");

    await consent("photos");
    // A distinct IP, so this extra call spends from its own rate-limit
    // bucket rather than the one every other test in this file shares —
    // that shared bucket is sized to exactly the calls already here.
    const request = json({ trip: TRIP, slug: SLUG, idempotency_key: "video-row" });
    request.headers.set("x-forwarded-for", "203.0.113.9");
    const done = await read(await POST(request, params));
    expect(done.status).toBe(200);
    const captions = done.body.captions as { src: string; caption: string; skipped?: string }[];
    // Every gallery item is accounted for — two photographs and the video —
    // not just the two the model actually saw.
    expect(captions).toHaveLength(3);
    const video = captions.find((c) => c.src === "/alex/media/a-trip/the-pass/clip.mp4");
    expect(video).toEqual({ src: "/alex/media/a-trip/the-pass/clip.mp4", caption: "", skipped: "video" });
    // The credit spend and the model calls still cover photographs only —
    // two calls for the two photographs, none for the video.
    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(done.body.spent).toBe(1);
  });
});

/**
 * Described once, and kept — B1866.
 *
 * Every test here uses its own `x-forwarded-for`, because the rate-limit
 * bucket the rest of this file shares is sized to exactly the calls already
 * in it.
 */
describe("a photograph is described once", () => {
  /** A call from its own rate-limit bucket, with its own idempotency key —
   *  a replay of the same key would answer from the idempotency store and
   *  prove nothing about the sidecar. */
  function from(ip: string, key: string) {
    const request = json({ trip: TRIP, slug: SLUG, idempotency_key: key });
    request.headers.set("x-forwarded-for", ip);
    return POST(request, params);
  }

  function sidecarFor(name: string) {
    return readTripSidecar(REF, path.join(SLUG, name));
  }

  test("the same day asked twice describes each photograph once and spends once", async () => {
    await writeDayWithPhotos(2);
    await consent("photos");

    const first = await read(await from("198.51.100.1", "cache-first"));
    expect(first.status).toBe(200);
    expect(first.body.spent).toBe(1);
    expect(first.body.cached).toBe(0);
    expect(await balanceOf("alex")).toBe(9);

    const again = await read(await from("198.51.100.1", "cache-second"));
    expect(again.status).toBe(200);
    // Two calls in total, both from the first request: the second asked the
    // model nothing.
    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(again.body.spent).toBe(0);
    expect(again.body.cached).toBe(2);
    // Nothing further was taken — no second spend, and no refund either.
    expect(await balanceOf("alex")).toBe(9);
    // And the captions are the same ones, read back out of the sidecars.
    expect(again.body.captions).toEqual(first.body.captions);
    // The day's gallery sees the new alt text at once: the entry cache is
    // keyed on the entry files, and the describe invalidated it (B1867).
    const gallery = getEntryBySlug(`alex/${TRIP}`, SLUG, AS_AUTHOR)!.gallery;
    expect(gallery.map((item) => item.alt)).toEqual(["A street, seen from a doorway.", "A street, seen from a doorway."]);
  });

  test("a throw part-way through refunds the whole spend and keeps what was already described", async () => {
    await writeDayWithPhotos(2);
    await consent("photos");
    // The second photograph to reach the model throws. Which of the two that
    // is is deliberately not asserted — they are resized and sent three at a
    // time, so the order is the pool's, not the gallery's. What matters is
    // that one succeeded, one did not, and the ledger is whole.
    let calls = 0;
    describeImage.mockImplementation(async (_image: unknown, _owner: string, locales: string[]) => {
      calls += 1;
      if (calls === 2) throw new Error("provider is unhappy");
      return form(locales[0]);
    });

    const failed = await read(await from("198.51.100.2", "partial"));
    expect(failed.status).toBe(502);
    // The whole spend comes back, because the spend was priced whole.
    expect(await balanceOf("alex")).toBe(10);
    // Exactly one of the two was described before the throw, and that one is
    // kept — the other has no block at all, never a half-written one.
    const blocks = ["01.jpg", "02.jpg"].map((name) => sidecarFor(name)?.described);
    expect(blocks.filter(Boolean)).toHaveLength(1);

    // So the retry pays for the one that is genuinely still missing, and asks
    // the model about that one only.
    describeImage.mockImplementation(async (_image: unknown, _owner: string, locales: string[]) =>
      form(locales[0]),
    );
    const retry = await read(await from("198.51.100.2", "partial-retry"));
    expect(retry.status).toBe(200);
    expect(retry.body.cached).toBe(1);
    expect(retry.body.spent).toBe(1);
    // Two failed-or-succeeded calls on the first request, one on the retry.
    expect(describeImage).toHaveBeenCalledTimes(3);
    expect(await balanceOf("alex")).toBe(9);
  });

  test("a derivative replaced in place is described again", async () => {
    await writeDayWithPhotos(1);
    await consent("photos");
    await from("198.51.100.3", "replace-first");
    expect(describeImage).toHaveBeenCalledTimes(1);

    // Same name, different bytes — a re-crop, a re-export.
    fs.writeFileSync(path.join(tripMediaDir(REF), SLUG, "01.jpg"), await paintJpeg(400, 300, 200));

    const again = await read(await from("198.51.100.3", "replace-second"));
    expect(again.status).toBe(200);
    expect(again.body.cached).toBe(0);
    expect(again.body.spent).toBe(1);
    expect(describeImage).toHaveBeenCalledTimes(2);
  });

  test("a malformed described block is absent, never a half-answer", async () => {
    await writeDayWithPhotos(1);
    await consent("photos");
    await from("198.51.100.4", "malformed-first");
    expect(describeImage).toHaveBeenCalledTimes(1);

    const file = path.join(dir, "alex", "trips", TRIP, "meta", SLUG, "01.jpg.meta.json");
    const sidecar = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(sidecar.described.schemaVersion).toBe(DESCRIBED_SCHEMA_VERSION);
    // Hand-edited into something that no longer parses — the caption is gone
    // and the hash is a number.
    sidecar.described = { ...sidecar.described, caption: "a string", contentHash: 7 };
    fs.writeFileSync(file, JSON.stringify(sidecar, null, 2));

    const again = await read(await from("198.51.100.4", "malformed-second"));
    expect(again.status).toBe(200);
    expect(again.body.cached).toBe(0);
    expect(describeImage).toHaveBeenCalledTimes(2);
  });

  test("a video is skipped and never described, cached or not", async () => {
    await writeDayWithPhotos(1);
    const day = JSON.parse(fs.readFileSync(entryPath(), "utf8"));
    day.media.push({ src: "/media/a-trip/the-pass/clip.mp4", type: "video" });
    fs.writeFileSync(entryPath(), JSON.stringify(day, null, 2) + "\n");
    await consent("photos");

    const done = await read(await from("198.51.100.5", "video-cached"));
    const captions = done.body.captions as { src: string; skipped?: string }[];
    expect(captions.find((c) => c.src.endsWith("clip.mp4"))?.skipped).toBe("video");
    expect(describeImage).toHaveBeenCalledTimes(1);
    expect(done.body.cached).toBe(0);

    // And on the second ask the photograph is cached while the video is
    // still simply skipped — never described from a poster frame.
    const again = await read(await from("198.51.100.5", "video-cached-2"));
    expect(again.body.cached).toBe(1);
    expect(describeImage).toHaveBeenCalledTimes(1);
    const rows = again.body.captions as { src: string; skipped?: string }[];
    expect(rows.find((c) => c.src.endsWith("clip.mp4"))?.skipped).toBe("video");
  });
});

describe("what is sent", () => {
  test("a resized derivative goes to the model, not the raw upload bytes", async () => {
    await writeDayWithPhotos(1);
    await consent("photos");
    await call();
    expect(describeImage).toHaveBeenCalledTimes(1);
    const [image] = describeImage.mock.calls[0] as [{ base64: string; mediaType: string }];
    expect(image.mediaType).toBe("image/webp");
    // The source file was a 400x300 JPEG; a webp derivative at that width is
    // never anywhere near as large as an original at print resolution would
    // be, so a much bigger payload here would mean the original leaked in.
    expect(Buffer.from(image.base64, "base64").byteLength).toBeLessThan(200_000);
  });

  // B734 — a caption has no notes to take a language from, so the journal's
  // own locale has to be told to the model rather than inferred.
  test("the journal's own locales reach describeImage, not a hard-coded English", async () => {
    fs.writeFileSync(
      path.join(dir, "alex", "config.json"),
      JSON.stringify({
        title: "Alex",
        tagline: "t",
        owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
        defaultLocale: "de",
        locales: ["de"],
        baseCurrency: "CHF",
      }),
    );
    clearUserCache();
    await writeDayWithPhotos(1);
    await consent("photos");
    await call();
    // The signature is (image, owner, locales): the owner is what the credit
    // ledger is booked against (B7xx), the locales are this journal's own —
    // every one of them since B1866, not only the default.
    const [, owner, locales] = describeImage.mock.calls[0] as [unknown, string, string[]];
    expect(owner).toBe("alex");
    expect(locales).toEqual(["de"]);
  });
});

describe("with the capability off", () => {
  test("the route refuses rather than failing", async () => {
    await writeDayWithPhotos(2);
    writeConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(describeImage).not.toHaveBeenCalled();
  });
});

describe("bearer tokens", () => {
  test("are refused; only the owner's cookie is honoured", async () => {
    await writeDayWithPhotos(2);
    await consent("photos");
    resolveAccess.mockResolvedValueOnce({ email: null });
    const refused = await read(
      await POST(
        new Request("https://t.test/api/helper/alex/day/describe-photos", {
          method: "POST",
          headers: { authorization: "Bearer not-a-cookie", "content-type": "application/json" },
          body: JSON.stringify({ trip: TRIP, slug: SLUG }),
        }),
        params,
      ),
    );
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("not_your_journal");
  });
});
