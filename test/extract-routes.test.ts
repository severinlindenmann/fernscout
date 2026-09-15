import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The start and upload routes — B1751 Task 1.2.
 *
 * `isEnabled` and `isHelperOwner` are mocked through hoisted toggles rather
 * than the brief's flat `() => false`, because this file also exercises the
 * capability-on, owner-true path (a real upload into a real staging
 * directory) and vitest allows only one `vi.mock` factory per module.
 * `cap.enabled` starts `false` so the very first test — the capability-off
 * 404 — needs no setup of its own, matching the brief's RED test verbatim in
 * behaviour.
 */
const cap = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/capabilities", () => ({
  isEnabled: (name: string) => (name === "extract" ? cap.enabled : true),
}));

const owner = vi.hoisted(() => ({ yes: true }));
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => owner.yes };
});

/**
 * `describePhotos` mocked for the sample and enrich routes — Ruling R5. What
 * a vision model actually says is not assertable, and the things worth
 * covering are on either side of it: the one-per-run rule, and what was
 * spent and refunded. A `vi.fn` rather than a bare stub so a single test can
 * make it reject, for the refund path.
 */
const helperModel = vi.hoisted(() => ({
  describePhotos: vi.fn(async (images: { base64: string }[]) => images.map(() => "A quiet street.")),
}));
vi.mock("@/lib/helper/model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/model")>();
  return { ...actual, describePhotos: helperModel.describePhotos };
});

let dir: string;
beforeEach(() => {
  cap.enabled = false;
  owner.yes = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-routes-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("the extract routes with the capability off", () => {
  test("start answers 404, not 500 and not 403", async () => {
    const { POST } = await import("@/app/api/helper/[user]/extract/start/route");
    const res = await POST(new Request("http://x/api/helper/alex/extract/start", { method: "POST" }), {
      params: Promise.resolve({ user: "alex" }),
    });
    expect(res.status).toBe(404);
  });

  test("upload answers 404 too", async () => {
    const { POST } = await import("@/app/api/helper/[user]/extract/upload/route");
    const res = await POST(new Request("http://x/api/helper/alex/extract/upload", { method: "POST" }), {
      params: Promise.resolve({ user: "alex" }),
    });
    expect(res.status).toBe(404);
  });
});

function startRun(): Promise<Response> {
  return import("@/app/api/helper/[user]/extract/start/route").then(({ POST }) =>
    POST(new Request("http://x/api/helper/alex/extract/start", { method: "POST" }), {
      params: Promise.resolve({ user: "alex" }),
    }),
  );
}

function upload(runId: string, files: File[]): Promise<Response> {
  const form = new FormData();
  form.set("run", runId);
  for (const file of files) form.append("file", file);
  return import("@/app/api/helper/[user]/extract/upload/route").then(({ POST }) =>
    POST(
      new Request("http://x/api/helper/alex/extract/upload", { method: "POST", body: form }),
      { params: Promise.resolve({ user: "alex" }) },
    ),
  );
}

const CAMERA_JPEG = fs.readFileSync("test/fixtures/ingest/camera.jpg");

describe("the extract routes with the capability on", () => {
  beforeEach(() => {
    cap.enabled = true;
  });

  test("start opens a run and stamps a manifest with no photographs", async () => {
    const res = await startRun();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; expiresAt: string };
    expect(body.runId).toMatch(/^run-/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const { readManifest } = await import("@/lib/staging/manifest");
    const manifest = readManifest("alex", body.runId);
    expect(manifest?.state).toBe("uploading");
    expect(manifest?.photos).toEqual([]);
  });

  test("upload takes a real photograph into staging and analyses it", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const file = new File([CAMERA_JPEG], "camera.jpg", { type: "image/jpeg" });
    const res = await upload(runId, [file]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accepted: { filename: string; lat?: number; kind: string }[];
      rejected: unknown[];
    };
    expect(body.rejected).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect(body.accepted[0].kind).toBe("image");
    expect(body.accepted[0].lat).toBeCloseTo(15.8801, 3);

    const { readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest("alex", runId)?.photos).toHaveLength(1);
  });

  test("an oversized file is rejected rather than staged", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { IMAGE_MAX_BYTES } = await import("@/lib/validate/media");
    const huge = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], "huge.jpg", { type: "image/jpeg" });
    const res = await upload(runId, [huge]);
    const body = (await res.json()) as { accepted: unknown[]; rejected: { filename: string; reason: string }[] };
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([{ filename: "huge.jpg", reason: "too_large" }]);
  });

  test("a retried batch is idempotent — the same photograph twice is one row", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const file = () => new File([CAMERA_JPEG], "camera.jpg", { type: "image/jpeg" });
    await upload(runId, [file()]);
    const second = await upload(runId, [file()]);
    const body = (await second.json()) as { accepted: unknown[]; rejected: unknown[] };
    // Not reported as newly accepted, and not reported as a failure either:
    // it is already there, which is not an error.
    expect(body.accepted).toEqual([]);
    expect(body.rejected).toEqual([]);

    const { readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest("alex", runId)?.photos).toHaveLength(1);
  });

  test("the same photograph twice in one request is one row, not two", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const file = () => new File([CAMERA_JPEG], "camera.jpg", { type: "image/jpeg" });
    const res = await upload(runId, [file(), file()]);
    const body = (await res.json()) as { accepted: unknown[]; rejected: unknown[] };
    expect(body.accepted).toHaveLength(1);
    expect(body.rejected).toEqual([]);

    const { readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest("alex", runId)?.photos).toHaveLength(1);
  });

  test("an unknown run answers 404 rather than a crash", async () => {
    const res = await upload("run-does-not-exist", [new File([CAMERA_JPEG], "camera.jpg")]);
    expect(res.status).toBe(404);
  });

  test("R2 — continuing a warned run extends it, with no button", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const before = readManifest("alex", runId);
    if (!before) throw new Error("run vanished");
    // Simulate the nightly sweep having already warned this run.
    writeManifest("alex", { ...before, warnedAt: "2026-09-01T00:00:00.000Z" });

    await upload(runId, [new File([CAMERA_JPEG], "camera.jpg")]);

    const after = readManifest("alex", runId);
    expect(after?.extendedAt).toBeDefined();
    expect(Date.parse(after!.expiresAt)).toBeGreaterThan(Date.parse(before.expiresAt));
  });
});

/**
 * The run and day routes — B1751 Task 2.3.
 */
describe("the run and day routes with the capability on", () => {
  beforeEach(() => {
    cap.enabled = true;
  });

  test("patching a photograph refuses a visibility word that is not one of the two", async () => {
    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: "run-1", photoId: "a", visibility: "public" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(400);
  });

  test("patching a photograph refuses a date that is not yyyy-mm-dd", async () => {
    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: "run-1", photoId: "a", date: "banana" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(400);
  });

  test("patching a photograph refuses a syntactically odd date too", async () => {
    // Not a calendar — 30 February is not the point — but month 99 and day 99
    // are past even a bare format check, and a value this wrong must not
    // reach the directory name it becomes once a later task commits it.
    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: "run-1", photoId: "a", date: "0000-99-99" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(400);
  });

  test("patching a photograph refuses a path-traversal attempt as a date", async () => {
    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: "run-1", photoId: "a", date: "../../etc" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(400);
  });

  test("patching a photograph refuses a caption over the shared cap", async () => {
    const { CAPTION_MAX_CHARS } = await import("@/lib/validate/media");
    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: "run-1", photoId: "a", caption: "x".repeat(CAPTION_MAX_CHARS + 1) }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(400);
  });

  test("a caption within the cap is accepted", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const manifest = readManifest("alex", runId);
    if (!manifest) throw new Error("run vanished");
    manifest.photos.push({ id: "a", filename: "a.jpg", bytes: 1, kind: "image" });
    writeManifest("alex", manifest);

    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: runId, photoId: "a", caption: "A quiet morning by the lake." }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(200);
  });

  test("GET groups the run's photographs into days and asks about each", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const manifest = readManifest("alex", runId);
    if (!manifest) throw new Error("run vanished");
    manifest.photos.push(
      { id: "a", filename: "a.jpg", bytes: 1, kind: "image", takenAt: "2019-07-02T10:00:00" },
      { id: "b", filename: "b.jpg", bytes: 1, kind: "image", takenAt: "2019-07-02T10:05:00" },
    );
    writeManifest("alex", manifest);

    const { GET } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await GET(new Request(`http://x?run=${runId}`), {
      params: Promise.resolve({ user: "alex" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: { date: string; photoIds: string[] }[];
      questions: Record<string, { id: string }[]>;
    };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].photoIds).toEqual(["a", "b"]);
    expect(body.questions["2019-07-02"].length).toBeGreaterThan(0);
  });

  test("PATCH applies only the fields present in the body", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const manifest = readManifest("alex", runId);
    if (!manifest) throw new Error("run vanished");
    manifest.photos.push({ id: "a", filename: "a.jpg", bytes: 1, kind: "image", caption: "old caption" });
    writeManifest("alex", manifest);

    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: runId, photoId: "a", visibility: "guest" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { photo: { caption?: string; visibility?: string } };
    expect(body.photo.visibility).toBe("guest");
    // Untouched by this call, and still there — "only the fields present".
    expect(body.photo.caption).toBe("old caption");
  });

  test("PATCH against an unknown run answers 404", async () => {
    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: "run-does-not-exist", photoId: "a", caption: "hi" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(404);
  });

  test("R2 — GET on a warned run extends it, with no button", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const before = readManifest("alex", runId);
    if (!before) throw new Error("run vanished");
    writeManifest("alex", { ...before, warnedAt: "2026-09-01T00:00:00.000Z" });

    const { GET } = await import("@/app/api/helper/[user]/extract/run/route");
    await GET(new Request(`http://x?run=${runId}`), { params: Promise.resolve({ user: "alex" }) });

    const after = readManifest("alex", runId);
    expect(after?.extendedAt).toBeDefined();
    // `>=` rather than `>` — a fast test run can land the extension in the
    // same millisecond as the original `expiresAt` it is extending from.
    expect(Date.parse(after!.expiresAt)).toBeGreaterThanOrEqual(Date.parse(before.expiresAt));
  });

  test("R2 — PATCH on a warned run extends it too", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    let before = readManifest("alex", runId);
    if (!before) throw new Error("run vanished");
    before = { ...before, warnedAt: "2026-09-01T00:00:00.000Z" };
    before.photos.push({ id: "a", filename: "a.jpg", bytes: 1, kind: "image" });
    writeManifest("alex", before);

    const { PATCH } = await import("@/app/api/helper/[user]/extract/run/route");
    await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ run: runId, photoId: "a", caption: "hello" }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );

    const after = readManifest("alex", runId);
    expect(after?.extendedAt).toBeDefined();
    // `>=` rather than `>` — a fast test run can land the extension in the
    // same millisecond as the original `expiresAt` it is extending from.
    expect(Date.parse(after!.expiresAt)).toBeGreaterThanOrEqual(Date.parse(before.expiresAt));
    // The extension must not have lost the write it rode along with.
    expect(after?.photos[0].caption).toBe("hello");
  });

  test("POST .../day appends the answer to the manifest, not to inbox/days", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { POST } = await import("@/app/api/helper/[user]/extract/day/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          run: runId,
          date: "2019-07-02",
          questionId: "open:2019-07-02",
          answer: "We wandered the old town and got lost twice.",
        }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { day: { date: string; words?: string; answered: string[] } };
    expect(body.day.words).toContain("wandered the old town");
    expect(body.day.answered).toEqual(["open:2019-07-02"]);

    const { readManifest } = await import("@/lib/staging/manifest");
    const manifest = readManifest("alex", runId);
    expect(manifest?.days).toHaveLength(1);
    expect(manifest?.days[0].words).toContain("wandered the old town");
    // Deliberately not `appendWords` from lib/dayReadiness.ts — nothing is in
    // `inbox/days/` for this run, so this describes what it must not do
    // (write there) via the answer only landing on the manifest.
  });

  test("POST .../day appends a second answer rather than overwriting the first", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { POST } = await import("@/app/api/helper/[user]/extract/day/route");
    const day = () =>
      POST(
        new Request("http://x", {
          method: "POST",
          body: JSON.stringify({
            run: runId,
            date: "2019-07-02",
            questionId: "first",
            answer: "First answer.",
          }),
        }),
        { params: Promise.resolve({ user: "alex" }) },
      );
    await day();
    const second = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ run: runId, date: "2019-07-02", questionId: "second", answer: "Second answer." }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    const body = (await second.json()) as { day: { words?: string; answered: string[] } };
    expect(body.day.words).toContain("First answer.");
    expect(body.day.words).toContain("Second answer.");
    expect(body.day.answered).toEqual(["first", "second"]);
  });

  test("R2 — POST .../day on a warned run extends it", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const before = readManifest("alex", runId);
    if (!before) throw new Error("run vanished");
    writeManifest("alex", { ...before, warnedAt: "2026-09-01T00:00:00.000Z" });

    const { POST } = await import("@/app/api/helper/[user]/extract/day/route");
    await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ run: runId, date: "2019-07-02", questionId: "q", answer: "Hi." }),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    );

    const after = readManifest("alex", runId);
    expect(after?.extendedAt).toBeDefined();
    expect(Date.parse(after!.expiresAt)).toBeGreaterThanOrEqual(Date.parse(before.expiresAt));
  });
});

/**
 * The sample and enrich routes — B1751 Task 4.1.
 *
 * A real database, unlike every other describe block in this file: the
 * enrich route spends and refunds through `lib/credits.ts`, which refuses
 * outright with nowhere to record a ledger row (see its own doc comment),
 * so a real sqlite file is what lets the success and refusal paths actually
 * run rather than both reading as "no database configured".
 */
describe("the sample and enrich routes — B1751 Task 4.1", () => {
  let dbDir: string;

  beforeEach(async () => {
    cap.enabled = true;
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-credits-"));
    process.env.DATABASE_URL = `sqlite:${path.join(dbDir, "test.db")}`;
    const { getDatabase } = await import("@/lib/db");
    const { migrateToLatest } = await import("@/lib/db/migrate");
    await migrateToLatest(await getDatabase());
    helperModel.describePhotos.mockClear();
    helperModel.describePhotos.mockImplementation(async (images: { base64: string }[]) =>
      images.map(() => "A quiet street."),
    );
  });

  afterEach(async () => {
    const { closeDatabase } = await import("@/lib/db");
    await closeDatabase();
    delete process.env.DATABASE_URL;
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  async function stagedManifest(runId: string, filenames: string[]) {
    const { putStagedFile } = await import("@/lib/staging/store");
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const manifest = readManifest("alex", runId);
    if (!manifest) throw new Error("run vanished");
    const staged = filenames.map((name) => putStagedFile("alex", runId, name, CAMERA_JPEG));
    for (const s of staged) manifest.photos.push({ id: s.id, filename: s.filename, bytes: s.bytes, kind: "image" });
    writeManifest("alex", manifest);
    return staged;
  }

  test("the sample is free, and only one per run", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const [staged] = await stagedManifest(runId, ["a.jpg"]);

    const { POST } = await import("@/app/api/helper/[user]/extract/sample/route");
    const call = () =>
      POST(
        new Request("http://x", { method: "POST", body: JSON.stringify({ run: runId, photoId: staged.id }) }),
        { params: Promise.resolve({ user: "alex" }) },
      );
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(409);
  });

  test("the sample never touches the credit ledger", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    const [staged] = await stagedManifest(runId, ["a.jpg"]);
    const { balanceOf } = await import("@/lib/credits");

    const { POST } = await import("@/app/api/helper/[user]/extract/sample/route");
    await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ run: runId, photoId: staged.id }) }),
      { params: Promise.resolve({ user: "alex" }) },
    );

    // No grant either — a journal with nothing at all still gets its sample,
    // because nothing is spent.
    expect(await balanceOf("alex")).toBe(0);
  });

  test("spending credits captions every live photograph, at the ref the expiry warning reads", async () => {
    const { grant, ledgerFor, balanceOf } = await import("@/lib/credits");
    await grant("alex", 10, "test");

    const { runId } = (await (await startRun()).json()) as { runId: string };
    await stagedManifest(runId, ["a.jpg", "b.jpg"]);

    const { POST } = await import("@/app/api/helper/[user]/extract/enrich/route");
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ run: runId }) }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { spent: number; captioned: number };
    // creditsForPhotos(2) === Math.ceil(2 / PHOTOS_PER_CREDIT) === 1.
    expect(body.spent).toBe(1);
    expect(body.captioned).toBe(2);
    expect(await balanceOf("alex")).toBe(9);

    // R4 — the ref is exactly `extract:<runId>`, the same string the nightly
    // expiry warning reads the ledger by.
    const ledger = await ledgerFor("alex", 10);
    expect(ledger.some((row) => row.ref === `extract:${runId}` && row.reason === "helper")).toBe(true);

    const { readManifest } = await import("@/lib/staging/manifest");
    const after = readManifest("alex", runId);
    expect(after?.photos.every((p) => p.caption === "A quiet street.")).toBe(true);
  });

  test("refuses without enough credits, and captions nothing", async () => {
    const { runId } = (await (await startRun()).json()) as { runId: string };
    await stagedManifest(runId, ["a.jpg"]);

    const { POST } = await import("@/app/api/helper/[user]/extract/enrich/route");
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ run: runId }) }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(402);

    const { readManifest } = await import("@/lib/staging/manifest");
    const after = readManifest("alex", runId);
    expect(after?.photos.every((p) => !p.caption)).toBe(true);
  });

  test("a spend that buys nothing is given back", async () => {
    const { grant, balanceOf } = await import("@/lib/credits");
    await grant("alex", 10, "test");
    helperModel.describePhotos.mockRejectedValueOnce(new Error("boom"));

    const { runId } = (await (await startRun()).json()) as { runId: string };
    await stagedManifest(runId, ["a.jpg"]);

    const { POST } = await import("@/app/api/helper/[user]/extract/enrich/route");
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ run: runId }) }),
      { params: Promise.resolve({ user: "alex" }) },
    );
    expect(res.status).toBe(502);
    expect(await balanceOf("alex")).toBe(10);
  });
});
