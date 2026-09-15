import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-staging-"));
  process.env.DATA_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("the staging store", () => {
  test("keeps bytes outside the journal", async () => {
    const { putStagedFile, readStagedFile } = await import("@/lib/staging/store");
    const stored = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    expect(stored.bytes).toBe(5);
    expect(readStagedFile("alex", "run-1", stored.id)?.toString()).toBe("hello");
    // Nothing was written anywhere a quota walk would find it.
    expect(fs.existsSync(path.join(tmp, "content", "alex"))).toBe(false);
  });

  test("the same bytes twice are one file", async () => {
    const { putStagedFile, runBytes } = await import("@/lib/staging/store");
    const a = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    const b = putStagedFile("alex", "run-1", "IMG_0001.jpeg", Buffer.from("hello"));
    expect(b.id).toBe(a.id);
    expect(runBytes("alex", "run-1")).toBe(5);
  });

  test("a run id refuses a path separator", async () => {
    const { readStagedFile } = await import("@/lib/staging/store");
    expect(() => readStagedFile("alex", "../../etc", "x")).toThrow();
  });
});
