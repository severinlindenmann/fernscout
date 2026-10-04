import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// A signed-out browser: no cookie at all.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * B2914 — countries visited without a trip: the store, the access filter and
 * the /api/v2 routes. Fixture shape copied from `api-v2-figures.test.ts`: a
 * throwaway CONTENT_DIR and sqlite db per test and a real owner bearer token
 * minted through the actual auth doors. The journal is named `test-…` because
 * the entries are invented.
 */

const OWNER = "test-visited";
const CODE = "123456";
let dir: string;
let calls = 0;
let OWNER_EMAIL: string;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.7.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { POST: ask } = await import("@/app/api/auth/codes/route");
  await ask(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, for: "write" }),
    }),
  );
  const { POST: redeem } = await import("@/app/api/auth/codes/redeem/route");
  const response = await redeem(
    new Request("https://example.test/api/auth/codes/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, code: CODE, for: "write" }),
    }),
  );
  return ((await response.json()) as { token: string }).token;
}

function req(url: string, init: RequestInit & { token?: string } = {}): Request {
  const { token, ...rest } = init;
  const h = new Headers(rest.headers);
  if (!(rest.body instanceof FormData)) h.set("content-type", "application/json");
  if (token) h.set("authorization", `Bearer ${token}`);
  return new Request(url, { ...rest, headers: h });
}

const base = () => `https://example.test/api/v2/${OWNER}/visited`;
const ctx = (code?: string) => ({ params: Promise.resolve(code === undefined ? { user: OWNER } : { user: OWNER, code }) });

beforeEach(async () => {
  OWNER_EMAIL = `owner-${process.hrtime.bigint()}@example.test`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-visited-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "55".repeat(32);
  process.env.AUTH_DEV_CODE = CODE;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Test journal",
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) delete process.env[key];
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
  test("writes one file per country and reads it back", async () => {
    const { addVisit, getVisit, listVisits } = await import("@/lib/visited");
    addVisit(OWNER, { country: "NO", places: "Lofoten", year: 2011, month: 7, note: "Rain.", visibility: "public" });
    addVisit(OWNER, { country: "gr" });
    expect(fs.readdirSync(path.join(dir, OWNER, "visited")).sort()).toEqual(["GR.json", "NO.json"]);
    expect(getVisit(OWNER, "NO")).toMatchObject({ country: "NO", places: "Lofoten", year: 2011, month: 7, note: "Rain.", visibility: "public" });
    expect(getVisit(OWNER, "GR")?.visibility).toBe("guest");
    expect(listVisits(OWNER).map((e) => e.country)).toEqual(["GR", "NO"]);
  });

  test("adding a country twice returns the first entry and writes nothing", async () => {
    const { addVisit, getVisit } = await import("@/lib/visited");
    const first = addVisit(OWNER, { country: "NO", places: "Bergen" });
    const again = addVisit(OWNER, { country: "NO", places: "Oslo" });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.entry.places).toBe("Bergen");
    expect(getVisit(OWNER, "NO")?.places).toBe("Bergen");
    expect(fs.readdirSync(path.join(dir, OWNER, "visited"))).toEqual(["NO.json"]);
  });

  test("update changes the same file, null clears, and a month needs a year", async () => {
    const { addVisit, updateVisit, getVisit } = await import("@/lib/visited");
    addVisit(OWNER, { country: "NO", places: "Bergen", year: 2011 });
    const next = updateVisit(OWNER, "NO", { places: null, month: 7, visibility: "private" });
    expect(next).toMatchObject({ month: 7, year: 2011, visibility: "private" });
    expect(getVisit(OWNER, "NO")?.places).toBeUndefined();
    expect(updateVisit(OWNER, "NO", { year: null })).toBe("month_needs_year");
    expect(getVisit(OWNER, "NO")?.year).toBe(2011);
    expect(updateVisit(OWNER, "GR", { note: "x" })).toBeNull();
  });

  test("an unknown code or a path is never read or written", async () => {
    const { getVisit, deleteVisit } = await import("@/lib/visited");
    for (const bad of ["XX", "ZZ", "N", "NOR", "../NO", "..", "no", "NO/../NO", ""]) {
      expect(getVisit(OWNER, bad)).toBeNull();
      expect(deleteVisit(OWNER, bad)).toBe(false);
    }
    const { visitedCreate } = await import("@/lib/api/v2/schemas/visited");
    expect(visitedCreate.safeParse({ country: "../x" }).success).toBe(false);
    expect(visitedCreate.safeParse({ country: "XX" }).success).toBe(false);
    expect(visitedCreate.safeParse({ country: "NO", month: 7 }).success).toBe(false);
    expect(visitedCreate.safeParse({ country: "NO", year: 1800 }).success).toBe(false);
    expect(visitedCreate.safeParse({ country: "NO", year: 2011, month: 13 }).success).toBe(false);
    expect(visitedCreate.safeParse({ country: "NO", note: "x".repeat(1001) }).success).toBe(false);
    expect(visitedCreate.safeParse({ country: "NO", extra: 1 }).success).toBe(false);
  });

  test("a photograph keeps its original as the print master and is replaced, not piled up", async () => {
    const { addVisit, putVisitPhoto, getVisit, removeVisitPhoto, deleteVisit } = await import("@/lib/visited");
    addVisit(OWNER, { country: "NO" });
    const jpeg = (rgb: [number, number, number]) =>
      sharp({ create: { width: 300, height: 200, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg().toBuffer();
    const a = await jpeg([200, 10, 10]);
    const first = await putVisitPhoto(OWNER, "NO", { filename: "a.jpg", bytes: a });
    expect(first.ok).toBe(true);
    const photo = getVisit(OWNER, "NO")!.photo!;
    const media = path.join(dir, OWNER, "visited", "media", "NO");
    expect(fs.readdirSync(media)).toEqual([photo]);
    const originals = path.join(dir, OWNER, "visited", "originals", "NO");
    expect(fs.readFileSync(path.join(originals, fs.readdirSync(originals)[0])).equals(a)).toBe(true);

    await putVisitPhoto(OWNER, "NO", { filename: "b.jpg", bytes: await jpeg([10, 10, 200]) });
    expect(fs.readdirSync(media)).toHaveLength(1);
    expect(fs.readdirSync(originals)).toHaveLength(2);

    expect(removeVisitPhoto(OWNER, "NO")?.photo).toBeUndefined();
    expect(fs.readdirSync(media)).toEqual([]);
    expect(deleteVisit(OWNER, "NO")).toBe(true);
    expect(fs.readdirSync(originals)).toHaveLength(2);

    const bad = await putVisitPhoto(OWNER, "GR", { filename: "a.jpg", bytes: a });
    expect(bad).toMatchObject({ ok: false, error: "no_entry" });
  });

  test("something that is not an image is refused and leaves nothing", async () => {
    const { addVisit, putVisitPhoto } = await import("@/lib/visited");
    addVisit(OWNER, { country: "NO" });
    const result = await putVisitPhoto(OWNER, "NO", { filename: "a.jpg", bytes: Buffer.from("not an image") });
    expect(result).toMatchObject({ ok: false, error: "invalid_media" });
    expect(fs.existsSync(path.join(dir, OWNER, "visited", "media"))).toBe(false);
  });
});

describe("access filter", () => {
  const readers = {
    owner: { owner: true, guest: false, close: false },
    close: { owner: false, guest: true, close: true },
    guest: { owner: false, guest: true, close: false },
    stranger: { owner: false, guest: false, close: false },
  } as const;
  const matrix = {
    owner: { private: true, guest: true, public: true },
    close: { private: true, guest: true, public: true },
    guest: { private: false, guest: true, public: true },
    stranger: { private: false, guest: false, public: true },
  } as const;

  test.each(Object.entries(matrix))("%s sees exactly the entries its tier opens", async (who, expected) => {
    const { addVisit, visibleVisits, visibleVisit } = await import("@/lib/visited");
    addVisit(OWNER, { country: "NO", visibility: "private" });
    addVisit(OWNER, { country: "GR", visibility: "guest" });
    addVisit(OWNER, { country: "IT", visibility: "public" });
    const reader = readers[who as keyof typeof readers];
    const seen = visibleVisits(OWNER, reader).map((e) => e.country);
    const want = [expected.guest && "GR", expected.public && "IT", expected.private && "NO"].filter(Boolean);
    expect(seen).toEqual(want);
    expect(visibleVisit(OWNER, "NO", reader) !== null).toBe(expected.private);
  });
});

describe("api v2", () => {
  test("add, read back every field, patch, photo, delete", async () => {
    const token = await ownerToken();
    const { POST, GET } = await import("@/app/api/v2/[user]/visited/route");
    const one = await import("@/app/api/v2/[user]/visited/[code]/route");
    const photo = await import("@/app/api/v2/[user]/visited/[code]/photo/route");

    const created = await POST(
      req(base(), {
        method: "POST",
        token,
        body: JSON.stringify({ country: "no", places: "Lofoten", year: 2011, month: 7, note: "Rain.", visibility: "public" }),
      }),
      ctx(),
    );
    expect(created.status).toBe(201);
    const doc = await created.json();
    expect(doc).toMatchObject({ country: "NO", places: "Lofoten", year: 2011, month: 7, note: "Rain.", visibility: "public" });

    const read = await one.GET(req(`${base()}/NO`, { token }), ctx("NO"));
    expect(await read.json()).toEqual(doc);
    const list = await GET(req(base(), { token }), ctx());
    expect(await list.json()).toEqual({ visited: [doc] });

    const patched = await one.PATCH(
      req(`${base()}/NO`, { method: "PATCH", token, body: JSON.stringify({ note: null, visibility: "private" }) }),
      ctx("NO"),
    );
    const patchedDoc = await patched.json();
    expect(patchedDoc.note).toBeUndefined();
    expect(patchedDoc.visibility).toBe("private");
    expect(patchedDoc.places).toBe("Lofoten");

    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } }).jpeg().toBuffer())], "x.jpg", { type: "image/jpeg" }),
    );
    const put = await photo.PUT(req(`${base()}/NO/photo`, { method: "PUT", token, body: form }), ctx("NO"));
    expect(put.status).toBe(200);
    const withPhoto = await put.json();
    expect(withPhoto.photo.url).toBe(`/@${OWNER}/visited-media/NO/${withPhoto.photo.src}`);
    expect((await (await one.GET(req(`${base()}/NO`, { token }), ctx("NO"))).json()).photo).toEqual(withPhoto.photo);

    const detached = await photo.DELETE(req(`${base()}/NO/photo`, { method: "DELETE", token }), ctx("NO"));
    expect((await detached.json()).photo).toBeUndefined();

    const removed = await one.DELETE(req(`${base()}/NO`, { method: "DELETE", token }), ctx("NO"));
    expect(await removed.json()).toEqual({ deleted: "NO" });
    expect((await one.GET(req(`${base()}/NO`, { token }), ctx("NO"))).status).toBe(404);
  });

  test("a duplicate add returns the existing entry; a batch reports what it added", async () => {
    const token = await ownerToken();
    const { POST } = await import("@/app/api/v2/[user]/visited/route");
    await POST(req(base(), { method: "POST", token, body: JSON.stringify({ country: "NO", places: "Bergen" }) }), ctx());

    const again = await POST(req(base(), { method: "POST", token, body: JSON.stringify({ country: "NO", places: "Oslo" }) }), ctx());
    expect(again.status).toBe(200);
    expect((await again.json()).places).toBe("Bergen");

    const batch = await POST(
      req(base(), { method: "POST", token, body: JSON.stringify({ entries: [{ country: "NO" }, { country: "GR" }, { country: "IT", visibility: "public" }] }) }),
      ctx(),
    );
    const body = await batch.json();
    expect(body.created).toEqual(["GR", "IT"]);
    expect(body.entries.map((e: { country: string }) => e.country)).toEqual(["NO", "GR", "IT"]);
    expect(body.entries[0].places).toBe("Bergen");
    expect(body.entries[1].visibility).toBe("guest");
  });

  test("a bad body is a 400 with problems, and nothing is written", async () => {
    const token = await ownerToken();
    const { POST } = await import("@/app/api/v2/[user]/visited/route");
    const res = await POST(req(base(), { method: "POST", token, body: JSON.stringify({ country: "XX" }) }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).details.problems[0].field).toBe("country");
    const batch = await POST(req(base(), { method: "POST", token, body: JSON.stringify({ entries: [{ country: "NO" }, { country: "XX" }] }) }), ctx());
    expect(batch.status).toBe(400);
    expect(fs.existsSync(path.join(dir, OWNER, "visited"))).toBe(false);
  });

  test("no token, and a token for another journal, write and read nothing", async () => {
    const token = await ownerToken();
    const { POST, GET } = await import("@/app/api/v2/[user]/visited/route");
    const one = await import("@/app/api/v2/[user]/visited/[code]/route");

    const anon = await POST(req(base(), { method: "POST", body: JSON.stringify({ country: "NO" }) }), ctx());
    expect(anon.status).toBe(401);
    expect((await GET(req(base()), ctx())).status).toBe(401);

    const other = { params: Promise.resolve({ user: "test-elsewhere" }) };
    const foreignWrite = await POST(req("https://example.test/api/v2/test-elsewhere/visited", { method: "POST", token, body: JSON.stringify({ country: "NO" }) }), other);
    expect([403, 404]).toContain(foreignWrite.status);
    const foreignRead = await GET(req("https://example.test/api/v2/test-elsewhere/visited", { token }), other);
    expect([403, 404]).toContain(foreignRead.status);

    const del = await one.DELETE(req(`${base()}/NO`, { method: "DELETE" }), ctx("NO"));
    expect(del.status).toBe(401);
    expect(fs.existsSync(path.join(dir, OWNER, "visited"))).toBe(false);
  });

  test("the list a reader gets holds only what the reader may see", async () => {
    const { addVisit } = await import("@/lib/visited");
    const { applyVisitedList, applyVisitedGet } = await import("@/lib/api/v2/visitedApply");
    addVisit(OWNER, { country: "NO", visibility: "private" });
    addVisit(OWNER, { country: "IT", visibility: "public" });
    const stranger = { owner: false, guest: false, close: false };
    expect((await applyVisitedList(OWNER, stranger).json()).visited.map((e: { country: string }) => e.country)).toEqual(["IT"]);
    expect(applyVisitedGet(OWNER, "NO", stranger).status).toBe(404);
    expect(applyVisitedGet(OWNER, "IT", stranger).status).toBe(200);
  });

  test("the browser door refuses a bearer token and a signed-out caller", async () => {
    const token = await ownerToken();
    const web = await import("@/app/api/web/[user]/visited/route");
    const withToken = await web.POST(req(`https://example.test/api/web/${OWNER}/visited`, { method: "POST", token, body: JSON.stringify({ country: "NO" }) }), ctx());
    expect(withToken.status).toBe(403);
    const signedOut = await web.POST(req(`https://example.test/api/web/${OWNER}/visited`, { method: "POST", body: JSON.stringify({ country: "NO" }) }), ctx());
    expect(signedOut.status).toBe(403);
    expect(fs.existsSync(path.join(dir, OWNER, "visited"))).toBe(false);
  });
});

describe("contract", () => {
  test("every visited operation is in the OpenAPI document", async () => {
    const { openApiDocumentV2 } = await import("@/lib/api/v2/openapi");
    const doc = openApiDocumentV2() as unknown as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths["/api/v2/{user}/visited"])).toEqual(expect.arrayContaining(["get", "post"]));
    expect(Object.keys(doc.paths["/api/v2/{user}/visited/{code}"])).toEqual(expect.arrayContaining(["get", "patch", "delete"]));
    expect(Object.keys(doc.paths["/api/v2/{user}/visited/{code}/photo"])).toEqual(expect.arrayContaining(["put", "delete"]));
  });
});
