import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, parseUserConfig } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { journalProfile, setJournalProfile } from "@/lib/journals";

/**
 * B614 — `owner.tel`, the number the owner's own free WhatsApp copy of a day
 * goes to.
 *
 * Two properties, and they pull in opposite directions on purpose. The number
 * is stored **normalised**, so the send path never re-parses a config string
 * and a number that cannot work is refused while somebody is still looking at
 * the answer. And it is normalised with **no default country code**, unlike a
 * contact's number: `whatsappCountryCode()` is the operator's env, and a
 * journal that parsed yesterday must not stop parsing because the operator
 * edited it.
 */

const OWNER = "ana";

let dir: string;

function journalFile(tel?: string): Record<string, unknown> {
  return {
    title: "The Solo Journal",
    owner: { name: "Ana B", nickname: "Ana", email: "ana@example.test", ...(tel ? { tel } : {}) },
    startLocation: "Zurich",
    defaultLocale: "en",
    locales: ["en"],
    baseCurrency: "CHF",
    displayCurrencies: ["CHF"],
    units: "metric",
    features: {},
  };
}

function writeJournal(tel?: string) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {},
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(path.join(dir, OWNER, "config.json"), JSON.stringify(journalFile(tel)));
  clearConfigCache();
  clearUserCache();
}

/** `config.json` as it stands on disk, which is what a `PATCH` has to leave
 * in a state the parser accepts. */
function onDisk(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, OWNER, "config.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-owner-tel-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the number in the file", () => {
  test("every international form is stored as the same digits", () => {
    for (const raw of ["+41 76 561 31 50", "+41765613150", "0041 76 561 31 50", "41765613150"]) {
      expect(parseUserConfig(OWNER, journalFile(raw)).owner.tel).toBe("41765613150");
    }
  });

  test("absent is the normal case, and is not an empty string", () => {
    expect(parseUserConfig(OWNER, journalFile()).owner.tel).toBeUndefined();
  });

  test("a national number is refused, and the message says why", () => {
    expect(() => parseUserConfig(OWNER, journalFile("076 561 31 50"))).toThrow(
      /owner\.tel must be a telephone number with its country code/,
    );
  });

  test("something that is not a number at all is refused too", () => {
    expect(() => parseUserConfig(OWNER, journalFile("ring me"))).toThrow(/owner\.tel/);
  });
});

describe("setting it through PATCH /api/v1/<user>/config", () => {
  test("writes owner.tel and leaves the rest of the owner block alone", () => {
    writeJournal();
    const result = setJournalProfile(OWNER, { ownerTel: "+41 76 561 31 50" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual(["ownerTel"]);
    expect(result.journal.ownerTel).toBe("41765613150");

    // The block is rewritten, so the fields nobody may set through here have
    // to survive it — the email in particular, which decides who can get a
    // token for this journal.
    expect(onDisk().owner).toEqual({
      name: "Ana B",
      nickname: "Ana",
      email: "ana@example.test",
      tel: "41765613150",
    });
    expect(getUser(OWNER)?.owner.tel).toBe("41765613150");
  });

  test("an empty string clears it, and the key leaves the file", () => {
    writeJournal("+41765613150");
    const result = setJournalProfile(OWNER, { ownerTel: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual(["ownerTel"]);
    expect(result.journal.ownerTel).toBe("");
    expect(onDisk().owner).not.toHaveProperty("tel");
  });

  test("a national number is refused rather than guessed, and nothing is written", () => {
    writeJournal();
    const result = setJournalProfile(OWNER, { ownerTel: "076 561 31 50" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_ownerTel");
    expect(result.message).toMatch(/country code/);
    expect(onDisk().owner).not.toHaveProperty("tel");
  });

  test("the owner block as a whole is still refused, and now points at the field that works", () => {
    writeJournal();
    const result = setJournalProfile(OWNER, { owner: { tel: "+41765613150" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unsupported_field");
    expect(result.message).toMatch(/ownerTel/);
    expect(result.message).toMatch(/owner\.email in particular is never writable/);
  });

  test("the read-back a caller checks its own work against carries it", () => {
    writeJournal("+41765613150");
    const user = getUser(OWNER)!;
    expect(journalProfile(user).ownerTel).toBe("41765613150");
  });
});
