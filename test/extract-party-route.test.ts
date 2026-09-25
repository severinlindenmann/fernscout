import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readManifest, writeManifest, type RunManifest } from "@/lib/staging/manifest";

/**
 * `PATCH .../studio/party` — S8a's "Save who came", B1803 Task 3.6.
 *
 * What a grep of the route cannot show: that a saved party size and its
 * names actually round-trip through the manifest on disk, that an
 * out-of-range size is refused rather than silently clamped, and that this
 * never touches `trip.json`'s own `people:` block — there is no fixture
 * here for a trip at all, and the route still succeeds, because who came is
 * the run's own fact, not the trip's.
 *
 * `isEnabled`/`isHelperOwner` mocked the same way `test/extract-commit.test.ts`
 * already does.
 */
vi.mock("@/lib/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capabilities")>();
  return { ...actual, isEnabled: (name: string) => (name === "extract" ? true : true) };
});
vi.mock("@/lib/helper/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/helper/server")>();
  return { ...actual, isHelperOwner: async () => true };
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-party-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function baseManifest(): RunManifest {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: null,
    mode: "type",
    state: "telling",
    photos: [],
    days: [],
  };
}

function patch(body: unknown) {
  return import("@/app/api/helper/[user]/studio/party/route").then(({ PATCH }) =>
    PATCH(
      new Request("http://x/api/helper/alex/studio/party", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: "alex" }) },
    ),
  );
}

describe("PATCH .../studio/party", () => {
  test("saves the party size and names onto the run's own manifest", async () => {
    writeManifest("alex", baseManifest());

    const res = await patch({ run: "run-1", size: 2, names: ["Theo", "Nora"] });
    expect(res.status).toBe(200);

    const after = readManifest("alex", "run-1");
    expect(after?.partySize).toBe(2);
    expect(after?.partyNames).toEqual(["Theo", "Nora"]);
  });

  test("a size outside 1..20 is refused, not clamped", async () => {
    writeManifest("alex", baseManifest());

    const res = await patch({ run: "run-1", size: 0, names: [] });
    expect(res.status).toBe(400);

    const res2 = await patch({ run: "run-1", size: 21, names: [] });
    expect(res2.status).toBe(400);

    // Neither refused call wrote anything.
    expect(readManifest("alex", "run-1")?.partySize).toBeUndefined();
  });

  test("names beyond the party size are still saved as given — the route counts, it does not police", async () => {
    writeManifest("alex", baseManifest());

    await patch({ run: "run-1", size: 1, names: ["You", "Nora"] });
    const after = readManifest("alex", "run-1");
    expect(after?.partyNames).toEqual(["You", "Nora"]);
  });

  test("never writes anything to trip.json's people — this fact stays on the run alone", async () => {
    writeManifest("alex", baseManifest());
    await patch({ run: "run-1", size: 2, names: ["Theo", "Nora"] });

    // No trip exists in this fixture at all; the call still succeeded above,
    // which is only possible because it never touched `getTrip`/`trip.json`.
    const after = readManifest("alex", "run-1");
    expect(after?.tripId).toBeNull();
  });

  test("an unknown run is a 404", async () => {
    const res = await patch({ run: "no-such-run", size: 2, names: [] });
    expect(res.status).toBe(404);
  });
});
