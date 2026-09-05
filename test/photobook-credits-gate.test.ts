import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Only the owner check is mocked. `isEnabled` is deliberately the real one:
// mocking it is what let B486 ship, because a stub that answers `true` to
// every name cannot tell a per-instance question from a per-journal one.
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

import { isOwner } from "@/lib/contacts/session";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { photobookEntryFor } from "@/lib/photobook/entry";
import type { Trip } from "@/lib/types";

/**
 * B486 — the photobook button could not be reached on any journal.
 *
 * `photobookEntryFor` asked `isEnabled("credits", username)`. A per-user
 * feature is off unless that journal's own `config.json` names it —
 * `resolveOne` reads `user.features[name]?.enabled` and `USER_DEFAULT_FEATURES`
 * defaults everything except `mail` to false — and **no journal names
 * `credits`**, because it is a fact about the server plus a balance row rather
 * than something a journal opts into. `creditsEnabled()` in `lib/credits.ts`
 * has always asked the instance form, with no username; the photobook gate was
 * the only place in the codebase asking the other one.
 *
 * All five journals on the live instance were missing the key. The example
 * journal held 205 credits and had already paid for a postcard while this
 * gate said it could not pay.
 *
 * The fixture is therefore the shape that was broken: credits on for the
 * server, photobook on for both, and **no `credits` key in the journal**.
 */

let dir: string;
const TRIP = { username: "alex", id: "asia-2026", ref: "alex/asia-2026" } as Trip;

function write(file: string, contents: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(contents, null, 2));
}

/** A server with credits and photobook switched on. */
function writeServer(features: Record<string, unknown>) {
  write(path.join(dir, "config.json"), {
    site: { name: "F", url: "https://example.test", defaultUser: "alex" },
    users: {},
    features: {
      credits: { enabled: true },
      photobook: { enabled: true, provider: "dry-run" },
      ...features,
    },
  });
}

/** A journal that names `photobook` and, like every real one, not `credits`. */
function writeJournal(features: Record<string, unknown>) {
  write(path.join(dir, "alex", "config.json"), {
    title: "Alex",
    tagline: "t",
    owner: { name: "A B", nickname: "A" },
    startLocation: "X",
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    units: "metric",
    features: { photobook: { enabled: true }, ...features },
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gate-"));
  process.env.CONTENT_DIR = dir;
  // The capability needs somewhere to keep an order; without this the gate is
  // refused for a reason that has nothing to do with what is under test.
  process.env.DATABASE_URL = "file:memory";
  vi.mocked(isOwner).mockResolvedValue(true);
  writeServer({});
  writeJournal({});
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the photobook gate and credits", () => {
  test("a journal that never mentions credits can still order — B486", async () => {
    await expect(photobookEntryFor(TRIP)).resolves.toEqual({
      username: "alex",
      trip: "asia-2026",
    });
  });

  test("the server switching credits off closes it for everybody", async () => {
    writeServer({ credits: { enabled: false } });
    clearConfigCache();
    clearUserCache();
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });

  test("a journal may still switch its own photobook off", async () => {
    writeJournal({ photobook: { enabled: false } });
    clearConfigCache();
    clearUserCache();
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });

  test("nobody but the owner, whatever the config says", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });
});
