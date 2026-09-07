import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { IMAGE_MAX_BYTES, REQUEST_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";
import nextConfig from "@/next.config";
import { POST } from "@/app/api/v1/[user]/trips/[trip]/media/route";

/**
 * B523 — a request body over 10 MiB was answered `400 expected_multipart`,
 * which names a malformed Content-Type and sends the caller to look at its own
 * request. The real cause was Next's `proxyClientMaxBodySize`: a proxied
 * request's body is buffered, and past the limit it is **truncated** rather
 * than refused, so `formData()` fails on what is left. One real import lost 15
 * of 75 photographs to it, every one an ordinary phone original inside every
 * documented limit.
 */

let dir: string;
const OWNER_EMAIL = "alex@example.test";

async function ownerToken(): Promise<string> {
  const { code } = await issueCode("alex", OWNER_EMAIL, "agent");
  const verified = await verifyCode("alex", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-media-body-limit-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "media-body-limit-test-secret-body-limit";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    ["---", "id: reise", 'title: "Reise"', 'start: "2026-09-01"', 'end: "2026-09-05"', "---", ""].join(
      "\n",
    ),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the request-body cap", () => {
  test("is above the per-file cap, so the documented per-file limit is reachable", () => {
    // The whole point of B523: a 50 MB photograph is documented as acceptable,
    // and was not sendable because the body cap sat five times below it.
    expect(REQUEST_MAX_BYTES).toBeGreaterThan(IMAGE_MAX_BYTES);
  });

  test("and above the per-clip cap, which for a long time it was not", () => {
    // The same fault as the one above, one file type over: video was
    // advertised at 200 MB while the body cap stood at 64, so the largest clip
    // the documentation promised could not be sent through this door at all.
    // Both moved together; this is what keeps them moving together.
    expect(REQUEST_MAX_BYTES).toBeGreaterThan(VIDEO_MAX_BYTES);
  });

  test("is the number Next actually enforces, not a second one written in prose", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(REQUEST_MAX_BYTES);
  });

  test("a body over it is refused as too large, naming the cap and what arrived", async () => {
    const token = await ownerToken();
    const response = await POST(
      new Request("https://t.test/api/v1/alex/trips/reise/media", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(REQUEST_MAX_BYTES + 1),
        },
        body: "not actually that big",
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(413);
    expect(body.error).toBe("body_too_large");
    // Not `expected_multipart`, which is the refusal that cost the reporting
    // run three wrong hypotheses.
    // The cap from the constant, never a number typed here: this test exists
    // to prove the refusal names the real limit, and a literal would go on
    // passing after the limit moved.
    expect(String(body.message)).toContain(
      `${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(1)} MB`,
    );
    expect(JSON.stringify(body.problems)).toMatch(/in one request/);
  });

  /**
   * A clip between the two caps is not an oversized photograph.
   *
   * The per-file pre-check measured every file against `IMAGE_MAX_BYTES`,
   * which was harmless while nothing over 64 MB could reach the route at all,
   * and is the difference between landing and being refused now that a clip
   * may be 500 MB — in a message naming a limit that was never the one for it.
   *
   * Both files are really that big. `File.size` is a prototype getter and the
   * FormData a Request is built from does not keep an instance that lies about
   * it, so a claimed size is a test that passes for the wrong reason.
   */
  test("the per-file cap is the one for that kind of file", async () => {
    const token = await ownerToken();
    fs.writeFileSync(
      path.join(dir, "alex", "trips", "reise", "entries", "2026-09-02-tag.md"),
      ["---", 'title: "Tag"', 'date: "2026-09-02"', "---", "", "Words.", ""].join("\n"),
    );

    const overImageCap = new Uint8Array(IMAGE_MAX_BYTES + 1);
    const form = new FormData();
    form.set("day", "tag");
    form.append("files", new File([overImageCap], "clip.mp4", { type: "video/mp4" }));
    form.append("files", new File([overImageCap], "photo.jpg", { type: "image/jpeg" }));

    const response = await POST(
      new Request("https://t.test/api/v1/alex/trips/reise/media", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
    const body = (await response.json()) as Record<string, unknown>;

    // The photograph is the one over its cap; the clip of the same size is not.
    expect(response.status).toBe(400);
    expect(JSON.stringify(body)).toContain("for a photograph");
    expect(JSON.stringify(body)).toContain("photo.jpg");
    expect(JSON.stringify(body)).not.toContain("clip.mp4");
  }, 60_000);

  test("a body under it is not refused for its size", async () => {
    const token = await ownerToken();
    const response = await POST(
      new Request("https://t.test/api/v1/alex/trips/reise/media", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "multipart/form-data; boundary=x",
          "content-length": String(REQUEST_MAX_BYTES - 1),
        },
        body: "still not a real multipart body",
      }),
      { params: Promise.resolve({ user: "alex", trip: "reise" }) },
    );
    // It fails for being unparseable, which is what `expected_multipart` is
    // for and the only thing it should mean.
    expect(response.status).toBe(400);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("expected_multipart");
  });
});
