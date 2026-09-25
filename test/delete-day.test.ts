import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2259 — deleting a day from the studio, "Recently deleted" and its purge.
 *
 * The owner's cookie door moves the day, its photographs, originals and
 * sidecars into `content/<user>/.trash/`, a shared day only with an explicit
 * `takeDown`; restore brings it back as a draft; after 30 days it is gone.
 */

const OWNER = "alex";
const TRIP = "t1";
const DRAFT = "2026-09-02-quiet-day";
const SHARED = "2026-09-03-big-day";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));
const cards: unknown[] = [];
vi.mock("@paid/postcard/lib/postcard/orders", async (original) => ({
  ...(await original<typeof import("@paid/postcard/lib/postcard/orders")>()),
  listOrders: vi.fn(async () => cards),
}));

const books: unknown[] = [];
const bookDrafts: unknown[] = [];
vi.mock("@paid/photobook/lib/photobook/orders", async (original) => ({
  ...(await original<typeof import("@paid/photobook/lib/photobook/orders")>()),
  listPhotobookOrders: vi.fn(async () => books),
}));
vi.mock("@paid/photobook/lib/photobook/drafts", async (original) => ({
  ...(await original<typeof import("@paid/photobook/lib/photobook/drafts")>()),
  listDrafts: vi.fn(async () => bookDrafts),
}));
const bookOptions = (photo: string) => ({ days: { "2026-09-02": { photos: [photo] } }, excludePhotos: [] });

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

const tripDir = () => path.join(dir, OWNER, "trips", TRIP);
const dayFile = (stem: string) => path.join(tripDir(), "entries", `${stem}.json`);
const trashOf = () => path.join(dir, OWNER, ".trash", TRIP);

function write(file: string, body = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function setUp() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Notebook",
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      visibility: "public",
      features: {},
    }),
  );
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "A trip",
    start: "2026-09-01",
    end: "2026-09-10",
    status: "current",
    visibility: "public",
    cover: "/media/t1/big-day/01.jpg",
  });
  for (const [slug, status] of [["quiet-day", "draft"], ["big-day", "published"]] as const) {
    const date = slug === "quiet-day" ? "2026-09-02" : "2026-09-03";
    writeDayFixture(dir, OWNER, TRIP, {
      slug,
      date,
      title: slug === "quiet-day" ? "A quiet day" : "The big day",
      status,
      media: [{ src: `/media/${TRIP}/${slug}/01.jpg` }],
    });
    write(path.join(tripDir(), "media", slug, "01.jpg"));
    write(path.join(tripDir(), "originals", slug, "01.heic"));
    write(path.join(tripDir(), "meta", slug, "01.jpg.meta.json"), "{}");
  }
}

function req(method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://t.test/x", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function del(stem: string, body?: unknown, headers?: Record<string, string>) {
  const { DELETE } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/route");
  return DELETE(req("DELETE", body, headers), { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: stem }) });
}

async function restore(id: string, headers?: Record<string, string>) {
  const { POST } = await import("@/app/api/web/[user]/deleted-days/[trip]/[id]/restore/route");
  return POST(req("POST", undefined, headers), { params: Promise.resolve({ user: OWNER, trip: TRIP, id }) });
}

const trashIds = () => (fs.existsSync(trashOf()) ? fs.readdirSync(trashOf()) : []);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-delete-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  setUp();
  clearUserCache();
  cards.length = 0;
  books.length = 0;
  bookDrafts.length = 0;
  isOwnerMock = vi.mocked((await import("@/lib/contacts/session")).isOwner);
  isOwnerMock.mockClear();
  isOwnerMock.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("DELETE /api/web/{user}/trips/{trip}/days/{slug}", () => {
  test("a draft goes to trash with its photographs, originals and sidecars", async () => {
    const response = await del("quiet-day");
    expect(response.status).toBe(200);
    expect(fs.existsSync(dayFile(DRAFT))).toBe(false);
    for (const gone of ["media", "originals", "meta"]) expect(fs.existsSync(path.join(tripDir(), gone, "quiet-day"))).toBe(false);

    const [id] = trashIds();
    expect(id).toMatch(/^2026-09-02-quiet-day--\d{8}T\d{6}Z$/);
    const entry = path.join(trashOf(), id);
    expect(fs.existsSync(path.join(entry, "media", "01.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(entry, "originals", "01.heic"))).toBe(true);
    expect(fs.existsSync(path.join(entry, "meta", "01.jpg.meta.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(entry, "trashed.json"), "utf8"))).toMatchObject({
      formerStatus: "draft",
      trip: TRIP,
      stem: DRAFT,
      title: "A quiet day",
    });
  });

  test("a shared day is refused without takeDown, and nothing moves", async () => {
    const response = await del("big-day");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("published_needs_take_down");
    expect(fs.existsSync(dayFile(SHARED))).toBe(true);
    expect(trashIds()).toEqual([]);
  });

  test("take down and delete: gone from the feed, kept as a draft in trash, cover cleared", async () => {
    const { buildFeedXml } = await import("@/lib/feed");
    expect(buildFeedXml(OWNER)).toContain("The big day");

    const response = await del("big-day", { takeDown: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ wasPublished: true, keptDays: 30 });
    expect(buildFeedXml(OWNER) ?? "").not.toContain("The big day");

    const entry = path.join(trashOf(), trashIds()[0]);
    expect(JSON.parse(fs.readFileSync(path.join(entry, "day.json"), "utf8")).status).toBe("draft");
    expect(JSON.parse(fs.readFileSync(path.join(entry, "trashed.json"), "utf8"))).toMatchObject({
      formerStatus: "published",
      cover: "/media/t1/big-day/01.jpg",
    });
    expect(JSON.parse(fs.readFileSync(path.join(tripDir(), "trip.json"), "utf8")).cover).toBeUndefined();
  });

  test("an unsent postcard using the day's photograph refuses the delete", async () => {
    cards.push({
      id: "card-1",
      status: "draft",
      payload: { trip: `${OWNER}/${TRIP}`, day: "quiet-day", photo: "quiet-day/01.jpg", expiresAt: "2999-01-01T00:00:00Z", recipients: [] },
    });
    const response = await del("quiet-day");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("used_by_postcard");
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
  });

  test("another day using photographs from this day's folder refuses the delete", async () => {
    writeDayFixture(dir, OWNER, TRIP, { slug: "borrower", date: "2026-09-04", status: "draft", media: [{ src: `/media/${TRIP}/quiet-day/01.jpg` }] });
    const response = await del("quiet-day");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("media_shared");
    expect(fs.existsSync(path.join(tripDir(), "media", "quiet-day", "01.jpg"))).toBe(true);
  });

  test("a bearer token is refused before the owner is asked about; a non-owner moves nothing", async () => {
    expect((await del("quiet-day", undefined, { authorization: "Bearer x" })).status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    // isOwner is false for a stranger and for an identity cookie alone (it
    // proves an address, grants nothing) — both land here.
    isOwnerMock.mockResolvedValue(false);
    expect((await del("quiet-day")).status).toBe(403);
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
    expect(trashIds()).toEqual([]);
  });
});

describe("B2259 review follow-up", () => {
  test("a postcard in flight (submitted) refuses the delete", async () => {
    cards.push({ id: "card-2", status: "submitted", payload: { trip: `${OWNER}/${TRIP}`, day: "quiet-day", photo: "quiet-day/01.jpg", expiresAt: "2000-01-01T00:00:00Z", recipients: [] } });
    const response = await del("quiet-day");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("used_by_postcard");
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
  });

  test("a paid photobook not yet rendered naming the day's photograph refuses the delete", async () => {
    books.push({ id: "book-1", status: "submitted", payload: { trip: `${OWNER}/${TRIP}`, options: bookOptions(`/media/${TRIP}/quiet-day/01.jpg`) } });
    const response = await del("quiet-day");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("used_by_photobook_order");
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
  });

  test("a rendered photobook does not stand in the way", async () => {
    books.push({ id: "book-2", status: "built", payload: { trip: `${OWNER}/${TRIP}`, options: bookOptions(`/media/${TRIP}/quiet-day/01.jpg`) } });
    expect((await del("quiet-day")).status).toBe(200);
  });

  test("a photobook draft asks for acknowledgement, then the delete goes through", async () => {
    bookDrafts.push({ trip: `${OWNER}/${TRIP}`, options: bookOptions(`/media/${TRIP}/quiet-day/01.jpg`) });
    const first = await del("quiet-day");
    expect(first.status).toBe(409);
    expect((await first.json()).error).toBe("photobook_draft_uses_day");
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
    expect((await del("quiet-day", { acceptPhotobookGaps: true })).status).toBe(200);
    expect(fs.existsSync(dayFile(DRAFT))).toBe(false);
  });

  test("a foreign Origin is refused on both doors and nothing moves", async () => {
    const foreign = { origin: "https://evil.test", host: "t.test" };
    expect((await del("quiet-day", undefined, foreign)).status).toBe(403);
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
    await del("quiet-day");
    const [id] = trashIds();
    expect((await restore(id, foreign)).status).toBe(403);
    expect(trashIds()).toEqual([id]);
    // The studio's own same-origin fetch passes.
    expect((await restore(id, { origin: "https://t.test", host: "t.test" })).status).toBe(200);
  });

  test("an unreadable deletedAt is never purged", async () => {
    await del("quiet-day");
    const [id] = trashIds();
    const stamp = path.join(trashOf(), id, "trashed.json");
    fs.writeFileSync(stamp, JSON.stringify({ ...JSON.parse(fs.readFileSync(stamp, "utf8")), deletedAt: "not a date" }));
    const { listTrash } = await import("@/lib/dayTrash");
    expect(listTrash(OWNER, new Date("2099-01-01T00:00:00Z"))).toHaveLength(1);
    expect(trashIds()).toEqual([id]);
  });

  test("a cross-disk copy that fails leaves no partial copy and the day as it was", async () => {
    const realRename = fs.renameSync;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from).includes(`${path.sep}originals${path.sep}`)) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
      return realRename(from, to);
    });
    const copy = vi.spyOn(fs, "cpSync").mockImplementation((_from, to) => {
      fs.mkdirSync(String(to), { recursive: true });
      fs.writeFileSync(path.join(String(to), "half"), "x");
      throw new Error("disk full");
    });
    try {
      const response = await del("quiet-day");
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("not_deleted");
    } finally {
      rename.mockRestore();
      copy.mockRestore();
    }
    expect(fs.existsSync(dayFile(DRAFT))).toBe(true);
    expect(fs.existsSync(path.join(tripDir(), "media", "quiet-day", "01.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tripDir(), "originals", "quiet-day", "01.heic"))).toBe(true);
    expect(trashIds()).toEqual([]);
  });

  test("a failure after the moves (the cover edit) undoes them", async () => {
    const tripJson = path.join(tripDir(), "trip.json");
    const realWrite = fs.writeFileSync;
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, ...rest) => {
      if (String(file) === tripJson) throw new Error("read-only");
      return realWrite(file as fs.PathOrFileDescriptor, data as string, ...(rest as []));
    });
    try {
      const response = await del("big-day", { takeDown: true });
      expect(response.status).toBe(409);
    } finally {
      write.mockRestore();
    }
    expect(JSON.parse(fs.readFileSync(dayFile(SHARED), "utf8")).status).toBe("published");
    expect(fs.existsSync(path.join(tripDir(), "media", "big-day", "01.jpg"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(tripJson, "utf8")).cover).toBe("/media/t1/big-day/01.jpg");
    expect(trashIds()).toEqual([]);
  });
});

describe("trash is invisible", () => {
  test("to readers, the v2 store, the media route and the sync manifest", async () => {
    await del("quiet-day");
    const { AS_AUTHOR, getAllEntries } = await import("@/lib/entries");
    expect(getAllEntries(`${OWNER}/${TRIP}`, AS_AUTHOR).map((e) => e.slug)).not.toContain("quiet-day");
    const { listDaySlugs, readDayFile } = await import("@/lib/api/v2/store");
    expect(listDaySlugs(OWNER, TRIP)).not.toContain(DRAFT);
    expect(readDayFile(OWNER, TRIP, DRAFT)).toBeNull();
    const { resolveMediaFile } = await import("@/lib/media");
    expect(resolveMediaFile(OWNER, [TRIP, "quiet-day", "01.jpg"])).toBeNull();
    const { buildManifest } = await import("@/lib/sync/manifest");
    const paths = buildManifest(OWNER).files.map((f) => f.path);
    expect(paths.some((p) => p.includes(".trash") || p.includes("quiet-day"))).toBe(false);
  });
});

describe("restore", () => {
  test("brings a shared day back as a draft with its photographs served again, and its cover", async () => {
    await del("big-day", { takeDown: true });
    const [id] = trashIds();
    const response = await restore(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slug: SHARED, status: "draft" });
    expect(JSON.parse(fs.readFileSync(dayFile(SHARED), "utf8")).status).toBe("draft");
    expect(fs.existsSync(path.join(tripDir(), "originals", "big-day", "01.heic"))).toBe(true);
    const { resolveMediaFile } = await import("@/lib/media");
    expect(resolveMediaFile(OWNER, [TRIP, "big-day", "01.jpg"])).not.toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(tripDir(), "trip.json"), "utf8")).cover).toBe("/media/t1/big-day/01.jpg");
    expect(trashIds()).toEqual([]);
  });

  test("a slug taken since is refused plainly with 409, nothing moved", async () => {
    await del("quiet-day");
    writeDayFixture(dir, OWNER, TRIP, { slug: "quiet-day", date: "2026-09-05", status: "draft" });
    const response = await restore(trashIds()[0]);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("slug_taken");
    expect(trashIds()).toHaveLength(1);
  });

  test("bearer and non-owner are refused", async () => {
    await del("quiet-day");
    const [id] = trashIds();
    isOwnerMock.mockClear();
    expect((await restore(id, { authorization: "Bearer x" })).status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    isOwnerMock.mockResolvedValue(false);
    expect((await restore(id)).status).toBe(403);
    expect(trashIds()).toEqual([id]);
  });

  test("a traversal id is a plain 404", async () => {
    expect((await restore("..")).status).toBe(404);
  });
});

describe("purge", () => {
  test("keeps a day 30 days, then removes it for good; restoring it afterwards is refused", async () => {
    const { listTrash, trashDay } = await import("@/lib/dayTrash");
    const deletedAt = new Date("2026-09-01T10:00:00Z");
    const trashed = trashDay(OWNER, TRIP, DRAFT, deletedAt);
    expect(trashed.ok).toBe(true);

    const day29 = listTrash(OWNER, new Date("2026-09-30T09:00:00Z"));
    expect(day29).toHaveLength(1);
    expect(day29[0].daysLeft).toBe(2);

    expect(listTrash(OWNER, new Date("2026-10-01T10:00:01Z"))).toEqual([]);
    expect(trashIds()).toEqual([]);
    const response = await restore(trashed.ok ? trashed.id : "");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("unknown_deleted_day");
  });
});
