import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * `GET/POST /api/v2/{user}/import/photos` — B2195. The share sheet's bearer
 * door onto the studio's staging: owner token only, nothing filed, trip and
 * day declined (the run is a new trip, typed), limits discoverable.
 */
vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: (name: string, ...rest: unknown[]) => (name === "extract" ? true : (actual.isEnabled as (...a: unknown[]) => boolean)(name, ...rest)) };
});

const OWNER = "ana";
const EMAIL = "ana@example.test";
let dir: string;
let calls = 0;

const h = (token?: string) => {
  calls += 1;
  return { "x-forwarded-for": `10.12.0.${calls % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}) };
};

async function token(kind: "owner" | "gps" | "trip"): Promise<string> {
  const auth = await import("@/lib/auth");
  if (kind === "gps") return (await auth.issueGpsToken(OWNER, EMAIL)).token;
  const { code } = await auth.issueCode(
    OWNER,
    kind === "trip" ? "buddy@example.test" : EMAIL,
    "agent",
    kind === "trip" ? { trip: `${OWNER}/asia-2026` } : undefined,
  );
  const r = await auth.verifyCode(OWNER, kind === "trip" ? "buddy@example.test" : EMAIL, code, "agent");
  if (!r.ok) throw new Error("no token");
  return r.token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function post(tok: string | undefined, files: { name: string; bytes: Buffer }[], run?: string) {
  const { POST } = await import("@/app/api/v2/[user]/import/photos/route");
  const form = new FormData();
  if (run) form.set("run", run);
  for (const f of files) form.append("file", new File([new Uint8Array(f.bytes)], f.name, { type: "image/jpeg" }));
  const res = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/import/photos`, { method: "POST", headers: h(tok), body: form }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function get(tok?: string) {
  const { GET } = await import("@/app/api/v2/[user]/import/photos/route");
  const res = await GET(new Request(`https://example.test/api/v2/${OWNER}/import/photos`, { headers: h(tok) }), {
    params: Promise.resolve({ user: OWNER }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-import-photos-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "45".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
  const created = createJournal({ username: OWNER, title: "Two Backpacks", ownerName: "Ana Traveller", ownerNickname: "Ana", ownerEmail: EMAIL });
  if (created && "ok" in created && !created.ok) throw new Error("journal not created");
  clearUserCache();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/v2/{user}/import/photos", () => {
  test("an owner token opens a run, staged with trip declined, and adds to it", async () => {
    const tok = await token("owner");
    const first = await post(tok, [{ name: "a.jpg", bytes: Buffer.from("one") }]);
    expect(first.status).toBe(200);
    expect(first.body.accepted).toHaveLength(1);
    expect(first.body.maxFilesPerRequest).toBeGreaterThan(0);
    const runId = first.body.runId as string;

    const { readManifest } = await import("@/lib/staging/manifest");
    const m = readManifest(OWNER, runId)!;
    expect(m.tripId).toBeNull();
    expect(m.via).toBe("share");
    expect(m.photos[0].date).toBeUndefined();

    const second = await post(tok, [{ name: "b.jpg", bytes: Buffer.from("two") }], runId);
    expect(second.body.runId).toBe(runId);
    expect(readManifest(OWNER, runId)!.photos).toHaveLength(2);

    const back = await get(tok);
    expect(back.body.runs.find((r: { runId: string }) => r.runId === runId)).toMatchObject({ photos: 2, via: "share" });
    // Nothing was filed anywhere a journal reads.
    expect(fs.existsSync(path.join(dir, OWNER, "inbox"))).toBe(false);
  });

  test("two uploads racing into one run keep both photographs", async () => {
    const tok = await token("owner");
    const { runId } = (await post(tok, [])).body;
    await Promise.all(
      ["p", "q", "r", "s"].map((n) => post(tok, [{ name: `${n}.jpg`, bytes: Buffer.from(`bytes-${n}`) }], runId)),
    );
    const { readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest(OWNER, runId)!.photos).toHaveLength(4);
  });

  test("write:gps, a trip-scoped token and no token are refused", async () => {
    const f = [{ name: "a.jpg", bytes: Buffer.from("x") }];
    expect((await post(await token("gps"), f)).status).toBe(403);
    expect((await post(await token("trip"), f)).status).toBe(403);
    expect((await post(undefined, f)).status).toBe(401);
    expect((await get(await token("gps"))).status).toBe(403);
  });

  test("limits: too many files per request, unknown run; no files only opens a run", async () => {
    const tok = await token("owner");
    const opened = await post(tok, []);
    expect(opened.status).toBe(200);
    expect(opened.body.accepted).toEqual([]);
    expect(typeof opened.body.runId).toBe("string");
    const many = Array.from({ length: 61 }, (_, i) => ({ name: `${i}.jpg`, bytes: Buffer.from(String(i)) }));
    const tooMany = await post(tok, many);
    expect(tooMany.status).toBe(413);
    expect(tooMany.body.details.max).toBe(60);
    expect((await post(tok, [{ name: "a.jpg", bytes: Buffer.from("x") }], "nope")).status).toBe(404);
  });
});
