import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B1495 — a journal's folder, listed with hashes, and one file at a time.
 *
 * The two routes that make `sync down` possible. What is worth testing here is
 * less that they work than that they refuse: this listing walks private trips
 * and unpublished drafts, so every gate it shares with `/<user>/export.zip`
 * has to hold, and the path it accepts from a caller has to be the same path
 * the listing was willing to name.
 *
 * The `gps/` exclusion is deliberately **not** tested here. It lives in
 * `test/gps-store.test.ts`, beside the rest of the rules that keep that folder
 * private, so somebody reading what protects a position history finds all of
 * it in one file rather than three quarters of it.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const OTHER_EMAIL = "guest@example.test";
const TRIP = "alps-2024";

let dir: string;
let calls = 0;
function headers(token?: string): Record<string, string> {
  calls += 1;
  return {
    "x-forwarded-for": `10.9.0.${calls % 250}`,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function tokenFor(email: string, trip?: string): Promise<string> {
  const { issueCode, verifyCode, tripWriteScope } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent", trip ? { trip } : undefined);
  const result = await verifyCode(
    OWNER,
    email,
    code,
    "agent",
    trip ? tripWriteScope(trip) : undefined,
  );
  if (!result.ok) throw new Error(`no token for ${email}: ${result.reason}`);
  return result.token;
}

type ManifestBody = {
  user?: string;
  files?: { path: string; size: number; hash: string }[];
  bytes?: number;
  omitted?: { originals: { files: number; bytes: number } };
  next?: string;
  error?: string;
};

async function manifest(token?: string, user = OWNER): Promise<{ status: number; body: ManifestBody }> {
  const { GET } = await import("@/app/api/v1/[user]/sync/manifest/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${user}/sync/manifest`, { headers: headers(token) }),
    { params: Promise.resolve({ user }) },
  );
  return { status: response.status, body: (await response.json()) as ManifestBody };
}

async function fetchFile(
  relative: string,
  token?: string,
  user = OWNER,
): Promise<{ status: number; text: string; type: string | null }> {
  const { GET } = await import("@/app/api/v1/[user]/sync/file/[...path]/route");
  const segments = relative.split("/");
  const response = await GET(
    new Request(`https://example.test/api/v1/${user}/sync/file/${relative}`, {
      headers: headers(token),
    }),
    { params: Promise.resolve({ user, path: segments }) },
  );
  return {
    status: response.status,
    text: await response.text(),
    type: response.headers.get("content-type"),
  };
}

function write(relative: string, contents: string): void {
  const full = path.join(dir, OWNER, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

const TRIP_MD = [
  "---",
  'id: "alps-2024"',
  'title: "Four days round the Alps"',
  'start: "2024-09-10"',
  'end: "2024-09-14"',
  "status: past",
  'visibility: "private"',
  "---",
  "",
  "Four days, three passes and a great deal of rain.",
  "",
].join("\n");

const DRAFT_MD = [
  "---",
  'title: "Over the Susten"',
  'date: "2024-09-12"',
  'status: "draft"',
  "---",
  "",
  "The pass, from the top.",
  "",
].join("\n");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sync-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "99".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true } },
    }),
  );

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

beforeEach(async () => {
  write(`trips/${TRIP}/trip.md`, TRIP_MD);
  write(`trips/${TRIP}/entries/2024-09-12-over-the-susten.md`, DRAFT_MD);
  write(`trips/${TRIP}/media/over-the-susten/01.jpg`, "jpeg-bytes");
  write(`trips/${TRIP}/costs.md`, "---\nbudget: 100\n---\n");
  write("inbox/media/a3f1c2-sunset.jpg", "sunset-bytes");
  write("inbox/media/a3f1c2-sunset.jpg.meta.json", JSON.stringify({ id: "a3f1c2-sunset.jpg" }));

  const { clearUserCache } = await import("@/lib/users");
  const { clearConfigCache } = await import("@/lib/config");
  const { clearSyncHashCache } = await import("@/lib/sync/manifest");
  clearUserCache();
  clearConfigCache();
  clearSyncHashCache();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

describe("the manifest", () => {
  test("lists the journal's own files, with a hash and a size each", async () => {
    const { status, body } = await manifest(await tokenFor(OWNER_EMAIL));
    expect(status).toBe(200);
    const paths = body.files!.map((f) => f.path);
    expect(paths).toContain("config.json");
    expect(paths).toContain(`trips/${TRIP}/trip.md`);
    expect(paths).toContain(`trips/${TRIP}/costs.md`);
    expect(paths).toContain(`trips/${TRIP}/media/over-the-susten/01.jpg`);

    const trip = body.files!.find((f) => f.path === `trips/${TRIP}/trip.md`)!;
    expect(trip.size).toBe(Buffer.byteLength(TRIP_MD));
    expect(trip.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  test("a draft day is in it — the folder is a faithful mirror or it is not a backup", async () => {
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    expect(body.files!.map((f) => f.path)).toContain(
      `trips/${TRIP}/entries/2024-09-12-over-the-susten.md`,
    );
  });

  test("the inbox syncs, sidecars and all", async () => {
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    const paths = body.files!.map((f) => f.path);
    expect(paths).toContain("inbox/media/a3f1c2-sunset.jpg");
    expect(paths).toContain("inbox/media/a3f1c2-sunset.jpg.meta.json");
  });

  test("it is sorted, so two runs of the same journal compare cleanly", async () => {
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    const paths = body.files!.map((f) => f.path);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  });

  /**
   * The point of the hash. `publish` matches a day by slug and a photograph by
   * filename, so a day edited in place or a photograph replaced under the same
   * name is invisible to it — which is the whole reason a manifest exists.
   */
  test("an edit changes that file's hash and no other", async () => {
    const before = await manifest(await tokenFor(OWNER_EMAIL));
    write(`trips/${TRIP}/trip.md`, TRIP_MD.replace("great deal", "modest amount"));
    const { clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const after = await manifest(await tokenFor(OWNER_EMAIL));

    const changed = after.body.files!.filter((f) => {
      const was = before.body.files!.find((b) => b.path === f.path);
      return !was || was.hash !== f.hash;
    });
    expect(changed.map((f) => f.path)).toEqual([`trips/${TRIP}/trip.md`]);
  });

  test("the same bytes at two paths hash alike, which is what makes a move cheap", async () => {
    write(`trips/${TRIP}/media/over-the-susten/02.jpg`, "jpeg-bytes");
    const { clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    const one = body.files!.find((f) => f.path.endsWith("01.jpg"))!;
    const two = body.files!.find((f) => f.path.endsWith("02.jpg"))!;
    expect(two.hash).toBe(one.hash);
    fs.rmSync(path.join(dir, OWNER, "trips", TRIP, "media", "over-the-susten", "02.jpg"));
  });

  /**
   * Not a nicety. `originals/` is the largest thing in most journals and it is
   * deliberately not synced; a mirror that omits it silently while calling
   * itself a backup is exactly the "no silent caps" failure.
   */
  test("originals are excluded, and the run is told how much it did not get", async () => {
    write(`trips/${TRIP}/originals/01.jpg`, "x".repeat(5000));
    const { clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    expect(body.files!.map((f) => f.path)).not.toContain(`trips/${TRIP}/originals/01.jpg`);
    expect(body.omitted!.originals).toEqual({ files: 1, bytes: 5000 });
    expect(body.next).toContain("5000");
    fs.rmSync(path.join(dir, OWNER, "trips", TRIP, "originals"), { recursive: true });
  });

  test("a dotfile the Finder left is not in it", async () => {
    write(`trips/${TRIP}/media/.DS_Store`, "finder");
    const { clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    expect(body.files!.some((f) => f.path.includes(".DS_Store"))).toBe(false);
  });

  test("the client's own base manifest is never listed back at it", async () => {
    write(".fernscout-sync.json", JSON.stringify({ version: 1 }));
    const { clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const { body } = await manifest(await tokenFor(OWNER_EMAIL));
    expect(body.files!.map((f) => f.path)).not.toContain(".fernscout-sync.json");
  });
});

describe("one file at a time", () => {
  test("a listed file comes back byte for byte", async () => {
    const { status, text } = await fetchFile(`trips/${TRIP}/trip.md`, await tokenFor(OWNER_EMAIL));
    expect(status).toBe(200);
    expect(text).toBe(TRIP_MD);
  });

  test("a media file comes back with its own content type", async () => {
    const { status, text, type } = await fetchFile(
      `trips/${TRIP}/media/over-the-susten/01.jpg`,
      await tokenFor(OWNER_EMAIL),
    );
    expect(status).toBe(200);
    expect(text).toBe("jpeg-bytes");
    expect(type).toBe("image/jpeg");
  });

  test("a file the manifest does not list is refused, even though it is on disk", async () => {
    write(`trips/${TRIP}/originals/01.jpg`, "the big one");
    const refused = await fetchFile(`trips/${TRIP}/originals/01.jpg`, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(404);
    fs.rmSync(path.join(dir, OWNER, "trips", TRIP, "originals"), { recursive: true });
  });

  test("a path climbing out of the journal is refused", async () => {
    for (const attempt of ["../config.json", "trips/../../config.json", "..%2Fconfig.json"]) {
      expect((await fetchFile(attempt, await tokenFor(OWNER_EMAIL))).status).toBe(404);
    }
  });

  /**
   * The boundary the old code only claimed to have. `inSync` refuses every
   * `..` segment, which made the string comparison that stood here a
   * tautology — so the comment beside it, about stopping a symlink, was
   * simply untrue. `realpathSync` is what makes it true, and this is what
   * would have caught it: a link inside the journal, pointing at the one
   * folder no route may ever return.
   */
  test("a symlink pointing out of the journal is refused, not followed", async () => {
    const outside = path.join(dir, "elsewhere.txt");
    fs.writeFileSync(outside, "not this journal's");
    const link = path.join(dir, OWNER, "trips", TRIP, "escape.md");
    fs.symlinkSync(outside, link);

    const refused = await fetchFile(`trips/${TRIP}/escape.md`, await tokenFor(OWNER_EMAIL));
    expect(refused.status).toBe(404);
    expect(refused.text).not.toContain("not this journal's");

    // And it was never offered in the first place: the walk skips symlinks,
    // so a caller could only ever have reached this by guessing the name.
    const { clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const listed = await manifest(await tokenFor(OWNER_EMAIL));
    expect(listed.body.files!.map((f) => f.path)).not.toContain(`trips/${TRIP}/escape.md`);

    fs.rmSync(link);
    fs.rmSync(outside);
  });

  test("a shouted path is refused the same as a quiet one", async () => {
    // The filesystem under this is case-insensitive, so these resolve to real
    // files; excluding them from the listing and then serving them to anybody
    // who asked in capitals would be no exclusion at all.
    fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP, "originals"), { recursive: true });
    fs.writeFileSync(path.join(dir, OWNER, "trips", TRIP, "originals", "01.jpg"), "the big one");
    const token = await tokenFor(OWNER_EMAIL);
    for (const shouted of [
      `trips/${TRIP}/ORIGINALS/01.jpg`,
      `trips/${TRIP}/Originals/01.jpg`,
    ]) {
      const refused = await fetchFile(shouted, token);
      expect(refused.status).toBe(404);
      expect(refused.text).not.toContain("the big one");
    }
    fs.rmSync(path.join(dir, OWNER, "trips", TRIP, "originals"), { recursive: true });
  });

  test("a file that is not there is a 404, not a crash", async () => {
    expect((await fetchFile("trips/nope/trip.md", await tokenFor(OWNER_EMAIL))).status).toBe(404);
  });
});

/**
 * The half that matters most. This listing walks private trips and
 * unpublished drafts, so it must refuse everything `/<user>/export.zip`
 * refuses — the trip-scoped token above all, since it is the lowest-trust
 * credential this system issues and it satisfies `ownsUser` on its own.
 */
describe("who is refused", () => {
  test("a trip-scoped token gets nothing from either route", async () => {
    const scoped = await tokenFor(OWNER_EMAIL, TRIP);
    expect((await manifest(scoped)).status).toBe(404);
    expect((await fetchFile(`trips/${TRIP}/trip.md`, scoped)).status).toBe(404);
  });

  test("a token belonging to somebody who is not the owner is refused", async () => {
    const other = await tokenFor(OTHER_EMAIL);
    expect((await manifest(other)).status).toBe(404);
    expect((await fetchFile(`trips/${TRIP}/trip.md`, other)).status).toBe(404);
  });

  test("no token at all is refused", async () => {
    expect((await manifest()).status).toBe(401);
    expect((await fetchFile(`trips/${TRIP}/trip.md`)).status).toBe(401);
  });

  test("an unknown journal answers the same 404 a refusal does", async () => {
    const { status } = await manifest(await tokenFor(OWNER_EMAIL), "nobody");
    expect(status).toBe(404);
  });
});
