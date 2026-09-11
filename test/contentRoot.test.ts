import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertContentRootWritable, contentRoot, ContentRootNotWritableError } from "@/lib/contentRoot";

const original = process.env.CONTENT_DIR;

afterEach(() => {
  if (original === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = original;
});

describe("contentRoot", () => {
  test("defaults to <cwd>/content", () => {
    delete process.env.CONTENT_DIR;
    expect(contentRoot()).toBe(path.join(process.cwd(), "content"));
  });

  test("honours CONTENT_DIR", () => {
    process.env.CONTENT_DIR = "/tmp/fixtures/content";
    expect(contentRoot()).toBe("/tmp/fixtures/content");
  });

  test("is read per call, not frozen at import", () => {
    process.env.CONTENT_DIR = "/tmp/one";
    expect(contentRoot()).toBe("/tmp/one");
    process.env.CONTENT_DIR = "/tmp/two";
    expect(contentRoot()).toBe("/tmp/two");
  });
});

// B1246 — a root created by one uid and then run under another used to throw
// an uncaught EACCES partway through a signup, a registry reconcile, a
// postcard render or a photobook build, with no health signal at all.
describe("assertContentRootWritable", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.chmodSync(dir, 0o755);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does nothing when the root is writable, creating it if absent", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-croot-"));
    const target = path.join(dir, "content");
    process.env.CONTENT_DIR = target;
    expect(() => assertContentRootWritable()).not.toThrow();
    expect(fs.existsSync(target)).toBe(true);
  });

  test("refuses with a named error, not a raw EACCES, when the root cannot be written", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-croot-"));
    fs.chmodSync(dir, 0o000);
    process.env.CONTENT_DIR = dir;
    let thrown: unknown;
    try {
      assertContentRootWritable();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ContentRootNotWritableError);
    expect((thrown as Error).message).toContain(dir);
    expect((thrown as Error).message).toContain("chown");
  });
});
