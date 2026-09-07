import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { tripMediaDir } from "@/lib/media";
import { paintJpeg } from "./support/pictures";

/**
 * B851 — a photograph could not be taken out of a day from a browser.
 *
 * `DELETE /api/v1/<user>/trips/<trip>/media` has done the work since B605 and
 * nothing in the browser called it; the only remedy on a screen was B816's
 * whole-day takedown, which is the wrong size for the request that actually
 * arrives — somebody who is not the owner, asking about their face in one
 * picture.
 *
 * Three things are asserted, and they are the three that would let this fail
 * quietly: the photograph really leaves the day (the `gallery:` block *and*
 * the file on disk, since a picture kept out of the gallery at a guessable
 * URL is not removed at all), somebody who is not the owner is refused, and
 * hiding — B596's label, the gentler answer offered beside removal — writes
 * the label rather than deleting anything.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { DELETE } = await import("@/app/api/helper/[user]/day/media/route");
const { PATCH } = await import("@/app/api/helper/[user]/day/route");

let dir: string;
const TRIP = "a-trip";
const REF = `alex/${TRIP}`;
const SLUG = "the-pass";
const params = { params: Promise.resolve({ user: "alex" }) };

function body(method: string, url: string, payload: unknown) {
  return new Request(`https://t.test${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function remove(src: string[]) {
  return DELETE(
    body("DELETE", "/api/helper/alex/day/media", { trip: TRIP, day: SLUG, src }),
    params,
  );
}

/** Two photographs, real files on disk, exactly as an upload leaves them. */
async function writeDay() {
  const media = tripMediaDir(REF);
  fs.mkdirSync(path.join(media, SLUG), { recursive: true });
  const gallery: string[] = [];
  for (const name of ["01.jpg", "02.jpg"]) {
    fs.writeFileSync(path.join(media, SLUG, name), await paintJpeg(400, 300, 1));
    gallery.push(
      `  - src: "/media/${TRIP}/${SLUG}/${name}"\n    type: image\n    width: 400\n    height: 300`,
    );
  }
  const tripDir = path.join(dir, "alex", "trips", TRIP);
  fs.mkdirSync(path.join(tripDir, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripDir, "entries", `2026-05-04-${SLUG}.md`),
    ["---", 'title: "The pass"', 'date: "2026-05-04"', "status: draft", "gallery:", ...gallery, "---", "", "Words.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(tripDir, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "Over the pass"', 'start: "2026-05-01"', 'end: "2026-05-31"', "visibility: public", "---", "", "Trip.", ""].join("\n"),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photo-removal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-photo-removal-secret-b851";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

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
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  await writeDay();
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("removing one photograph from a day", () => {
  test("it leaves the gallery, and the file leaves the disk", async () => {
    const response = await remove([`/media/${TRIP}/${SLUG}/02.jpg`]);
    expect(response.status).toBe(200);

    const entry = getEntryBySlug(REF, SLUG, AS_AUTHOR);
    expect(entry?.gallery.map((item) => item.src)).toEqual([`/alex/media/${TRIP}/${SLUG}/01.jpg`]);
    // Half of a removal is worse than none: a picture out of the gallery and
    // still at its URL has not been taken down.
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "02.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "01.jpg"))).toBe(true);
  });

  test("the src a day does not carry is refused rather than ignored", async () => {
    const response = await remove([`/media/${TRIP}/${SLUG}/99.jpg`]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("unknown_media");
  });

  test("somebody who is not the owner is refused, and nothing is deleted", async () => {
    resolveAccess.mockResolvedValue({ email: "stranger@example.test" });
    const response = await remove([`/media/${TRIP}/${SLUG}/02.jpg`]);
    expect(response.status).toBe(404);
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "02.jpg"))).toBe(true);
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(2);
  });

  test("a signed-out reader is refused too", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    // 401 rather than 404: nobody has proved an address at all, which is a
    // different thing from proving one that owns another journal.
    expect((await remove([`/media/${TRIP}/${SLUG}/02.jpg`])).status).toBe(401);
    expect(getEntryBySlug(REF, SLUG, AS_AUTHOR)?.gallery).toHaveLength(2);
  });
});

describe("hiding one photograph instead — the gentler answer beside it", () => {
  test("the label is written and the file stays where it is", async () => {
    const response = await PATCH(
      body("PATCH", "/api/helper/alex/day", {
        trip: TRIP,
        slug: SLUG,
        photoVisibility: { [`/media/${TRIP}/${SLUG}/02.jpg`]: "private" },
      }),
      params,
    );
    expect(response.status).toBe(200);

    const entry = getEntryBySlug(REF, SLUG, AS_AUTHOR);
    expect(entry?.gallery.find((item) => item.src.endsWith("02.jpg"))?.visibility).toBe("private");
    expect(fs.existsSync(path.join(tripMediaDir(REF), SLUG, "02.jpg"))).toBe(true);
  });

  test("there is no way to widen — an unknown word lands closed", async () => {
    await PATCH(
      body("PATCH", "/api/helper/alex/day", {
        trip: TRIP,
        slug: SLUG,
        photoVisibility: { [`/media/${TRIP}/${SLUG}/02.jpg`]: "public" },
      }),
      params,
    );
    const entry = getEntryBySlug(REF, SLUG, AS_AUTHOR);
    expect(entry?.gallery.find((item) => item.src.endsWith("02.jpg"))?.visibility).toBe("private");
  });
});
