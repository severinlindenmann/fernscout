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
   * default for `contacts` is off, and **no endpoint, MCP tool or page
   * anywhere writes a user's `features` block** — so the only way to switch it
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

  test("a private journal is not advertised, but is still there", () => {
    make("quiet", { visibility: "private" });

    expect(getUser("quiet")?.visibility).toBe("private");
    // Off every list…
    expect(listedUsernames()).not.toContain("quiet");
    expect(instanceDocumentation()).not.toContain("/quiet/");
    // …and still resolvable for anybody sent the address.
    expect(getUsernames()).toContain("quiet");
    expect(userExists("quiet")).toBe(true);
    expect(getUser("quiet")?.title).toBe("A journal");
  });

  test("`public` is not written into the file — only the interesting half is", () => {
    make("open");
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "open", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(written.visibility).toBeUndefined();

    make("quiet", { visibility: "private" });
    const hidden = JSON.parse(
      fs.readFileSync(path.join(dir, "quiet", "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(hidden.visibility).toBe("private");
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

  test("a private journal's trips are still private by default", () => {
    make("quiet", { visibility: "private" });
    createTrip("quiet", { id: "trip", title: "T", ...DATES });
    expect(getTrip("quiet/trip")?.visibility).toBe("private");
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
      visibility: "private",
    });
    expect(sent).toBe(true);

    const files = fs.readdirSync(path.join(dir, "wanderer", "mail"));
    expect(files).toHaveLength(1);
    const raw = fs.readFileSync(path.join(dir, "wanderer", "mail", files[0]), "utf8");
    const body = mailBodyOf("wanderer");

    expect(raw).toContain(OWNER);
    expect(body).toContain("https://t.test/wanderer");
    expect(body).toContain("draft");
    // The private wording, not the public one.
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
