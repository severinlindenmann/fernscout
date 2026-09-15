import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-staging-"));
  process.env.DATA_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("the staging store", () => {
  test("keeps bytes outside the journal", async () => {
    const { putStagedFile, readStagedFile } = await import("@/lib/staging/store");
    const stored = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    expect(stored.bytes).toBe(5);
    expect(readStagedFile("alex", "run-1", stored.id)?.toString()).toBe("hello");
    // Nothing was written anywhere a quota walk would find it.
    expect(fs.existsSync(path.join(tmp, "content", "alex"))).toBe(false);
  });

  test("the same bytes twice are one file", async () => {
    const { putStagedFile, runBytes } = await import("@/lib/staging/store");
    const a = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    const b = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    expect(b.id).toBe(a.id);
    expect(runBytes("alex", "run-1")).toBe(5);
  });

  test("a run id refuses a path separator", async () => {
    const { readStagedFile } = await import("@/lib/staging/store");
    expect(() => readStagedFile("alex", "../../etc", "x")).toThrow();
  });
});

describe("the run manifest", () => {
  test("round-trips, and a missing run reads as null", async () => {
    const { writeManifest, readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest("alex", "run-none")).toBeNull();
    writeManifest("alex", {
      version: 1,
      runId: "run-1",
      owner: "alex",
      createdAt: "2026-09-15T10:00:00Z",
      expiresAt: "2026-09-17T10:00:00Z",
      tripId: null,
      mode: "voice",
      state: "uploading",
      photos: [{ id: "a.jpeg", filename: "IMG_1.jpeg", bytes: 5, kind: "image" }],
      days: [],
    });
    expect(readManifest("alex", "run-1")?.photos[0].filename).toBe("IMG_1.jpeg");
  });

  test("a corrupt manifest reads as null rather than throwing", async () => {
    const { readManifest } = await import("@/lib/staging/manifest");
    const { runDir } = await import("@/lib/staging/paths");
    fs.mkdirSync(runDir("alex", "run-bad"), { recursive: true });
    fs.writeFileSync(path.join(runDir("alex", "run-bad"), "run.json"), "{ not json");
    expect(readManifest("alex", "run-bad")).toBeNull();
  });

  test("a manifest with no photos array reads as null rather than a crash later — R10", async () => {
    const { readManifest } = await import("@/lib/staging/manifest");
    const { runDir } = await import("@/lib/staging/paths");
    fs.mkdirSync(runDir("alex", "run-no-photos"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir("alex", "run-no-photos"), "run.json"),
      JSON.stringify({ version: 1, runId: "run-no-photos", owner: "alex" }),
    );
    expect(readManifest("alex", "run-no-photos")).toBeNull();
  });
});
