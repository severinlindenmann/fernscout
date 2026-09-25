import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * `DELETE .../studio/run` — B1805. The resume screen's "let this run go"
 * control: `removeRun` (`lib/staging/store.ts`) already did the deletion,
 * nothing exposed it. Same gate order as its siblings — capability, then
 * owner — and the same mocking approach `extract-routes.test.ts` uses:
 * hoisted toggles, since vitest allows only one `vi.mock` factory per
 * module.
 */
const cap = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/capabilities", () => ({
  isEnabled: (name: string) => (name === "extract" ? cap.enabled : true),
}));

const owner = vi.hoisted(() => ({ yes: true }));
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => owner.yes };
});

// `notYourJournal`'s stranger branch reads `resolveAccess`, which reads
// cookies outside any request scope here — the same mock
// `test/helper-search.test.ts` uses for the same reason.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

let dir: string;
beforeEach(() => {
  cap.enabled = true;
  owner.yes = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-delete-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

async function seedRun(username: string, runId: string) {
  const { writeManifest } = await import("@/lib/staging/manifest");
  const { putStagedFile } = await import("@/lib/staging/store");
  putStagedFile(username, runId, "IMG_0001.jpeg", Buffer.from("hello"));
  writeManifest(username, {
    version: 1,
    runId,
    owner: username,
    createdAt: "2026-09-15T10:00:00Z",
    expiresAt: "2026-09-17T10:00:00Z",
    tripId: null,
    mode: "voice",
    state: "uploading",
    photos: [{ id: "IMG_0001.jpeg", filename: "IMG_0001.jpeg", bytes: 5, kind: "image" }],
    days: [],
  });
}

function del(user: string, runId: string): Promise<Response> {
  return import("@/app/api/helper/[user]/studio/run/route").then(({ DELETE }) =>
    DELETE(new Request(`http://x/api/helper/${user}/studio/run?run=${runId}`, { method: "DELETE" }), {
      params: Promise.resolve({ user }),
    }),
  );
}

describe("DELETE the extract run route", () => {
  test("the capability off answers 404, not 500 and not 403", async () => {
    cap.enabled = false;
    await seedRun("alex", "run-1");
    const res = await del("alex", "run-1");
    expect(res.status).toBe(404);
    const { runDir } = await import("@/lib/staging/paths");
    expect(fs.existsSync(runDir("alex", "run-1"))).toBe(true);
  });

  test("a stranger cannot reach it — notYourJournal, not a deletion", async () => {
    owner.yes = false;
    await seedRun("alex", "run-1");
    // 401 ("session lapsed") for a request carrying no address at all — see
    // `notYourJournal`'s own doc comment. What matters here is that it is
    // never 200 and never deletes anything.
    const res = await del("alex", "run-1");
    expect(res.status).toBe(401);
    const { runDir } = await import("@/lib/staging/paths");
    expect(fs.existsSync(runDir("alex", "run-1"))).toBe(true);
  });

  test("an unknown run answers 404 rather than a silent no-op", async () => {
    const res = await del("alex", "run-none");
    expect(res.status).toBe(404);
  });

  test("the owner can destroy their own run — its files are gone from disk afterwards", async () => {
    await seedRun("alex", "run-1");
    const { runDir } = await import("@/lib/staging/paths");
    const dirBefore = runDir("alex", "run-1");
    expect(fs.existsSync(dirBefore)).toBe(true);
    expect(fs.readdirSync(path.join(dirBefore, "files"))).toHaveLength(1);

    const res = await del("alex", "run-1");
    expect(res.status).toBe(200);

    // Asserted on the filesystem, not the response body.
    expect(fs.existsSync(dirBefore)).toBe(false);
    const { readManifest } = await import("@/lib/staging/manifest");
    expect(readManifest("alex", "run-1")).toBeNull();
  });

  test("destroying one run leaves a sibling run's files untouched", async () => {
    await seedRun("alex", "run-1");
    await seedRun("alex", "run-2");
    await del("alex", "run-1");
    const { runDir } = await import("@/lib/staging/paths");
    expect(fs.existsSync(runDir("alex", "run-1"))).toBe(false);
    expect(fs.existsSync(runDir("alex", "run-2"))).toBe(true);
  });
});
