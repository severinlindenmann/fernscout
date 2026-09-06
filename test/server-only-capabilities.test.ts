import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { isEnabled } from "@/lib/capabilities";
import { clearUserCache } from "@/lib/users";

/**
 * Which capabilities a journal gets a vote on — B611.
 *
 * Three capabilities used to be ordinary per-journal opt-ins and were the
 * wrong shape for what they are. `photobook` and `postcards` spend the
 * *operator's* money at a printer, so the operator decides them for the whole
 * instance and a journal has no vote at all. `whatsapp` is a channel with a
 * mute the owner can reach (`/<user>/me`), so absence means no opinion and
 * only a written `false` is a no — the same three states mail has had since
 * B60.
 *
 * The state under test is the one every real journal was in: a config that
 * has never named any of them, on a server that has all three on.
 */

let dir: string;

function write(file: string, contents: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(contents, null, 2));
}

function writeJournal(features: Record<string, unknown>) {
  write(path.join(dir, "robin", "config.json"), {
    title: "Robin",
    tagline: "t",
    owner: { name: "R B", nickname: "R" },
    startLocation: "X",
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    units: "metric",
    features,
  });
  clearConfigCache();
  clearUserCache();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-server-only-"));
  process.env.CONTENT_DIR = dir;
  // Both printers and WhatsApp keep rows; without this they are refused for a
  // reason that has nothing to do with what is under test.
  process.env.DATABASE_URL = "file:memory";
  write(path.join(dir, "config.json"), {
    site: { name: "F", url: "https://example.test" },
    users: {},
    features: {
      photobook: { enabled: true, provider: "dry-run" },
      postcards: { enabled: true, provider: "dry-run" },
      whatsapp: { enabled: true, backend: "dry-run" },
    },
  });
  writeJournal({});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a journal that has never named any of the three", () => {
  test.each(["photobook", "postcards", "whatsapp"] as const)("has %s", (name) => {
    expect(isEnabled(name, "robin")).toBe(true);
  });
});

describe("what a written false does", () => {
  test.each(["photobook", "postcards"] as const)("nothing, for %s", (name) => {
    writeJournal({ [name]: { enabled: false } });
    expect(isEnabled(name, "robin")).toBe(true);
  });

  test("mutes whatsapp, which is a switch the owner can actually reach", () => {
    writeJournal({ whatsapp: { enabled: false } });
    expect(isEnabled("whatsapp", "robin")).toBe(false);
  });
});

describe("the server is still the ceiling above all three", () => {
  test.each(["photobook", "postcards", "whatsapp"] as const)("%s", (name) => {
    write(path.join(dir, "config.json"), {
      site: { name: "F", url: "https://example.test" },
      users: {},
      features: { [name]: { enabled: false } },
    });
    // A journal asking for it as loudly as it can still does not get it.
    writeJournal({ [name]: { enabled: true } });
    expect(isEnabled(name, "robin")).toBe(false);
  });
});
