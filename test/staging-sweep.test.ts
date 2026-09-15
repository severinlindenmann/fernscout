import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-sweep-"));
  process.env.DATA_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function makeRun(runId: string, expiresAt: string) {
  const { writeManifest } = await import("@/lib/staging/manifest");
  const { putStagedFile } = await import("@/lib/staging/store");
  putStagedFile("alex", runId, "a.jpeg", Buffer.from(runId));
  writeManifest("alex", {
    version: 1, runId, owner: "alex",
    createdAt: "2026-09-13T10:00:00Z", expiresAt,
    tripId: null, mode: "type", state: "uploading", photos: [], days: [],
  });
}

describe("the staging sweep", () => {
  test("removes an expired run and leaves a live one", async () => {
    await makeRun("run-old", "2026-09-14T10:00:00Z");
    await makeRun("run-new", "2026-09-17T10:00:00Z");
    const { sweepStaging } = await import("@/lib/staging/sweep");
    const { runDir } = await import("@/lib/staging/paths");

    const result = sweepStaging(new Date("2026-09-15T12:00:00Z"));

    expect(result.removed).toEqual(["run-old"]);
    expect(fs.existsSync(runDir("alex", "run-old"))).toBe(false);
    expect(fs.existsSync(runDir("alex", "run-new"))).toBe(true);
  });

  test("a run whose manifest is unreadable is still removed once it is older than the ttl", async () => {
    const { runDir } = await import("@/lib/staging/paths");
    const dir = runDir("alex", "run-broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "run.json"), "{ not json");
    fs.utimesSync(dir, new Date("2026-09-10T00:00:00Z"), new Date("2026-09-10T00:00:00Z"));

    const { sweepStaging } = await import("@/lib/staging/sweep");
    sweepStaging(new Date("2026-09-15T12:00:00Z"));

    expect(fs.existsSync(dir)).toBe(false);
  });

  test("a stray non-run entry does not abort the walk, and is not itself reported removed", async () => {
    const { stagingRoot, runDir } = await import("@/lib/staging/paths");
    await makeRun("run-old", "2026-09-14T10:00:00Z");
    await makeRun("run-new", "2026-09-17T10:00:00Z");
    // A segment that fails runDir's own naming rule — the kind of thing a
    // phone's filesystem leaves behind, not a run this feature ever wrote.
    fs.writeFileSync(path.join(stagingRoot(), "alex", ".DS_Store"), "junk");

    const { sweepStaging } = await import("@/lib/staging/sweep");
    const result = sweepStaging(new Date("2026-09-15T12:00:00Z"));

    expect(result.removed).toEqual(["run-old"]);
    expect(fs.existsSync(runDir("alex", "run-old"))).toBe(false);
    expect(fs.existsSync(runDir("alex", "run-new"))).toBe(true);
    expect(fs.existsSync(path.join(stagingRoot(), "alex", ".DS_Store"))).toBe(true);
  });

  test("an unparseable expiresAt falls back to the directory's mtime rather than deleting immediately", async () => {
    await makeRun("run-badexpiry", "");
    const { runDir } = await import("@/lib/staging/paths");
    const dir = runDir("alex", "run-badexpiry");
    // Recent enough to be well under RUN_TTL_MS — if the bad `expiresAt`
    // were compared directly (`"" <= now.toISOString()` is always true) this
    // run would be deleted immediately instead of falling back to mtime.
    fs.utimesSync(dir, new Date("2026-09-15T11:00:00Z"), new Date("2026-09-15T11:00:00Z"));

    const { sweepStaging } = await import("@/lib/staging/sweep");
    const result = sweepStaging(new Date("2026-09-15T12:00:00Z"));

    expect(result.removed).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });
});
