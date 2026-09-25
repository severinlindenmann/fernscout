import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { moveInboxFileToDay, storeInboxFile } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * The one route this ticket adds a security surface with — B1123.
 *
 * `content/<user>/inbox/` is reachable by no other URL (`lib/inbox.ts`). This
 * route is the single door into it, and everything here is either "does the
 * owner get a picture back" or "does everyone else get exactly the same 404
 * a nonexistent id would".
 */

const OWNER_EMAIL = "alex@example.test";
const OTHER_EMAIL = "sam@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

// `decodeSource` is spied on rather than requiring a real `heif-convert`/
// `sips`/`ffmpeg` on the test machine — B1995. The "decodable" test tells it
// what to hand back; the "no decoder" test tells it to fail the way
// `findHeifDecoder` finding nothing does, deterministically either way.
vi.mock("@/lib/ingest/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ingest/image")>();
  return { ...actual, decodeSource: vi.fn(actual.decodeSource) };
});
const { decodeSource } = await import("@/lib/ingest/image");
const { GET } = await import("@/app/api/helper/[user]/inbox/[id]/thumbnail/route");

let dir: string;

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

function request(user: string, id: string, day?: string) {
  const qs = day ? `?day=${encodeURIComponent(day)}` : "";
  return GET(new Request(`https://t.test/api/helper/${user}/inbox/${id}/thumbnail${qs}`), {
    params: Promise.resolve({ user, id }),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-thumb-"));
  process.env.CONTENT_DIR = dir;
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
  vi.mocked(decodeSource).mockClear();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner asking for their own waiting photograph", () => {
  test("gets a resized WebP, held by no shared cache", async () => {
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(800, 600, 1), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("a document has no picture to give back", async () => {
    const stored = storeInboxFile("alex", "files", "statement.csv", Buffer.from("a,b\n1,2\n"), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(404);
  });

  test("a file staged under a day folder is reached through ?day=", async () => {
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(800, 600, 5), {});
    moveInboxFileToDay("alex", stored.entry.id, "2026-05-04");
    // Gone from the flat bucket — the plain route (no `?day=`) must not find it.
    expect((await request("alex", stored.entry.id)).status).toBe(404);
    const response = await request("alex", stored.entry.id, "2026-05-04");
    expect(response.status).toBe(200);
  });

  test("a malformed ?day= is the same 404 an unknown one would be", async () => {
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(800, 600, 6), {});
    moveInboxFileToDay("alex", stored.entry.id, "2026-05-04");
    const response = await request("alex", stored.entry.id, "05-04-2026");
    expect(response.status).toBe(404);
  });

  test.runIf(spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 }).status === 0)(
    "a video staged in the flat bucket gets a looping animated preview",
    async () => {
      const clipPath = path.join(dir, "clip.mov");
      const made = spawnSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x480:rate=10", "-t", "3", "-c:v", "mpeg4", clipPath],
        { timeout: 15_000 },
      );
      expect(made.status).toBe(0);
      const stored = storeInboxFile("alex", "media", "clip.mov", fs.readFileSync(clipPath), {});
      const response = await request("alex", stored.entry.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const bytes = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe("webp");
      // Animated, not one frozen frame — the tile is meant to move.
      expect(metadata.pages).toBeGreaterThan(1);
    },
  );

  test("a corrupt video falls back to 404 without failing the request", async () => {
    const stored = storeInboxFile("alex", "media", "clip.mov", Buffer.from("not really a video"), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(404);
  });

  test("a HEIC gets a real WebP thumbnail when a decoder is available (mocked)", async () => {
    // sharp cannot open this file (it is really a JPEG's bytes under a
    // `.heic` name, and the plain resize path — `resizedCopy` — refuses the
    // extension outright), so the route has to fall through to the decoder
    // branch. `decodeSource` is mocked to hand back a file sharp genuinely
    // can read, standing in for what `heif-convert`/`sips`/`ffmpeg` would.
    const jpeg = path.join(dir, "decoded.jpg");
    fs.writeFileSync(jpeg, await paintJpeg(400, 300, 7));
    vi.mocked(decodeSource).mockResolvedValueOnce({ file: jpeg, alreadyOriented: true, dispose: () => {} });

    const stored = storeInboxFile("alex", "media", "photo.heic", await paintJpeg(400, 300, 8), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = Buffer.from(await response.arrayBuffer());
    expect((await sharp(body).metadata()).format).toBe("webp");
  });

  test("a HEIC with no decoder available stays the 404 glyph, not an error", async () => {
    vi.mocked(decodeSource).mockRejectedValueOnce(new Error("no HEIC decoder on this machine"));
    const stored = storeInboxFile("alex", "media", "photo.heic", await paintJpeg(400, 300, 9), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).toBe(404);
  });
});

describe("everyone else", () => {
  test("no session at all is refused, same shape as a missing id", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(400, 300, 2), {});
    const response = await request("alex", stored.entry.id);
    expect(response.status).not.toBe(200);
  });

  test("a real id belonging to a DIFFERENT journal's owner is 404, not the picture", async () => {
    // The person asking is signed in as sam, sam's own journal exists, and
    // the id is a real, staged file — but it belongs to alex's inbox.
    const stored = storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(500, 400, 3), {});
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    const response = await request("sam", stored.entry.id);
    expect(response.status).toBe(404);
  });

  test("path segments in the id cannot walk out of this journal's own inbox", async () => {
    storeInboxFile("alex", "media", "beach.jpg", await paintJpeg(500, 400, 4), {});
    const response = await request("alex", "../../sam/inbox/media/beach.jpg");
    expect(response.status).toBe(404);
  });

  test("an id naming nothing at all is the same 404", async () => {
    const response = await request("alex", "deadbeef-nothing.jpg");
    expect(response.status).toBe(404);
  });
});
