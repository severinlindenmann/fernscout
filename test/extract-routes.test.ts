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
