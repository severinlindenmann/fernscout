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
import { PHOTO_SYSTEM_PROMPT } from "@/lib/helper/model";
import { paintJpeg } from "./support/pictures";

/**
 * Photographs → captions — B687.
 *
 * **The model is stubbed; nothing here reaches a network.** `describePhotos`
 * is mocked, the same discipline `test/helper-write-day.test.ts` uses for
 * `writeDay` — what a vision model actually says is not assertable, and the
 * things that go wrong are on either side of it: what was spent, and under
 * what consent.
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

const { describePhotos } = vi.hoisted(() => ({ describePhotos: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  describePhotos,
}));

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

/** Writes a day with `n` photographs, real files on disk, gallery items
 *  pointing at them exactly as ingest or an upload would. */
async function writeDayWithPhotos(n: number) {
  const media = tripMediaDir(REF);
  fs.mkdirSync(path.join(media, SLUG), { recursive: true });
  const gallery: string[] = [];
  for (let i = 1; i <= n; i += 1) {
    const name = `${String(i).padStart(2, "0")}.jpg`;
    fs.writeFileSync(path.join(media, SLUG, name), await paintJpeg(400, 300, i));
    gallery.push(`  - src: "/media/${TRIP}/${SLUG}/${name}"\n    type: image\n    width: 400\n    height: 300`);
  }
  const tripDir = path.join(dir, "alex", "trips", TRIP);
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "entries", `2026-05-04-${SLUG}.md`),
    [
      "---",
      'title: "The pass"',
      'date: "2026-05-04"',
      "status: draft",
      "gallery:",
      ...gallery,
      "---",
      "",
      "Words.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    [
      "---",
      `id: ${TRIP}`,
      'title: "Over the pass"',
      'start: "2026-05-01"',
      'end: "2026-05-31"',
      "visibility: public",
      "---",
      "",
      "Trip.",
      "",
    ].join("\n"),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-photos-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-describe-photos-secret-b687";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  describePhotos.mockReset();
  describePhotos.mockImplementation(async (images: unknown[]) => images.map(() => "A quiet street."));
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

describe("the system prompt", () => {
  test("forbids naming a place, a person or a mood", () => {
    expect(PHOTO_SYSTEM_PROMPT).toMatch(/DESCRIBE ONLY WHAT IS VISIBLE/);
    expect(PHOTO_SYSTEM_PROMPT).toMatch(/never identify a person/i);
    expect(PHOTO_SYSTEM_PROMPT).toMatch(/do not name a place/i);
    expect(PHOTO_SYSTEM_PROMPT).toMatch(/never guess a mood/i);
  });

  // B874 — the honesty rules held, but the register invited an inventory of
  // shapes ("the colours, the setting, the action") rather than a caption a
  // person would write under their own photograph.
  test("asks for a label, not an inventory of shapes", () => {
    expect(PHOTO_SYSTEM_PROMPT).toMatch(/not an inventory of every shape/i);
    expect(PHOTO_SYSTEM_PROMPT).not.toMatch(/the colours, the setting, the action/i);
  });
});

describe("consent, and that words alone is not enough", () => {
  test("is refused with no consent at all", async () => {
    await writeDayWithPhotos(2);
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(describePhotos).not.toHaveBeenCalled();
    expect(await balanceOf("alex")).toBe(10);
  });

  test("consenting to words alone does not cover photographs", async () => {
    await writeDayWithPhotos(2);
    await consent("words");
    const refused = await read(await call());
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(describePhotos).not.toHaveBeenCalled();
  });

  test("consenting to photographs specifically lets the call through", async () => {
    await writeDayWithPhotos(2);
    await consent("photos");
    const done = await read(await call());
    expect(done.status).toBe(200);
    expect(describePhotos).toHaveBeenCalledTimes(1);
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
    expect(describePhotos).toHaveBeenCalledTimes(1);
    expect(await balanceOf("alex")).toBe(8);
  });

  test("a failed model call refunds the credit", async () => {
    await writeDayWithPhotos(2);
    describePhotos.mockRejectedValueOnce(new Error("provider is unhappy"));
    const failed = await read(await call());
    expect(failed.status).toBe(502);
    expect(await balanceOf("alex")).toBe(10);
  });

  test("a day with no photographs is refused before any spend", async () => {
    const tripDir = path.join(dir, "alex", "trips", TRIP);
    fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(tripDir, "entries", `2026-05-04-${SLUG}.md`),
      ["---", 'title: "The pass"', 'date: "2026-05-04"', "status: draft", "---", "", "Words.", ""].join("\n"),
    );
    fs.writeFileSync(
      path.join(tripDir, "trip.md"),
      [
        "---",
        `id: ${TRIP}`,
        'title: "Over the pass"',
        'start: "2026-05-01"',
        'end: "2026-05-31"',
        "visibility: public",
        "---",
        "",
        "Trip.",
        "",
      ].join("\n"),
    );
    const refused = await read(await call());
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("no_photos");
    expect(await balanceOf("alex")).toBe(10);
  });
});

describe("what is sent", () => {
  test("a resized derivative goes to the model, not the raw upload bytes", async () => {
    await writeDayWithPhotos(1);
    await consent("photos");
    await call();
    const [images] = describePhotos.mock.calls[0] as [{ base64: string; mediaType: string }[]];
    expect(images).toHaveLength(1);
    expect(images[0].mediaType).toBe("image/webp");
    // The source file was a 400x300 JPEG; a webp derivative at that width is
    // never anywhere near as large as an original at print resolution would
    // be, so a much bigger payload here would mean the original leaked in.
    expect(Buffer.from(images[0].base64, "base64").byteLength).toBeLessThan(200_000);
  });

  // B734 — a caption has no notes to take a language from, so the journal's
  // own locale has to be told to the model rather than inferred.
  test("the journal's own locale reaches describePhotos, not a hard-coded English", async () => {
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
    // The signature is (images, owner, locale): the owner is what the credit
    // ledger is booked against (B7xx), the locale is this ticket's.
    const [, owner, locale] = describePhotos.mock.calls[0] as [unknown, string, string];
    expect(owner).toBe("alex");
    expect(locale).toBe("de");
  });
});

describe("with the capability off", () => {
  test("the route refuses rather than failing", async () => {
    await writeDayWithPhotos(2);
    writeConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const refused = await read(await call());
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe("helper_unavailable");
    expect(describePhotos).not.toHaveBeenCalled();
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
