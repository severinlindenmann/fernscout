import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasLegal, legalLocales, readLegal } from "@/lib/legal";

/**
 * The imprint page is content, not code (lib/legal.ts says why), so the two
 * things worth testing are the two things that decide whether a reader sees a
 * page at all: an instance that wrote none must draw no link, and a reader
 * asking for a language nobody wrote must get *something* rather than a 404.
 */

let dir: string;
const original = process.env.CONTENT_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-legal-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  if (original === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = original;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(locale: string, body: string) {
  fs.mkdirSync(path.join(dir, "legal"), { recursive: true });
  fs.writeFileSync(path.join(dir, "legal", `${locale}.md`), body);
}

describe("the instance's legal page", () => {
  test("an instance that wrote none has none, and says so rather than throwing", () => {
    expect(hasLegal()).toBe(false);
    expect(legalLocales()).toEqual([]);
    expect(readLegal("de")).toBeNull();
  });

  test("serves the asked-for language when it exists", () => {
    write("en", "english");
    write("de", "deutsch");
    expect(readLegal("de")).toEqual({ markdown: "deutsch", locale: "de" });
    expect(hasLegal()).toBe(true);
  });

  test("falls back rather than 404s, and reports the language it fell back to", () => {
    write("en", "english");
    expect(readLegal("hu")).toEqual({ markdown: "english", locale: "en" });
  });

  test("a German-only instance serves German to an English reader", () => {
    write("de", "deutsch");
    expect(readLegal("en")).toEqual({ markdown: "deutsch", locale: "de" });
  });

  test("a locale that is not two letters cannot reach out of the folder", () => {
    write("en", "english");
    fs.writeFileSync(path.join(dir, "secret.md"), "not yours");
    expect(readLegal("../secret")).toEqual({ markdown: "english", locale: "en" });
  });
});
