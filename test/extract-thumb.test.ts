import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { putStagedFile, stagedFileLocation, removeRun } from "@/lib/staging/store";
import { heifDecoderName } from "@/lib/ingest/image";
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

const { GET } = await import("@/app/api/helper/[user]/studio/thumb/[run]/[id]/route");

/** Asked once, at load: which external HEIC decoder this machine has. */
const heifDecoder = await heifDecoderName();

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
  return GET(new Request(`https://t.test/api/helper/${user}/studio/thumb/${run}/${id}`), {
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

  test("a corrupt video falls back without failing the request", async () => {
    const stored = putStagedFile("alex", "run-1", "clip.mov", Buffer.from("not really a video"));
    const response = await request("alex", "run-1", stored.id);
    expect(response.status).toBe(404);
  });

  test.runIf(heifDecoder !== null)("HEIC and HEIF originals produce cached WebP previews without changing their bytes", async () => {
    const original = fs.readFileSync(path.join(process.cwd(), "test/fixtures/ingest/phone.heic"));
    for (const extension of ["HEIC", "heif"]) {
      const stored = putStagedFile("alex", "run-1", `phone.${extension}`, original);
      const response = await request("alex", "run-1", stored.id);
      expect(response.status).toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.exif).toBeUndefined();
      expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(320);
      expect(fs.readFileSync(stagedFileLocation("alex", "run-1", stored.id)!)).toEqual(original);
      expect(Buffer.from(await (await request("alex", "run-1", stored.id)).arrayBuffer())).toEqual(bytes);
    }
  });

  test.runIf(spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 }).status === 0)("MOV gets a looping animated preview, stays private, and disappears with its run", async () => {
    const clip = path.join(dataDir, "clip.mov");
    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=10", "-t", "3", "-c:v", "mpeg4", clip], { timeout: 15_000 });
    expect(made.status).toBe(0);
    const original = fs.readFileSync(clip);
    const stored = putStagedFile("alex", "run-1", "clip.MOV", original);
    const response = await request("alex", "run-1", stored.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(320);
    expect(metadata.pageHeight ?? metadata.height).toBe(240);
    // Animated, not one frozen frame: the tile is meant to move.
    expect(metadata.pages).toBeGreaterThan(1);
    expect(fs.readFileSync(stagedFileLocation("alex", "run-1", stored.id)!)).toEqual(original);
    expect(Buffer.from(await (await request("alex", "run-1", stored.id)).arrayBuffer())).toEqual(bytes);
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    expect((await request("alex", "run-1", stored.id)).status).toBe(404);
    resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
    removeRun("alex", "run-1");
    expect((await request("alex", "run-1", stored.id)).status).toBe(404);
  });

  test("a renamed playlist is not interpreted as a video", async () => {
    const stored = putStagedFile("alex", "run-1", "clip.mov", Buffer.from("#EXTM3U\nhttp://127.0.0.1:9/private.ts\n"));
    expect((await request("alex", "run-1", stored.id)).status).toBe(404);
  });

  test("TIFF is decoded to WebP too", async () => {
    const original = await sharp(await paintJpeg(800, 600, 2)).tiff().toBuffer();
    const stored = putStagedFile("alex", "run-1", "photo.tiff", original);
    const response = await request("alex", "run-1", stored.id);
    expect(response.status).toBe(200);
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format).toBe("webp");
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
