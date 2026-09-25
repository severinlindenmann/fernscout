import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { bannerFor } from "@/lib/site";

/**
 * The operator's notice, in the reader's language.
 *
 * The notice is not chrome — it is not in `site/locales/`, and an instance
 * cannot add a key there without editing the checkout. So the operator writes
 * it themselves, once per language they can manage, and `text` covers everyone
 * else. B660.
 */

let dir: string;

function withBanner(banner: unknown) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "N", url: "https://x.test", banner } }),
  );
  clearConfigCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-banner-"));
  process.env.FERNSCOUT_CONFIG = path.join(dir, "config.json");
  clearConfigCache();
});

afterEach(() => {
  delete process.env.FERNSCOUT_CONFIG;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("bannerFor", () => {
  test("no banner is no banner, in any language", () => {
    withBanner(undefined);
    expect(bannerFor("de")).toBeUndefined();
  });

  test("picks the language the reader is reading in", () => {
    withBanner({ enabled: true, text: "Beta", translations: { de: "Beta-Phase", hu: "Béta" } });
    expect(bannerFor("de")).toBe("Beta-Phase");
    expect(bannerFor("hu")).toBe("Béta");
  });

  /** A notice nobody sees is worse than one in the wrong language. */
  test("falls back to the operator's own wording for a language they did not write", () => {
    withBanner({ enabled: true, text: "Beta", translations: { de: "Beta-Phase" } });
    expect(bannerFor("hr")).toBe("Beta");
  });

  test("a region takes its language's wording", () => {
    withBanner({ enabled: true, text: "Beta", translations: { de: "Beta-Phase" } });
    expect(bannerFor("de-CH")).toBe("Beta-Phase");
  });
});
