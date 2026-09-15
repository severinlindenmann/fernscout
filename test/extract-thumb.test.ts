import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { putStagedFile } from "@/lib/staging/store";
import { paintJpeg } from "./support/pictures";

/**
 * The spine of the camera-roll import — B1803 Task 1.1.
 *
 * Sibling of `test/helper-inbox-thumbnail.test.ts`: same four guards, same
 * shape, against `content/<user>/staging/` (`lib/staging/store.ts`) instead
 * of the undated inbox.
 */

const OWNER_EMAIL = "alex@example.test";
const OTHER_EMAIL = "sam@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

// The capability itself is exercised by test/extract-capability.test.ts;
// stubbed on here so this file is free to focus on the four route guards
// without also wiring SESSION_SECRET and the auth/helper capability chain.
vi.mock("@/lib/capabilities", () => ({ isEnabled: (name: string) => name === "extract" }));

const { GET } = await import("@/app/api/helper/[user]/extract/thumb/[run]/[id]/route");

let dir: string;
let dataDir: string;

function journalFor(username: string, email: string) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: "A B", nickname: "A", email },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

function request(user: string, run: string, id: string) {
  return GET(new Request(`https://t.test/api/helper/${user}/extract/thumb/${run}/${id}`), {
    params: Promise.resolve({ user, run, id }),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-thumb-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-extract-thumb-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dataDir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  journalFor("alex", OWNER_EMAIL);
  journalFor("sam", OTHER_EMAIL);
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("the owner asking for their own staged photograph", () => {
  test("gets a resized WebP, held by no shared cache", async () => {
    const stored = putStagedFile("alex", "run-1", "beach.jpg", await paintJpeg(800, 600, 1));
    const response = await request("alex", "run-1", stored.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("a video has no still to give back", async () => {
    const stored = putStagedFile("alex", "run-1", "clip.mov", Buffer.from("not really a video"));
    const response = await request("alex", "run-1", stored.id);
    expect(response.status).toBe(404);
  });
});

describe("everyone else", () => {
  test("a stranger signed in as someone else is 404, never 403", async () => {
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    const stored = putStagedFile("alex", "run-1", "beach.jpg", await paintJpeg(400, 300, 2));
    const response = await request("alex", "run-1", stored.id);
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
  });

  test("another journal's real run id resolves to nothing under this username", async () => {
    const stored = putStagedFile("alex", "run-1", "beach.jpg", await paintJpeg(500, 400, 3));
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    const response = await request("sam", "run-1", stored.id);
    expect(response.status).toBe(404);
  });

  test("a traversal id collapses and finds nothing", async () => {
    putStagedFile("alex", "run-1", "beach.jpg", await paintJpeg(500, 400, 4));
    const response = await request("alex", "run-1", "../../../etc/passwd");
    expect(response.status).toBe(404);
  });
});
