import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { createJournal, journalsOwnedBy, MAX_JOURNALS_PER_EMAIL } from "@/lib/journals";
import { createTrip } from "@/lib/tripWrite";
import { getTrip, getTrips } from "@/lib/trips";

/**
 * Creating a journal and a trip over the API.
 *
 * A username is a directory name and a URL segment, and a trip's visibility
 * decides who on the internet can read somebody's journey. Both are now
 * settable by anyone who can read an email, so the checks below are the ones
 * standing between that and a stranger's holiday on the open web.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-journals-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: ["admin", "blog"] },
      features: { signup: { enabled: true }, auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const OWNER = "owner@example.test";

/** Every trip needs both, so they are not worth restating in each test. */
const DATES = { start: "2027-04-01", end: "2027-04-20" };

function make(username: string, extra: Record<string, unknown> = {}) {
  return createJournal({
    username,
    title: "A journal",
    ownerEmail: OWNER,
    ownerName: "Robin Traveller",
    ownerNickname: "Robin",
    ...extra,
  });
}

describe("creating a journal", () => {
  test("writes one that reads back", () => {
    const result = make("wanderer");
    expect(result.ok).toBe(true);

    const user = getUser("wanderer");
    expect(user?.title).toBe("A journal");
    expect(user?.owner.email).toBe(OWNER);
    // Or the owner could never obtain a token to write to what they just made.
    expect(user?.features.auth?.enabled).toBe(true);
  });

  test("the owner it was created with loads back through getUser", () => {
    const result = make("traveller", { ownerName: "Alex Rivera", ownerNickname: "Al" });
    expect(result.ok).toBe(true);

    const user = getUser("traveller");
    expect(user?.owner.name).toBe("Alex Rivera");
    expect(user?.owner.nickname).toBe("Al");
    expect(user?.owner.email).toBe(OWNER);
  });

  test("refuses a missing or blank nickname, and never guesses one", () => {
    const missing = make("no-nickname", { ownerNickname: "" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("invalid_owner");

    const blank = make("blank-nickname", { ownerNickname: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error).toBe("invalid_owner");

    // In particular: no journal was written that guessed a nickname from the name.
    expect(getUser("no-nickname")).toBeNull();
    expect(getUser("blank-nickname")).toBeNull();
  });

  test("creates the trips folder, so the journal reads as empty and not as broken", () => {
    make("wanderer");
    expect(fs.existsSync(path.join(dir, "wanderer", "trips"))).toBe(true);
    expect(getTrips("wanderer")).toEqual([]);
  });

  test("refuses a name that would shadow one of the server's own routes", () => {
    for (const name of ["api", "admin", "blog", "_next", "sitemap.xml"]) {
      const result = make(name);
      expect(result.ok, `${name} must be refused`).toBe(false);
    }
  });

  test("refuses a name that is not a name", () => {
    for (const name of ["", "a", "-nope", "Has Capitals", "with/slash", "..", "x".repeat(40)]) {
      expect(make(name).ok, `${name} must be refused`).toBe(false);
    }
  });

  test("a path traversal in the username cannot escape the content folder", () => {
    expect(make("../../etc").ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "..", "etc"))).toBe(false);
  });

  test("refuses to overwrite one that already exists", () => {
    expect(make("wanderer").ok).toBe(true);
    const second = createJournal({
      username: "wanderer",
      title: "Someone else's",
      ownerEmail: "thief@example.test",
      ownerName: "Thief",
      ownerNickname: "Thief",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("username_taken");
    // And the original is untouched.
    expect(getUser("wanderer")?.title).toBe("A journal");
  });

  test("one address may not create journals without limit", () => {
    for (let i = 0; i < MAX_JOURNALS_PER_EMAIL; i++) {
      expect(make(`journal-${i}`).ok).toBe(true);
    }
    const tooMany = make("journal-last");
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toBe("too_many_journals");

    // A different address is unaffected.
    expect(
      createJournal({
        username: "someone-else",
        title: "T",
        ownerEmail: "other@example.test",
        ownerName: "Other",
        ownerNickname: "Other",
      }).ok,
    ).toBe(true);
  });

  test("the cap counts by address, case-insensitively", () => {
    make("one");
    expect(journalsOwnedBy("OWNER@Example.TEST")).toEqual(["one"]);
    expect(journalsOwnedBy("nobody@example.test")).toEqual([]);
  });

  test("a journal needs a title", () => {
    expect(make("wanderer", { title: "   " }).ok).toBe(false);
  });
});

describe("creating a trip", () => {
  beforeEach(() => {
    make("wanderer");
  });

  test("writes one that reads back", () => {
    const result = createTrip("wanderer", { id: "japan-2027", title: "Japan", ...DATES });
    expect(result.ok).toBe(true);
    const trip = getTrip("wanderer/japan-2027");
    expect(trip?.title).toBe("Japan");
  });

  test("is private unless the caller says otherwise", () => {
    // The default that matters most: an agent that omits the field must not
    // put somebody's journey on the open web.
    createTrip("wanderer", { id: "quiet", title: "Quiet", ...DATES });
    expect(getTrip("wanderer/quiet")?.visibility).toBe("private");
  });

  test("an unrecognised visibility reads as private, never as public", () => {
    createTrip("wanderer", { ...DATES, id: "typo", title: "T", visibility: "publik" as never });
    expect(getTrip("wanderer/typo")?.visibility).toBe("private");
  });

  test("honours a visibility the caller actually asked for", () => {
    createTrip("wanderer", { ...DATES, id: "open", title: "O", visibility: "public" });
    expect(getTrip("wanderer/open")?.visibility).toBe("public");
  });

  test("refuses an id that is not an id", () => {
    for (const id of ["", "-x", "Japan 2027", "with/slash", "../escape"]) {
      expect(createTrip("wanderer", { id, title: "T", ...DATES }).ok, `${id} must be refused`).toBe(false);
    }
  });

  test("refuses to overwrite an existing trip", () => {
    createTrip("wanderer", { id: "japan-2027", title: "First", ...DATES });
    const again = createTrip("wanderer", { id: "japan-2027", title: "Second", ...DATES });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("trip_exists");
    expect(getTrip("wanderer/japan-2027")?.title).toBe("First");
  });

  test("refuses a journal that does not exist", () => {
    expect(createTrip("nobody", { id: "x", title: "T", ...DATES }).ok).toBe(false);
  });

  test("rejects a date that is not one", () => {
    expect(createTrip("wanderer", { id: "x", title: "T", start: "next April", end: "2027-04-20" }).ok).toBe(false);
  });

  test("a title with quotes does not break the frontmatter", () => {
    const result = createTrip("wanderer", { id: "quoted", title: 'The "big" one', ...DATES });
    expect(result.ok).toBe(true);
    expect(getTrip("wanderer/quoted")?.title).toBe('The "big" one');
  });

  test("the intro prose survives into the trip", () => {
    createTrip("wanderer", { ...DATES, id: "prose", title: "P", intro: "Two weeks, mostly by train." });
    expect(getTrip("wanderer/prose")?.intro).toContain("mostly by train");
  });
});
