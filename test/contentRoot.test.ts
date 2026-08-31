import { afterEach, describe, expect, test } from "vitest";
import path from "node:path";
import { contentRoot } from "@/lib/contentRoot";

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
