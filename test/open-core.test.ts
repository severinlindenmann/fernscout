import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { assertCapabilities, resolveCapabilities } from "@/lib/capabilities";

/**
 * Open core. The paid capabilities keep their switches in config, but a build
 * without paid/ must refuse them at boot, by name, rather than start with a
 * feature that is only a stub — open-core/split/README.md.
 */
const PAID = ["photobook", "postcards", "whatsapp", "whatsappInbound"] as const;
const hasPaid = fs.existsSync(path.join(process.cwd(), "paid"));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-open-core-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = "sqlite::memory:";
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function enable(name: string) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://example.test" }, users: { reserved: [] }, features: { [name]: { enabled: true } } }),
  );
  clearConfigCache();
}

describe("paid capabilities", () => {
  test.runIf(hasPaid).each(PAID)("with paid/ present, %s is never refused as not included", (name) => {
    enable(name);
    const state = resolveCapabilities()[name];
    expect(state.enabled ? "" : state.reason).not.toContain("not included in this build");
  });

  test.skipIf(hasPaid).each(PAID)("%s switched on without paid/ refuses to boot, by name", (name) => {
    enable(name);
    const state = resolveCapabilities()[name];
    expect(state.enabled).toBe(false);
    expect(state.enabled ? "" : state.reason).toContain("not included in this build");
    expect(() => assertCapabilities()).toThrow(`features.${name} is enabled but it is not included in this build`);
  });

  test("the helper and transcription no longer need credits", () => {
    enable("transcription");
    const speech = resolveCapabilities().transcription;
    expect(speech.enabled ? "" : speech.reason).not.toContain("features.credits");
  });
});
