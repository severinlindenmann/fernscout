import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// B-2749: parallel uploads must not overshoot the journal's staging ceiling.
vi.mock("@/lib/validate/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/validate/media")>()),
  JOURNAL_STAGING_MAX_BYTES: 5,
}));

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-parallel-"));
  process.env.DATA_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("stageAndAppend", () => {
  test("ten parallel one-byte uploads never stage past a five-byte ceiling", async () => {
    const { stageAndAppend } = await import("@/lib/staging/stageFiles");
    const { readManifest, writeManifest } = await import("@/lib/staging/manifest");
    const { journalStagingBytes } = await import("@/lib/staging/store");
    const m = {
      version: 1 as const, runId: "run-1", owner: "ana", createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1e6).toISOString(), tripId: null, mode: "type" as const,
      state: "uploading" as const, via: "share" as const, photos: [], days: [],
    };
    writeManifest("ana", m);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        stageAndAppend("ana", m, [new File([new Uint8Array([i])], `${i}.jpg`)]),
      ),
    );
    expect(readManifest("ana", "run-1")?.photos).toHaveLength(5);
    expect(journalStagingBytes("ana")).toBeLessThanOrEqual(5);
    expect(results.flatMap((r) => r.rejected).every((r) => r.reason === "journal_over_capacity")).toBe(true);
    expect(results.flatMap((r) => r.rejected)).toHaveLength(5);
  });
});
