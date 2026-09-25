import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `POST .../studio/upload`'s journal-wide staging ceiling — B1807.
 *
 * The ceiling is per journal, not per run (`JOURNAL_STAGING_MAX_BYTES` in
 * `lib/validate/media.ts`): a batch that would cross it stages what fits and
 * refuses the rest with a per-file reason, the same "accept what fits" shape
 * `too_large` and `run_full` already had. Same mocking approach as
 * `extract-run-delete.test.ts` — hoisted toggles, since vitest allows only
 * one `vi.mock` factory per module.
 */
const cap = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/capabilities", () => ({
  isEnabled: (name: string) => (name === "extract" ? cap.enabled : true),
}));

// A 1000-byte ceiling rather than the real 10 GB — allocating a real
// gigabyte-scale buffer just to cross it would make this test the slowest,
// most memory-hungry thing in the suite for no gain: the route's own
// arithmetic does not care what the number is, only that it is honoured.
vi.mock("@/lib/validate/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/validate/media")>();
  return { ...actual, JOURNAL_STAGING_MAX_BYTES: 1000 };
});

vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => true };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

let dir: string;
beforeEach(() => {
  cap.enabled = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-ceiling-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function startRun(username: string, runId: string) {
  const { writeManifest } = await import("@/lib/staging/manifest");
  writeManifest(username, {
    version: 1,
    runId,
    owner: username,
    createdAt: "2026-09-15T10:00:00Z",
    expiresAt: "2026-09-17T10:00:00Z",
    tripId: null,
    mode: "type",
    state: "uploading",
    photos: [],
    days: [],
  });
}

function upload(username: string, runId: string, files: { name: string; bytes: Uint8Array }[]) {
  const form = new FormData();
  form.set("run", runId);
  for (const f of files) form.append("file", new File([f.bytes as BlobPart], f.name, { type: "image/jpeg" }));
  return import("@/app/api/helper/[user]/studio/upload/route").then(({ POST }) =>
    POST(new Request(`http://x/api/helper/${username}/studio/upload`, { method: "POST", body: form }), {
      params: Promise.resolve({ user: username }),
    }),
  );
}

describe("the journal-wide staging ceiling", () => {
  test("a batch that fits under the ceiling is accepted whole", async () => {
    await startRun("alex", "run-1");
    const res = await upload("alex", "run-1", [{ name: "a.jpg", bytes: new Uint8Array(100) }]);
    const body = (await res.json()) as { accepted: unknown[]; rejected: unknown[]; stagedBytes: number };
    expect(body.accepted).toHaveLength(1);
    expect(body.rejected).toHaveLength(0);
    expect(body.stagedBytes).toBe(100);
  });

  test("a batch that would cross the ceiling stages what fits and refuses the rest — never the whole batch", async () => {
    await startRun("alex", "run-1");
    // One file that eats the whole (mocked, 1000-byte) ceiling, then a
    // second that has no room left at all.
    const res = await upload("alex", "run-1", [
      { name: "big.jpg", bytes: new Uint8Array(1000) },
      { name: "small.jpg", bytes: new Uint8Array(10) },
    ]);
    const body = (await res.json()) as {
      accepted: { filename: string }[];
      rejected: { filename: string; reason: string }[];
      stagedBytes: number;
    };
    expect(body.accepted.map((p) => p.filename)).toEqual(["big.jpg"]);
    expect(body.rejected).toEqual([{ filename: "small.jpg", reason: "journal_over_capacity" }]);
    expect(body.stagedBytes).toBe(1000);
  });

  test("bytes already staged in a different run of the same journal count against the ceiling", async () => {
    const { putStagedFile } = await import("@/lib/staging/store");
    await startRun("alex", "run-old");
    // A forgotten import already holds almost the whole (mocked) ceiling.
    putStagedFile("alex", "run-old", "old.jpg", Buffer.alloc(995));

    await startRun("alex", "run-new");
    const res = await upload("alex", "run-new", [{ name: "new.jpg", bytes: new Uint8Array(10) }]);
    const body = (await res.json()) as { accepted: unknown[]; rejected: { reason: string }[] };
    expect(body.accepted).toHaveLength(0);
    expect(body.rejected).toEqual([{ filename: "new.jpg", reason: "journal_over_capacity" }]);
  });

  test("a retry of a file already staged in this run is accepted even though the journal sits exactly at the ceiling", async () => {
    const { putStagedFile } = await import("@/lib/staging/store");
    await startRun("alex", "run-1");
    // The run already holds a file that alone fills the (mocked) 1000-byte
    // ceiling — the retry below resends the identical bytes, which
    // `putStagedFile` recognises as content already on disk. It must not be
    // charged a second time: nothing new is landing, so refusing it would
    // reject a page's own retry button forever once a run sits at the limit.
    const bytes = new Uint8Array(1000).fill(7);
    putStagedFile("alex", "run-1", "big.jpg", Buffer.from(bytes));

    const res = await upload("alex", "run-1", [{ name: "big.jpg", bytes }]);
    const body = (await res.json()) as {
      accepted: { filename: string }[];
      rejected: { filename: string; reason: string }[];
      stagedBytes: number;
    };
    expect(body.rejected).toEqual([]);
    expect(body.accepted.map((p) => p.filename)).toEqual(["big.jpg"]);
    expect(body.stagedBytes).toBe(1000);
  });

  test("a different journal's staged bytes never count against this one", async () => {
    const { putStagedFile } = await import("@/lib/staging/store");
    await startRun("mira", "run-1");
    putStagedFile("mira", "run-1", "hers.jpg", Buffer.alloc(995));

    await startRun("alex", "run-1");
    const res = await upload("alex", "run-1", [{ name: "his.jpg", bytes: new Uint8Array(10) }]);
    const body = (await res.json()) as { accepted: unknown[]; rejected: unknown[] };
    expect(body.accepted).toHaveLength(1);
    expect(body.rejected).toHaveLength(0);
  });
});
