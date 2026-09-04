import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser, getUsernames, userExists } from "@/lib/users";
import { createJournal, journalsOwnedBy, MAX_JOURNALS_PER_EMAIL, sendWelcome } from "@/lib/journals";
import { listedUsernames } from "@/lib/users";
import { verifyLink } from "@/lib/auth";
import { closeDatabase, getDatabase } from "@/lib/db";
import { instanceDocumentation } from "@/lib/api/documentation";
import { createTrip } from "@/lib/tripWrite";
import { getTrip, getTrips, KNOWN_TRIP_FIELDS } from "@/lib/trips";

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

/**
 * The plain-text alternative of the one mail written under a journal.
 *
 * Parsed by MIME boundary rather than by splitting on blank lines: a base64
 * body contains blank lines of its own, so the cruder version decoded to
 * mojibake for some payloads and cleanly for others, which is the worst way
 * for a test helper to be wrong.
 */
function mailBodyOf(username: string): string {
  const mailDir = path.join(dir, username, "mail");
  const files = fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml"));
  const raw = fs.readFileSync(path.join(mailDir, files[0]), "utf8");
  const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
  if (!boundary) throw new Error("no MIME boundary in the message");

  for (const part of raw.split(`--${boundary}`)) {
    if (!/Content-Type: text\/plain/i.test(part)) continue;
    const encoded = part.split(/\r?\n\r?\n/).slice(1).join("\n");
    return Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8");
  }
  throw new Error("no text/plain part in the message");
}

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

  /**
   * B153. A journal that cannot be shared is not a finished journal.
   *
   * `createJournal` wrote `reactions`, `costs` and `auth` and stopped, the
   * default for `contacts` is off, and **no endpoint or page anywhere writes
   * a user's `features` block** — so the only way to switch it
   * on was to hand-edit config.json over SSH. Every journal an agent made was
   * in that state, and since B39 removed trip passwords an invite link is the
   * only way to let anybody in at all.
   *
   * It went unnoticed because every test that exercises invites writes its own
   * config.json with `contacts: { enabled: true }` in it — see
   * `writeJournal` in test/invite-links.test.ts. The fixture had the feature
   * the product did not. So this asserts on the thing an agent actually calls.
   */
  test("a journal it creates has contacts on, so it can be shared", () => {
    expect(make("sharer").ok).toBe(true);
    expect(getUser("sharer")?.features.contacts?.enabled).toBe(true);
  });

  /**
   * And the server is still the ceiling. A journal asking for contacts on an
   * instance that does not offer it gets nothing — `resolveOne` in
   * lib/capabilities.ts refuses the opt-in above the ceiling, which is what
   * keeps this default from being a way to switch on a capability the operator
   * never configured.
   */
  test("but the journal's opt-in cannot switch on what the server does not offer", async () => {
    expect(make("hopeful").ok).toBe(true);
    const { isEnabled } = await import("@/lib/capabilities");
    // The server config written in beforeEach has no `contacts` block.
    expect(isEnabled("contacts", "hopeful")).toBe(false);
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

  /**
   * B32. The refusal used to be a dead end: an agent that took the signup path
   * for somebody who already had a journal landed on 409 holding a token that
   * can only create journals, and was told the name was taken and nothing
   * else.
   */
  test("a taken name says how to get a write token instead", () => {
    make("wanderer");
    const again = make("wanderer");
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.next).toContain("/api/auth/request");
    expect(again.next).toContain("wanderer");
  });

  test("and says it conditionally, because the server does not know whose it is", () => {
    make("wanderer");
    const again = make("wanderer");
    if (again.ok) return;
    // "If it is theirs" — never "this is yours" or "this is somebody else's".
    expect(again.next).toMatch(/if .* is theirs/i);
    expect(again.next).not.toMatch(/you own|your journal|somebody else/i);
  });

  /**
   * The one that matters. A refusal that differed for the owner would turn
   * journal creation into a way of asking whether an address owns a name —
   * which is exactly what the uniform 202 on /api/auth/request exists to stop.
   */
  test("the refusal is byte-identical whether or not the caller owns the name", () => {
    make("wanderer");

    const byOwner = make("wanderer");
    const byStranger = createJournal({
      username: "wanderer",
      title: "Someone else's",
      ownerEmail: "stranger@example.test",
      ownerName: "Stranger",
      ownerNickname: "Stranger",
    });

    expect(byOwner).toEqual(byStranger);
  });

  test("the journal cap says how to write to one they already own", () => {
    for (let i = 0; i < MAX_JOURNALS_PER_EMAIL; i++) make(`journal-${i}`);
    const tooMany = make("journal-last");
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) return;
    expect(tooMany.next).toContain("/api/auth/request");
    expect(tooMany.next).toContain("journal-0");
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

/**
 * A journal's own visibility: whether the instance advertises it.
 *
 * Not a wall in front of `/<user>` — that is each trip's job, and it has a
 * password and a guest list behind it. What this decides is whether a stranger
 * can come across the journal without being sent the address.
 */
describe("journal visibility", () => {
  test("is public unless asked otherwise, so nothing existing changes", () => {
    const result = make("open");
    expect(result.ok && result.visibility).toBe("public");
    expect(getUser("open")?.visibility).toBe("public");
    expect(listedUsernames()).toContain("open");
  });

  // B306 renamed this level's closed value from `private` to `guest` — the
  // trip level already had a narrower `private`, and reusing the word one
  // level up was the whole of the bug. `"private"` is still accepted as
  // input, forever, and is normalised to `guest`; nothing writes it back out.
  test("a guest journal is not advertised, but is still there", () => {
    make("quiet", { visibility: "guest" });

    expect(getUser("quiet")?.visibility).toBe("guest");
    // Off every list…
    expect(listedUsernames()).not.toContain("quiet");
    expect(instanceDocumentation()).not.toContain("/quiet/");
    // …and still resolvable for anybody sent the address.
    expect(getUsernames()).toContain("quiet");
    expect(userExists("quiet")).toBe(true);
    expect(getUser("quiet")?.title).toBe("A journal");
  });

  test("the old word `private` still works as input, and is written as `guest`", () => {
    make("hush", { visibility: "private" });

    expect(getUser("hush")?.visibility).toBe("guest");
    expect(listedUsernames()).not.toContain("hush");
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "hush", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(written.visibility).toBe("guest");
  });

  test("`public` is not written into the file — only the interesting half is", () => {
    make("open");
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "open", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(written.visibility).toBeUndefined();

    make("quiet", { visibility: "guest" });
    const hidden = JSON.parse(
      fs.readFileSync(path.join(dir, "quiet", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(hidden.visibility).toBe("guest");
  });

  test("a journal written before the field existed reads as public", () => {
    fs.mkdirSync(path.join(dir, "legacy", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "legacy", "config.json"),
      JSON.stringify({ title: "Old", owner: { name: "O", nickname: "O", email: OWNER } }),
    );
    expect(getUser("legacy")?.visibility).toBe("public");
    expect(listedUsernames()).toContain("legacy");
  });

  // The two tests B306 exists to protect: every journal on disk today says
  // `public`, `private`, or nothing, and all three must keep reading exactly
  // as they did before the rename.
  test("a config.json already saying `private` is still unlisted after the rename", () => {
    fs.mkdirSync(path.join(dir, "vintage", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "vintage", "config.json"),
      JSON.stringify({
        title: "Old and quiet",
        owner: { name: "O", nickname: "O", email: OWNER },
        visibility: "private",
      }),
    );
    expect(getUser("vintage")?.visibility).toBe("guest");
    expect(listedUsernames()).not.toContain("vintage");
    expect(instanceDocumentation()).not.toContain("/vintage/");
    // Still resolvable for anybody sent the address — unlisted, not gone.
    expect(getUsernames()).toContain("vintage");
    expect(userExists("vintage")).toBe(true);
  });

  test("an absent visibility is still public after the rename", () => {
    fs.mkdirSync(path.join(dir, "untouched", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "untouched", "config.json"),
      JSON.stringify({ title: "Untouched", owner: { name: "O", nickname: "O", email: OWNER } }),
    );
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "untouched", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(written.visibility).toBeUndefined();
    expect(getUser("untouched")?.visibility).toBe("public");
    expect(listedUsernames()).toContain("untouched");
  });

  test("a guest journal's trips default to guest too, not the old private", () => {
    make("quiet", { visibility: "guest" });
    createTrip("quiet", { id: "trip", title: "T", ...DATES });
    expect(getTrip("quiet/trip")?.visibility).toBe("guest");
  });

  test("a public journal's trips default to public too", () => {
    make("open");
    createTrip("open", { id: "trip", title: "T", ...DATES });
    expect(getTrip("open/trip")?.visibility).toBe("public");
  });

  test("an explicit visibility on the create call still wins over the journal's default", () => {
    make("open");
    createTrip("open", { id: "held-back", title: "T", ...DATES, visibility: "private" });
    expect(getTrip("open/held-back")?.visibility).toBe("private");
  });

  test("a misspelled trip visibility falls back to private, never to the journal's default", () => {
    make("open");
    createTrip("open", { id: "typo", title: "T", ...DATES, visibility: "publik" as never });
    expect(getTrip("open/typo")?.visibility).toBe("private");
  });
});

describe("the welcome mail", () => {
  test("is not attempted when the server cannot send mail", async () => {
    make("wanderer");
    // The fixture config enables signup and auth, and nothing else.
    await expect(
      sendWelcome({
        username: "wanderer",
        title: "A journal",
        email: OWNER,
        nickname: "Robin",
        visibility: "public",
      }),
    ).resolves.toBe(false);
  });

  test("carries the journal's address, and says which drafts rule applies", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { mail: { enabled: true, transport: "file" } },
      }),
    );
    clearConfigCache();
    make("wanderer");

    const sent = await sendWelcome({
      username: "wanderer",
      title: "A journal",
      email: OWNER,
      nickname: "Robin",
      visibility: "guest",
    });
    expect(sent).toBe(true);

    const files = fs.readdirSync(path.join(dir, "wanderer", "mail"));
    expect(files).toHaveLength(1);
    const raw = fs.readFileSync(path.join(dir, "wanderer", "mail", files[0]), "utf8");
    const body = mailBodyOf("wanderer");

    expect(raw).toContain(OWNER);
    expect(body).toContain("https://t.test/wanderer");
    expect(body).toContain("draft");
    // The guest wording, not the public one.
    expect(body).toContain("appears on no list");
  });

  /**
   * B26. This letter is the first thing the software says to somebody, and it
   * said it in English to a German journal — the one piece of the product they
   * did not get to choose the language of.
   */
  test("is written in the journal's language, footer included", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { mail: { enabled: true, transport: "file" } },
      }),
    );
    // The dictionaries live beside the journals, under content/locales.
    fs.symlinkSync(
      path.join(process.cwd(), "content", "locales"),
      path.join(dir, "locales"),
    );
    clearConfigCache();
    make("reisender", { defaultLocale: "de", locales: ["de"] });

    await sendWelcome({
      username: "reisender",
      title: "Meine Reise",
      email: OWNER,
      nickname: "Robin",
      visibility: "public",
      locale: getUser("reisender")?.defaultLocale,
    });

    const body = mailBodyOf("reisender");
    expect(body).toContain("Dein Reisetagebuch ist bereit");
    // The footer follows the body. An English "Sent by …" under a German
    // letter is the seam that sends somebody to the spam button.
    expect(body).toContain("Gesendet von T");
    expect(body).not.toContain("Sent by");
  });

  /**
   * B27. The button used to point at the bare journal URL, which makes the
   * owner an anonymous reader of their own site — private trips gated, drafts
   * filtered out — in a letter that says "you can see what is waiting at any
   * time". It arrives precisely when there is nothing to see without a session.
   */
  test("the button is a sign-in link, and the plain address is in the text", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: {
          mail: { enabled: true, transport: "file" },
          auth: { enabled: true },
        },
      }),
    );
    fs.symlinkSync(path.join(process.cwd(), "content", "locales"), path.join(dir, "locales"));
    process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
    process.env.SESSION_SECRET = "b27-test-secret-b27-test-secret";
    clearConfigCache();
    const { migrateToLatest } = await import("@/lib/db/migrate");
    await migrateToLatest(await getDatabase());

    make("wanderer");
    expect(
      await sendWelcome({
        username: "wanderer",
        title: "A journal",
        email: OWNER,
        nickname: "Robin",
        visibility: "public",
      }),
    ).toBe(true);

    const body = mailBodyOf("wanderer");
    const link = /https:\/\/t\.test\/wanderer\/s\/([A-Za-z0-9_-]+)/.exec(body);
    expect(link, "the mail should carry a /s/<token> sign-in link").not.toBeNull();

    // It redeems to a session…
    const result = await verifyLink("wanderer", link![1]);
    expect(result.ok).toBe(true);

    // …and the bare address is still in the letter, because a spent link must
    // not take the only copy of the journal's URL with it. Checked with the
    // sign-in URL removed, so the plain address cannot be satisfied by the
    // link's own prefix.
    const withoutLink = body.replaceAll(link![0], "");
    expect(withoutLink).toContain("https://t.test/wanderer");

    // And the letter says what the button does, so nobody forwards it
    // believing they are only sharing an address.
    expect(body).toMatch(/signs you in/i);

    await closeDatabase();
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
  });

  test("falls back to English when the journal names no language", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { mail: { enabled: true, transport: "file" } },
      }),
    );
    fs.symlinkSync(
      path.join(process.cwd(), "content", "locales"),
      path.join(dir, "locales"),
    );
    clearConfigCache();
    make("wanderer");

    await sendWelcome({
      username: "wanderer",
      title: "A journal",
      email: OWNER,
      nickname: "Robin",
      visibility: "public",
      locale: getUser("wanderer")?.defaultLocale,
    });

    expect(mailBodyOf("wanderer")).toContain("Your journal is ready");
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

  // B306: the default used to be a flat "private" regardless of the journal.
  // It now follows the journal's own answer instead — "wanderer" here is a
  // public journal (created by `make()` with no visibility override), so an
  // omitted field is created public too, never wider than the journal
  // already is. See the "journal visibility" describe block above for the
  // guest-journal half of this, and the typo-safety test just below for what
  // still falls back to `private`.
  test("inherits the journal's own visibility unless the caller says otherwise", () => {
    createTrip("wanderer", { id: "quiet", title: "Quiet", ...DATES });
    expect(getTrip("wanderer/quiet")?.visibility).toBe("public");
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

  /**
   * `listed:` — the key this endpoint has always accepted and written, and
   * that the reader ignored until B51. Three properties, and the middle one is
   * the whole reason the round trip is worth a test: what is written is what
   * comes back.
   */
  describe("listed", () => {
    test("an unadvertised public trip round-trips", () => {
      const result = createTrip("wanderer", {
        ...DATES, id: "quiet-one", title: "Q", visibility: "public", listed: false,
      });
      expect(result.ok).toBe(true);
      const trip = getTrip("wanderer/quiet-one")!;
      expect(trip.visibility).toBe("public");
      expect(trip.listed).toBe(false);
    });

    /**
     * Refused rather than written. The reader would refuse it anyway, and a
     * `201` over a file whose `listed:` says the opposite of what the site
     * does is exactly the disagreement this closes.
     */
    test("refuses listed: true on a trip no visibility advertises", () => {
      const result = createTrip("wanderer", {
        ...DATES, id: "loud-secret", title: "L", visibility: "private", listed: true,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("invalid_listed");
        expect(result.message).toContain("public");
      }
      // And nothing was written: a refusal leaves no half-made trip behind.
      expect(getTrip("wanderer/loud-secret")).toBeUndefined();
    });

    test("says nothing about listing when the caller did not", () => {
      createTrip("wanderer", { ...DATES, id: "plain", title: "P", visibility: "public" });
      const file = fs.readFileSync(
        path.join(dir, "wanderer", "trips", "plain", "trip.md"), "utf8",
      );
      expect(file).not.toContain("listed:");
      // Derived, and the same answer the key would have given.
      expect(getTrip("wanderer/plain")?.listed).toBe(true);
    });
  });

  /**
   * B178 — the field that was read, typed, gated and documented, and that
   * nothing could write. Every trip on every instance had public costs, so
   * `maySeeCosts`'s guests-only branch had no data to act on and an owner who
   * works through an agent — which is the only way this product is written —
   * could not reach a feature the site says it has.
   */
  describe("costsVisibility", () => {
    test("guests-only money round-trips", () => {
      const result = createTrip("wanderer", {
        ...DATES, id: "quiet-money", title: "Q", visibility: "public", costsVisibility: "guests",
      });
      expect(result.ok).toBe(true);
      expect(getTrip("wanderer/quiet-money")?.costsVisibility).toBe("guests");
    });

    test("says nothing about costs when the caller did not, and that reads as public", () => {
      createTrip("wanderer", { ...DATES, id: "open-money", title: "O" });
      const file = fs.readFileSync(
        path.join(dir, "wanderer", "trips", "open-money", "trip.md"), "utf8",
      );
      expect(file).not.toContain("costsVisibility:");
      expect(getTrip("wanderer/open-money")?.costsVisibility).toBe("public");
    });

    test("an explicit public is the same file as none", () => {
      createTrip("wanderer", { ...DATES, id: "said-public", title: "S", costsVisibility: "public" });
      expect(getTrip("wanderer/said-public")?.costsVisibility).toBe("public");
    });

    /**
     * Refused, not defaulted — the one field here where a typo does not fall
     * back. Defaulting to `public` would widen what the caller asked for and
     * disagree with `parseCostsVisibility`, which reads an unknown value as
     * `guests`; defaulting to `guests` would hide the money of everybody who
     * typed "publik". Neither is a thing to decide silently.
     */
    test("refuses a value it does not read, and writes nothing", () => {
      const result = createTrip("wanderer", {
        ...DATES, id: "typo-money", title: "T", costsVisibility: "everyone" as never,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_costs_visibility");
      expect(getTrip("wanderer/typo-money")).toBeUndefined();
    });
  });

  /**
   * B204 — a title that closes the frontmatter block from inside the value.
   *
   * `q()` escaped `"` and `\\` and not a newline, so `"a\n---\nb"` wrote a
   * `trip.md` whose frontmatter ended two lines early. The read-back guard
   * noticed, refused, and left the folder on disk: the trip was invisible at
   * every reading path, and every delete path resolves the trip first, so the
   * id was consumed for good.
   *
   * Both halves are asserted, because either alone leaves the bug: the
   * refusal, and that the trips directory is exactly as it was.
   */
  describe("a value that would break out of the frontmatter", () => {
    const BREAKOUT = `a\n---\nnot: [yaml`;

    function tripFolders(): string[] {
      const trips = path.join(dir, "wanderer", "trips");
      return fs.existsSync(trips) ? fs.readdirSync(trips).sort() : [];
    }

    test("a multi-line title is refused, naming the field, and writes nothing", () => {
      const before = tripFolders();
      const result = createTrip("wanderer", { ...DATES, id: "b204", title: BREAKOUT });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("invalid_title");
        expect(result.message).toContain("title");
      }
      expect(tripFolders()).toEqual(before);
      expect(getTrip("wanderer/b204")).toBeUndefined();
    });

    test("a multi-line tagline is refused the same way", () => {
      const result = createTrip("wanderer", {
        ...DATES, id: "b204-tagline", title: "T", tagline: BREAKOUT,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_tagline");
      expect(tripFolders()).not.toContain("b204-tagline");
    });

    /**
     * The id has to still be free afterwards. A retry answering `409
     * trip_exists` for a trip nothing can read or delete is the whole of what
     * B204 cost.
     */
    test("the id is usable immediately after a refusal", () => {
      createTrip("wanderer", { ...DATES, id: "reused", title: BREAKOUT });
      const again = createTrip("wanderer", { ...DATES, id: "reused", title: "Second try" });
      expect(again.ok).toBe(true);
      expect(getTrip("wanderer/reused")?.title).toBe("Second try");
    });

    /**
     * Belt and braces, and the half that protects the next caller: even with
     * the validation removed, the quoter cannot emit a file that fails to
     * parse. Asserted through the one field a caller can put anything in and
     * that is not checked for line breaks.
     */
    test("the quoter itself cannot produce unreadable frontmatter", async () => {
      const { quoteScalar } = await import("@/lib/validate/frontmatter");
      const matter = (await import("gray-matter")).default;
      const file = ["---", `title: ${quoteScalar(BREAKOUT)}`, "---", "", "prose", ""].join("\n");
      expect(matter(file).data.title).toBe(BREAKOUT);
    });
  });

  /**
   * A folder left behind by a failed read-back is the part that could not be
   * cleaned up from anywhere in the product. Forced here by making the trip
   * unreadable in the one way validation cannot catch — `getTrip` is mocked to
   * refuse — so the rollback is exercised rather than argued about.
   */
  test("a create that fails its read-back leaves no folder behind", async () => {
    const trips = await import("@/lib/trips");
    const real = trips.getTrip;
    const spy = vi.spyOn(trips, "getTrip").mockImplementation((ref: string) =>
      ref === "wanderer/vanishes" ? undefined : real(ref),
    );
    try {
      const result = createTrip("wanderer", { ...DATES, id: "vanishes", title: "V" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("trip_unreadable");
        expect(result.message).toContain("still free");
      }
      expect(fs.existsSync(path.join(dir, "wanderer", "trips", "vanishes"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * The bug that made `POST /api/v1/journals` answer 201 with a URL that
 * answered 404.
 *
 * `getUsernames()` and the config loaders used to cache until somebody called
 * an invalidator, and `createJournal` called it. That is enough in a single
 * module instance and not enough in a production build, where Next hands the
 * page layer and the route-handler layer separate copies of the module: the
 * API route cleared its own cache and the pages went on answering "no such
 * journal" until the process restarted.
 *
 * So these tests never call the invalidators. Warming the cache and then
 * writing to the directory is exactly the sequence that broke, and the fix is
 * that the next read notices on its own.
 */
describe("a journal appears without anybody invalidating a cache", () => {
  test("a journal created after the user list was read is in it", () => {
    expect(getUsernames()).toEqual([]);

    // Deliberately no clearUserCache() — the point is that nothing has to.
    const result = createJournal({
      username: "latecomer",
      title: "Late",
      ownerEmail: OWNER,
      ownerName: "Late Person",
      ownerNickname: "Late",
    });
    expect(result.ok).toBe(true);

    expect(getUsernames()).toContain("latecomer");
    expect(userExists("latecomer")).toBe(true);
    expect(getUser("latecomer")?.title).toBe("Late");
  });

  /**
   * The one that actually fails without the fix. A test can only ever hold one
   * copy of the module, so `createJournal`'s own invalidation makes the case
   * above pass either way — the defect only shows when the write happens
   * somewhere the invalidator does not reach, which in production is the other
   * module instance and here is a directory appearing on its own.
   */
  test("a journal folder written by hand is picked up too", () => {
    getUsernames();

    fs.mkdirSync(path.join(dir, "byhand", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "byhand", "config.json"),
      JSON.stringify({
        title: "By hand",
        owner: { name: "Hand", nickname: "H", email: OWNER },
      }),
    );

    expect(getUsernames()).toContain("byhand");
  });

  test("an edited config.json is re-read without a restart", () => {
    make("editable");
    expect(getUser("editable")?.title).toBe("A journal");

    const file = path.join(dir, "editable", "config.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    config.title = "Renamed by its owner";
    // Written a millisecond later than it was made, so the signature differs
    // even where the clock is coarse.
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    const later = new Date(Date.now() + 1000);
    fs.utimesSync(file, later, later);

    expect(getUser("editable")?.title).toBe("Renamed by its owner");
  });

  test("a journal removed from disk stops being listed", () => {
    make("temporary");
    expect(getUsernames()).toContain("temporary");

    fs.rmSync(path.join(dir, "temporary"), { recursive: true, force: true });
    expect(getUsernames()).not.toContain("temporary");
  });
});

/**
 * B207 — the four fields `KNOWN_TRIP_FIELDS` reads and nothing could write.
 *
 * B178 asked for a sweep of the rest of the parsed frontmatter once
 * `costsVisibility` was closed. There were four, and the ticket asked for them
 * to be decided one at a time rather than added in a batch. Three are written
 * here; `cover` is refused, and the reason is in `NewTrip` (lib/tripWrite.ts)
 * and asserted at the bottom of this block.
 *
 * The rule these share: **refused, never dropped.** `lib/trips.ts` fails
 * closed when it reads a bad `people:` — one malformed entry drops the whole
 * list — because a reader has nobody to tell. A writer does, so a 201 for a
 * block the site will then ignore is the outcome none of these may produce.
 */
describe("the trip fields that had no writer", () => {
  beforeEach(() => {
    make("wanderer");
  });

  describe("people — who took it, and therefore who may write to it", () => {
    test("is written, reads back, and carries the nickname when there is one", () => {
      const result = createTrip("wanderer", {
        ...DATES,
        id: "japan-2027",
        title: "Japan",
        people: [
          { name: "Robin Traveller", email: "Robin@Example.test", nickname: "Robin" },
          { name: "Ana Meyer", email: "ana@example.test" },
        ],
      });
      expect(result.ok).toBe(true);

      const trip = getTrip("wanderer/japan-2027");
      expect(trip?.people).toEqual([
        // Lower-cased on the way in, because that is what an address is
        // compared as when somebody asks for a token.
        { name: "Robin Traveller", email: "robin@example.test", nickname: "Robin" },
        { name: "Ana Meyer", email: "ana@example.test" },
      ]);
    });

    test("an entry without a usable address is refused, and the trip is not created", () => {
      // The half-written case is the dangerous one: `parsePeople` would drop
      // the whole list and the caller would be told 201 for a trip crediting
      // nobody.
      const result = createTrip("wanderer", {
        ...DATES,
        id: "nameless",
        title: "T",
        people: [{ name: "Ana", email: "ana at example" }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_people");
      expect(getTrip("wanderer/nameless")).toBeUndefined();
      expect(fs.existsSync(path.join(dir, "wanderer", "trips", "nameless"))).toBe(false);
    });

    test("more than ten is refused — everyone on the list may write to the trip", () => {
      const result = createTrip("wanderer", {
        ...DATES,
        id: "coach-party",
        title: "T",
        people: Array.from({ length: 11 }, (_, i) => ({
          name: `P${i}`,
          email: `p${i}@example.test`,
        })),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_people");
    });

    test("the same address twice is refused rather than written and dropped", () => {
      const result = createTrip("wanderer", {
        ...DATES,
        id: "twice",
        title: "T",
        people: [
          { name: "Ana", email: "ana@example.test" },
          { name: "Ana again", email: "ANA@example.test" },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_people");
    });

    test("a name that would close the frontmatter block is refused, like a title", () => {
      // B204, one field over: `quoteScalar` would now escape it, and the
      // caller still hears about a name it did not intend to send.
      const result = createTrip("wanderer", {
        ...DATES,
        id: "b204-people",
        title: "T",
        people: [{ name: "Ana\n---\nnot: [yaml", email: "ana@example.test" }],
      });
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(dir, "wanderer", "trips", "b204-people"))).toBe(false);
    });

    test("an empty list writes no key at all", () => {
      createTrip("wanderer", { ...DATES, id: "solo", title: "Solo", people: [] });
      const file = fs.readFileSync(
        path.join(dir, "wanderer", "trips", "solo", "trip.md"),
        "utf8",
      );
      expect(file).not.toContain("people:");
      expect(getTrip("wanderer/solo")?.people).toEqual([]);
    });
  });

  describe("rates — this trip's frozen local-to-base table", () => {
    test("is written and reads back as numbers, including a small one", () => {
      const result = createTrip("wanderer", {
        ...DATES,
        id: "vietnam",
        title: "Vietnam",
        // 1 THB = 0.0245 CHF. The direction that is easy to get backwards.
        rates: { THB: 0.0245, VND: 0.000034 },
      });
      expect(result.ok).toBe(true);
      expect(getTrip("wanderer/vietnam")?.rates).toEqual({ THB: 0.0245, VND: 0.000034 });
    });

    test("a rate that is not a positive number is refused, naming the currency", () => {
      const result = createTrip("wanderer", {
        ...DATES,
        id: "bad-rate",
        title: "T",
        rates: { THB: "about forty" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("invalid_rates");
        expect(result.message).toContain("THB");
      }
      expect(getTrip("wanderer/bad-rate")).toBeUndefined();
    });

    test("something that is not a currency code is refused rather than silently dropped", () => {
      // `parseRateTable` drops it with a warning when it reads one. Written
      // here, the caller would never learn the currency it asked for is
      // missing — and an unconvertible cost is a supported state, so nothing
      // downstream would look wrong either.
      const result = createTrip("wanderer", {
        ...DATES,
        id: "not-a-code",
        title: "T",
        rates: { baht: 0.0245 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_rates");
    });

    test("a rate only expressible in exponent form is refused, not written as text", () => {
      // `String(1e-7)` is "1e-7", which YAML reads back as a string; the file
      // would parse and the rate would then be dropped by the reader.
      const result = createTrip("wanderer", {
        ...DATES,
        id: "tiny",
        title: "T",
        rates: { XXX: 1e-7 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_rates");
    });
  });

  describe("translations — the trip's title in the journal's other languages", () => {
    test("is written for a language the journal speaks, and reads back", () => {
      make("reisender", { defaultLocale: "de", locales: ["de", "en"] });
      const result = createTrip("reisender", {
        ...DATES,
        id: "japan-2027",
        title: "Japan",
        translations: { en: { title: "Japan", tagline: "Six weeks by train" } },
      });
      expect(result.ok).toBe(true);
      expect(getTrip("reisender/japan-2027")?.translations).toEqual({
        en: { title: "Japan", tagline: "Six weeks by train" },
      });
    });

    test("a language the journal does not speak is refused, and says where to add it", () => {
      // Written, it would land, read back, and never be rendered — the inert
      // write B182 refused to ship. Since B220 the journal's `locales` are
      // reachable, so the refusal names the call rather than ending there.
      const result = createTrip("wanderer", {
        ...DATES,
        id: "german",
        title: "T",
        translations: { de: { title: "Japan" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("invalid_translations");
        expect(result.message).toContain("locales");
      }
      expect(getTrip("wanderer/german")).toBeUndefined();
    });

    test("a language name rather than a language code is refused", () => {
      const result = createTrip("wanderer", {
        ...DATES,
        id: "named",
        title: "T",
        translations: { german: { title: "Japan" } },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_translations");
    });

    test("a locale entry saying nothing is refused, because the reader drops it", () => {
      make("reisender", { defaultLocale: "de", locales: ["de", "en"] });
      const result = createTrip("reisender", {
        ...DATES,
        id: "empty",
        title: "T",
        translations: { en: {} },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("invalid_translations");
    });
  });

  /**
   * `cover` — the one of the four that answers no.
   *
   * At the moment `createTrip` runs the folder is being made: there is no
   * `media/`, and `POST /api/v1/<user>/trips/<trip>/media` refuses a batch
   * that does not name a day, so no photograph can arrive until a day has.
   * Anything a caller could send would name a file that is not there. It stays
   * file-only, `.claude/skills/add-a-trip/SKILL.md` says how to write it by
   * hand, and B245 is the call it actually belongs on.
   */
  test("cover is not accepted, and a body carrying one writes no cover", () => {
    const result = createTrip("wanderer", {
      ...DATES,
      id: "covered",
      title: "T",
      ...({ cover: "/media/covered/hero.jpg" } as Record<string, unknown>),
    });
    expect(result.ok).toBe(true);
    const file = fs.readFileSync(path.join(dir, "wanderer", "trips", "covered", "trip.md"), "utf8");
    expect(file).not.toContain("cover:");
    expect(getTrip("wanderer/covered")?.cover).toBeUndefined();
  });

  test("every field the reader knows is now either written or decided", () => {
    /**
     * The acceptance line of B207, as a test rather than as a claim: nothing
     * in `KNOWN_TRIP_FIELDS` is left undecided. Written by `createTrip`, or
     * named here with the reason it is not.
     */
    const written = [
      "id",
      "title",
      "tagline",
      "start",
      "end",
      "status",
      "accent",
      "visibility",
      "listed",
      "costsVisibility",
      "test",
      "people",
      "rates",
      "translations",
    ];
    const decidedAgainst = { cover: "no media exists when a trip is created — B245" };

    const trip = createTrip("wanderer", {
      ...DATES,
      id: "everything",
      title: "Everything",
      tagline: "one line",
      status: "upcoming",
      accent: "coral",
      visibility: "public",
      listed: false,
      costsVisibility: "guests",
      test: true,
      people: [{ name: "Ana", email: "ana@example.test" }],
      rates: { THB: 0.0245 },
      translations: { en: { title: "Everything" } },
    });
    expect(trip.ok).toBe(true);

    const file = fs.readFileSync(
      path.join(dir, "wanderer", "trips", "everything", "trip.md"),
      "utf8",
    );
    for (const field of written) {
      expect(file, `${field} should be written by createTrip`).toContain(`${field}:`);
    }
    for (const field of Object.keys(decidedAgainst)) {
      expect(file, `${field} is decided against`).not.toContain(`${field}:`);
    }
    expect([...written, ...Object.keys(decidedAgainst)].sort()).toEqual(
      [...KNOWN_TRIP_FIELDS].sort(),
    );
  });
});
