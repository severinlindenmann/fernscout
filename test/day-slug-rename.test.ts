import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * A day's slug catching up with its title — B1276.
 *
 * The wizard creates a day with `title: date`, so `lib/api/entries.ts`'s
 * `slugify` gives it the file `<date>-<date>.md` — a day's address is
 * genuinely its date until somebody says what the day was. The first `PATCH`
 * that supplies a real title is supposed to rename everything a slug names:
 * the entry file, its `media/` and `originals/` directories, its fingerprint
 * cache, and every gallery `src`/`poster` pointing at the old directory —
 * together, or not at all.
 *
 * Forward only: a day already published keeps its slug whatever title
 * arrives later, because that URL may already be in somebody's email.
 */

const OWNER_EMAIL = "alex@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { PATCH: setWords } = await import("@/app/api/helper/[user]/day/route");

let dir: string;
const params = { params: Promise.resolve({ user: "alex" }) };
const TRIP_DIR = () => path.join(dir, "alex", "trips", "kyoto");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-slug-rename-"));
  process.env.CONTENT_DIR = dir;
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(TRIP_DIR(), "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, credits: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(TRIP_DIR(), "trip.md"),
    ["---", "id: kyoto", "title: Kyoto", 'start: "2026-04-01"', 'end: "2026-04-08"', "visibility: private", "---", "", "Intro."].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A day exactly as `POST .../day` would have left it: title === date, so its
 *  file is `<date>-<date>.md`, and — when `withMedia` — a photograph already
 *  sits under `media/<trip>/<date>/` with a gallery entry pointing at it. */
function dateOnlyDay(date: string, withMedia: boolean) {
  const gallery = withMedia
    ? [
        "gallery:",
        `  - src: "/media/kyoto/${date}/01.jpg"`,
        "    type: image",
        "    width: 800",
        "    height: 600",
      ]
    : [];
  fs.writeFileSync(
    path.join(TRIP_DIR(), "entries", `${date}-${date}.md`),
    ["---", `date: "${date}"`, `title: "${date}"`, ...gallery, "status: draft", "---", "", ""].join("\n"),
  );
  if (withMedia) {
    const mediaDir = path.join(TRIP_DIR(), "media", date);
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "01.jpg"), "not a real jpeg");
    fs.mkdirSync(path.join(TRIP_DIR(), ".fingerprints"), { recursive: true });
    fs.writeFileSync(
      path.join(TRIP_DIR(), ".fingerprints", `${date}.json`),
      JSON.stringify({ "01.jpg": { file: "01.jpg", sha: "abc" } }),
    );
  }
}

async function patch(body: Record<string, unknown>) {
  return setWords(
    new Request("https://t.test/api/helper/alex/day", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

describe("a real title renames a still-drafting day", () => {
  test("the entry file, its media, its fingerprints and its gallery src all move together", async () => {
    dateOnlyDay("2026-04-02", true);

    const res = await patch({ trip: "kyoto", slug: "2026-04-02", title: "Kinkaku-ji", content: "Golden pavilion." });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft.slug).toBe("kinkaku-ji");

    const entries = fs.readdirSync(path.join(TRIP_DIR(), "entries"));
    expect(entries).toContain("2026-04-02-kinkaku-ji.md");
    expect(entries).not.toContain("2026-04-02-2026-04-02.md");

    const written = fs.readFileSync(path.join(TRIP_DIR(), "entries", "2026-04-02-kinkaku-ji.md"), "utf8");
    expect(written).toContain('src: "/media/kyoto/kinkaku-ji/01.jpg"');
    expect(written).not.toContain("2026-04-02/01.jpg");

    expect(fs.existsSync(path.join(TRIP_DIR(), "media", "kinkaku-ji", "01.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(TRIP_DIR(), "media", "2026-04-02"))).toBe(false);

    expect(fs.existsSync(path.join(TRIP_DIR(), ".fingerprints", "kinkaku-ji.json"))).toBe(true);
    expect(fs.existsSync(path.join(TRIP_DIR(), ".fingerprints", "2026-04-02.json"))).toBe(false);
  });

  test("a day with no photographs yet just renames the entry file", async () => {
    dateOnlyDay("2026-04-03", false);
    const res = await patch({ trip: "kyoto", slug: "2026-04-03", title: "Arashiyama", content: "Bamboo grove." });
    expect(res.status).toBe(200);
    expect((await res.json()).draft.slug).toBe("arashiyama");
    expect(fs.existsSync(path.join(TRIP_DIR(), "entries", "2026-04-03-arashiyama.md"))).toBe(true);
  });

  test("a colliding title refuses outright, and nothing is written at either slug", async () => {
    dateOnlyDay("2026-04-04", false);
    fs.writeFileSync(
      path.join(TRIP_DIR(), "entries", "2026-04-05-nara.md"),
      ["---", 'date: "2026-04-05"', "title: Nara", "status: draft", "---", "", "Deer park."].join("\n"),
    );

    const res = await patch({ trip: "kyoto", slug: "2026-04-04", title: "Nara", content: "Second visit." });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("slug_taken");

    // Nothing moved, and nothing was overwritten on the day already sitting
    // on that slug.
    expect(fs.existsSync(path.join(TRIP_DIR(), "entries", "2026-04-04-2026-04-04.md"))).toBe(true);
    const untouched = fs.readFileSync(path.join(TRIP_DIR(), "entries", "2026-04-05-nara.md"), "utf8");
    expect(untouched).toContain("Deer park.");
  });

  test("a second real title, still drafting, renames again", async () => {
    dateOnlyDay("2026-04-06", false);
    await patch({ trip: "kyoto", slug: "2026-04-06", title: "First name", content: "Words." });
    const res = await patch({ trip: "kyoto", slug: "first-name", title: "Better name" });
    expect(res.status).toBe(200);
    expect((await res.json()).draft.slug).toBe("better-name");
    expect(fs.existsSync(path.join(TRIP_DIR(), "entries", "2026-04-06-better-name.md"))).toBe(true);
    expect(fs.existsSync(path.join(TRIP_DIR(), "entries", "2026-04-06-first-name.md"))).toBe(false);
  });

  test("a published day never gets renamed, whatever title arrives", async () => {
    fs.writeFileSync(
      path.join(TRIP_DIR(), "entries", "2026-04-07-2026-04-07.md"),
      ["---", 'date: "2026-04-07"', 'title: "2026-04-07"', "---", "", "Already on the site."].join("\n"),
    );

    const res = await patch({ trip: "kyoto", slug: "2026-04-07", title: "Fushimi Inari" });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The title itself is still correctable on a published day (B816) — only
    // the address is frozen.
    expect(body.draft.slug).toBe("2026-04-07");
    expect(fs.existsSync(path.join(TRIP_DIR(), "entries", "2026-04-07-2026-04-07.md"))).toBe(true);
    expect(fs.existsSync(path.join(TRIP_DIR(), "entries", "2026-04-07-fushimi-inari.md"))).toBe(false);
  });
});
