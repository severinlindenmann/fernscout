import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B1248 — `/api/health` reported `content.ok` from a `readdirSync` alone.
 *
 * Throughout the outage this ticket names, the content root was readable and
 * unwritable: every page kept rendering from disk, so nothing here noticed
 * that a signup, a publish or an upload was failing behind it. `content` now
 * proves writability with a throwaway probe file, and a root that lists fine
 * but refuses a write is unhealthy the same way an unreadable one already was.
 */

let dir: string;

const anonymous = () => new Request("https://example.test/api/health");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-health-writable-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONTENT_DIR;
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a writable content root is ok, and leaves no probe file behind", async () => {
  const response = await health(anonymous());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.content).toEqual({ ok: true });
  expect(fs.readdirSync(dir)).not.toContain(
    expect.stringMatching(/^\.health-write-probe-/),
  );
});

test("an unwritable content root is unhealthy, and names the path only to the operator", async () => {
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
    throw new Error("EACCES: permission denied");
  });

  const response = await health(anonymous());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.status).toBe("error");
  expect(body.content.ok).toBe(false);
  expect(body.content.code).toBe("unwritable");
  expect(body.content.error).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(dir);
});

test("the operator token brings back the path and errno for an unwritable root", async () => {
  process.env.HEALTH_TOKEN = "s3cret";
  vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
    throw new Error("EACCES: permission denied");
  });

  const response = await health(
    new Request("https://example.test/api/health", {
      headers: { authorization: "Bearer s3cret" },
    }),
  );
  const body = await response.json();
  expect(body.content.ok).toBe(false);
  expect(body.content.error).toMatch(/EACCES/);
  expect(body.content.error).toContain(dir);
  delete process.env.HEALTH_TOKEN;
});
