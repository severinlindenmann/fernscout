import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache, parseServerConfig, parseUserConfig } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { sendMail, sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { TRANSACTIONAL_MAIL_NOTE } from "@/lib/mail/types";
import { sendWelcome } from "@/lib/journals";
import { sendCodeMail } from "@/lib/contacts/mail";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { requestDeletion } from "@/lib/deletions";
import { POST as authRequest } from "@/app/api/auth/request/route";
import { GET as health } from "@/app/api/health/route";

/**
 * B60 — what a journal's own `features.mail.enabled: false` actually stops.
 *
 * The bug was that it stopped nothing. Every call site asked
 * `isEnabled("mail")` without naming the journal, so a per-journal switch
 * narrowed what `/api/health` *reported* and left the feature running: a
 * journal that had said "do not write to my readers" still had sign-in codes,
 * day letters and welcome letters sent on its behalf, and with `keepCopy` on it
 * accumulated `.eml` copies of all of it.
 *
 * The fix is not "suppress everything", because two kinds of letter are not
 * the journal writing to its readers at all, and swallowing them takes control
 * away from the owner rather than giving it to them. So there is a class per
 * describe block below, and each one says which side of the line it is on and
 * why. The third exempt class — operator alerts — is asserted in
 * `test/alert-script.test.ts`, where the script is run for real.
 *
 * Both states of the switch are exercised: `QUIET` has mail off, `LOUD` has it
 * on, and the same call is made against each.
 */

const QUIET = "quiet";
const LOUD = "loud";
/** A journal whose config has no `features` key at all — the common case. */
const SILENT = "silent";
const OWNER = "owner@example.test";
const SITE = "https://example.test";

let dir: string;

function serverConfig(extra: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: SITE },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        signup: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file", ...extra },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

/**
 * A journal on disk. `mail` is the state under test: stated true, stated
 * false, or — the case B60 nearly broke for everybody — never mentioned.
 */
function writeJournal(username: string, mail: boolean | "unstated") {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        ...(mail === "unstated" ? {} : { mail: { enabled: mail } }),
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

/** No `features` key whatsoever — what `scripts/migrate-users.ts` produced. */
function writeBareJournal(username: string) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
}

/** Every `.eml` filed under one journal. The evidence, in both directions. */
/**
 * One trip with one published day, for the journal named — the least a
 * `sendDayLetter` call needs to reach the mail gate this file is about.
 *
 * It has to be real content on disk: the letter answers `unknown_trip` and
 * `not_published` *before* it looks at any switch, so a fixture without these
 * would pass the assertions below for entirely the wrong reason. B387.
 */
function publishADay(username: string): void {
  const root = path.join(dir, username, "trips", "trip");
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "trip.md"),
    [
      "---",
      'id: "trip"',
      'title: "A trip"',
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "public"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "entries", "2026-09-02-a-day.md"),
    ["---", 'title: "A day"', 'date: "2026-09-02"', "---", "", "It happened.", ""].join("\n"),
  );
  clearUserCache();
}

function mailFor(username: string): string[] {
  const folder = path.join(dir, username, "mail");
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter((f) => f.endsWith(".eml"));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mailswitch-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-the-mail-switch";
  process.env.CONTACTS_ENCRYPTION_KEY = "0".repeat(64);
  serverConfig();
  writeJournal(QUIET, false);
  writeJournal(LOUD, true);
  writeBareJournal(SILENT);
  await migrateToLatest(await getDatabase());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("letters the journal writes to its readers — governed by its own switch", () => {
  test("the welcome letter is not sent, and is sent for a journal that asked", async () => {
    await expect(
      sendWelcome({
        username: QUIET,
        title: "A journal",
        email: OWNER,
        nickname: "Robin",
        visibility: "public",
      }),
    ).resolves.toBe(false);
    expect(mailFor(QUIET)).toEqual([]);

    await expect(
      sendWelcome({
        username: LOUD,
        title: "A journal",
        email: OWNER,
        nickname: "Robin",
        visibility: "public",
      }),
    ).resolves.toBe(true);
    expect(mailFor(LOUD)).toHaveLength(1);
  });

  test("a contact letter is not sent, and is sent for a journal that asked", async () => {
    await expect(
      sendCodeMail(QUIET, getUser(QUIET)!, "reader@example.test", "en", "123456"),
    ).resolves.toBeNull();
    expect(mailFor(QUIET)).toEqual([]);

    await expect(
      sendCodeMail(LOUD, getUser(LOUD)!, "reader@example.test", "en", "123456"),
    ).resolves.not.toBeNull();
    expect(mailFor(LOUD)).toHaveLength(1);
  });

  /*
   * These two were the weekly digest's until B387 deleted it. The property is
   * the digest's only by accident — it is "a journal that switched mail off
   * gets no reader letters" — so they are asserted against `sendDayLetter`,
   * which is the reader-facing letter that remains. Deleting them with the
   * digest would have quietly dropped the coverage B60 exists for.
   */
  test("a day letter refuses, and says which switch stopped it", async () => {
    // Loud server, quiet journal: this is the journal's own answer and not the
    // server's — two separate reasons, because the fix is a different file in
    // each case.
    publishADay(QUIET);
    const outcome = await sendDayLetter(QUIET, `${QUIET}/trip`, "a-day");
    expect(outcome).toMatchObject({ ok: false, reason: "mail_off" });
    expect(mailFor(QUIET)).toEqual([]);
  });

  test("the same call on a journal that has not switched mail off gets past that gate", async () => {
    publishADay(LOUD);
    const outcome = await sendDayLetter(LOUD, `${LOUD}/trip`, "a-day");
    // Not `mail_off`. It stops at `contacts_off` or sends, depending on the
    // fixture — either way the mail switch let it through, which is the whole
    // assertion.
    if (!outcome.ok) expect(outcome.reason).not.toBe("mail_off");
  });
});

describe("letters about access to the journal — not governed by its switch", () => {
  /**
   * A one-time code is the door, not a letter to a reader. Suppressing it
   * would make the setting unrecoverable: there would be nothing left to sign
   * in with and switch mail back on.
   */
  test("a sign-in code is sent to a journal that has mail off", async () => {
    const response = await authRequest(
      new Request(`${SITE}/api/auth/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: QUIET, email: OWNER, kind: "agent" }),
      }),
    );

    expect(response.status).toBe(202);
    const files = mailFor(QUIET);
    expect(files, "the code has to reach somebody").toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, QUIET, "mail", files[0]), "utf8")).toContain(OWNER);
  });

  /**
   * The deletion link *is* the safety mechanism (B38): `DELETE` removes
   * nothing and answers 202, and only the button in this mail deletes. A
   * per-journal preference swallowing it would leave the API accepting
   * deletions that can never happen.
   */
  test("a deletion confirmation is sent to a journal that has mail off", async () => {
    const result = await requestDeletion({ kind: "journal", username: QUIET });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const files = mailFor(QUIET);
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, QUIET, "mail", files[0]), "utf8")).toContain(OWNER);
  });

  test("the exemption is a written reason, not a missing argument", async () => {
    const result = await sendTransactional(
      renderMail("r@example.test", "S", SAMPLE, QUIET),
      "a one-time sign-in code the recipient just asked for",
    );
    expect(result).not.toBeNull();
    // Logged, so an operator who switched mail off and then saw a code arrive
    // can find out why from the journal rather than from the source.
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("has mail switched off; sending anyway"),
    );
  });

  test("the server switch still stops everything, exempt or not", async () => {
    serverConfig({ enabled: false });
    await expect(
      sendTransactional(renderMail("r@example.test", "S", SAMPLE, QUIET), "a sign-in code"),
    ).resolves.toBeNull();
    expect(mailFor(QUIET)).toEqual([]);
  });
});

/**
 * B160 — the other side of the line above.
 *
 * `sendTransactional` returning null when the *server* cannot send is correct:
 * a caller announcing a new day must not fail because nobody configured mail.
 * But `POST /api/auth/request` treated that null as success. It had already
 * called `issueCode`, which consumes every live code for the address before
 * writing a new one — so asking for a code on an instance with mail off killed
 * the code the person still had in their inbox, wrote one nobody would ever be
 * told, and answered `202 accepted`.
 *
 * The route now refuses before anything is issued. Refusing leaks nothing: the
 * answer is the same for every address, which is what the uniform 202 exists
 * to protect.
 */
describe("asking for a code on a server that cannot send mail", () => {
  /**
   * A fresh caller every time.
   *
   * The agent bucket in `lib/rateLimit.ts` is five requests per address per
   * quarter of an hour, and its map is module state that outlives a test file's
   * `beforeEach`. Without a distinct address per call these assertions would
   * pass or fail depending on how many earlier tests reached the limiter —
   * which is exactly what happened while this block was being written: the
   * fixed route short-circuits before the limit and the broken one does not, so
   * the count differed between the two runs being compared.
   */
  let caller = 0;
  function ask(user: string, email: string, kind: "agent" | "guest" = "agent") {
    caller++;
    return authRequest(
      new Request(`${SITE}/api/auth/request`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `203.0.113.${caller}`,
        },
        body: JSON.stringify({ user, email, kind }),
      }),
    );
  }

  /** Every code row for a journal, live or spent. */
  async function codeRows(user: string) {
    const { db } = await getDatabase();
    return db.selectFrom("login_codes").selectAll().where("owner_id", "=", user).execute();
  }

  test("is refused rather than accepted, and says why", async () => {
    serverConfig({ enabled: false });

    const response = await ask(LOUD, OWNER);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("mail_disabled");
    // A sentence somebody can act on, not a bare code — the same shape the
    // signup route has answered with all along.
    expect(body.message).toMatch(/cannot send mail/);
  });

  test("nothing is written to the database", async () => {
    serverConfig({ enabled: false });
    await ask(LOUD, OWNER);
    expect(await codeRows(LOUD)).toHaveLength(0);
  });

  /**
   * The expensive half of the bug. `issueCode` revokes before it inserts, so
   * the old behaviour did not merely fail to deliver — it took away the code
   * the person was in the middle of typing.
   */
  test("a code that was already live for that address still works afterwards", async () => {
    const { code } = await issueCode(LOUD, OWNER, "agent");
    serverConfig({ enabled: false });

    expect((await ask(LOUD, OWNER)).status).toBe(503);

    await expect(verifyCode(LOUD, OWNER, code, "agent")).resolves.toMatchObject({ ok: true });
  });

  test("with mail on it is the ordinary 202 again", async () => {
    const response = await ask(LOUD, OWNER);
    expect(response.status).toBe(202);
    expect(mailFor(LOUD)).toHaveLength(1);
  });

  /**
   * A journal that switched its own mail off is *not* this case: a sign-in
   * code is exempt from that switch (above), so the route must still issue
   * one. The refusal is about the server having no transport at all.
   */
  test("a journal's own switch does not refuse the request", async () => {
    expect((await ask(QUIET, OWNER)).status).toBe(202);
    expect(mailFor(QUIET)).toHaveLength(1);
  });
});

describe("mail that belongs to no journal", () => {
  /**
   * A signup code is addressed to somebody who does not own a name yet, so
   * there is no per-journal switch to consult and the server's is the whole
   * answer. That is a property of the message, not an oversight at the call
   * site — see `sendMail` in lib/mail.
   */
  test("a signup code answers to the server switch alone", async () => {
    const sent = await sendMail(renderMail("newcomer@example.test", "Your code", SAMPLE));
    expect(sent).not.toBeNull();
    expect(fs.readdirSync(path.join(dir, ".mail"))).toHaveLength(1);

    serverConfig({ enabled: false });
    await expect(
      sendMail(renderMail("newcomer@example.test", "Your code", SAMPLE)),
    ).resolves.toBeNull();
  });
});

describe("no .eml copy is written for mail a journal suppressed", () => {
  /**
   * B57 put `keepCopy` on a server that really sends, which is what made B60
   * visible: a journal with mail off was also accumulating plaintext copies of
   * sign-in links in a folder whose owner had asked for no mail at all. The
   * copy is written inside `deliver`, so declining the send is what keeps the
   * folder empty — asserted because "it cannot happen any more" is exactly the
   * kind of claim a later refactor breaks silently.
   */
  test("with keepCopy on and a transport that really 'sends'", async () => {
    serverConfig({ transport: "console", keepCopy: true });

    await expect(sendMail(renderMail("r@example.test", "S", SAMPLE, QUIET))).resolves.toBeNull();
    expect(mailFor(QUIET)).toEqual([]);

    // The same message for a journal that asked for mail does leave a copy,
    // so the empty folder above is the switch and not a broken fixture.
    await expect(
      sendMail(renderMail("r@example.test", "S", SAMPLE, LOUD)),
    ).resolves.not.toBeNull();
    expect(mailFor(LOUD)).toHaveLength(1);
  });
});

describe("a journal that has never mentioned mail has not switched it off", () => {
  /**
   * The half of B60 that nearly shipped as a worse bug than the one it fixed.
   *
   * A user's `features.mail` defaults to *absent*, and every journal on disk
   * is in that state: `scripts/migrate-users.ts` files `mail` under the server
   * config and never the user's, so the per-journal key exists only because
   * one parser runs over both files. Reading absence as "no" would have
   * silently stopped the welcome, the digest and every contact letter for
   * every existing journal — with no config change by any owner and nothing
   * announcing it.
   *
   * So absence means **no opinion** and inherits the server's answer. Only a
   * stated `false` is a no. `USER_DEFAULT_FEATURES` in lib/config.ts.
   */
  test("its welcome letter is sent", async () => {
    await expect(
      sendWelcome({
        username: SILENT,
        title: "A journal",
        email: OWNER,
        nickname: "Robin",
        visibility: "public",
      }),
    ).resolves.toBe(true);
    expect(mailFor(SILENT)).toHaveLength(1);
  });

  test("its contact letters are sent", async () => {
    await expect(
      sendCodeMail(SILENT, getUser(SILENT)!, "reader@example.test", "en", "123456"),
    ).resolves.not.toBeNull();
    expect(mailFor(SILENT)).toHaveLength(1);
  });

  test("its day letter is not refused over mail", async () => {
    // It is refused over `contacts`, which really is an opt-in and really is
    // absent here. Asserting the *other* reason is what proves the mail gate
    // let it through rather than that nothing was checked. (Was the digest's
    // until B387; the property is the letter's just as much.)
    publishADay(SILENT);
    const outcome = await sendDayLetter(SILENT, `${SILENT}/trip`, "a-day");
    expect(outcome).toMatchObject({ ok: false, reason: "contacts_off" });
  });

  test("a stated false is still a no, beside it", async () => {
    await expect(
      sendCodeMail(QUIET, getUser(QUIET)!, "reader@example.test", "en", "123456"),
    ).resolves.toBeNull();
    expect(mailFor(QUIET)).toEqual([]);
  });

  test("it still cannot send when the server cannot", async () => {
    // Absence inherits the server's answer, which cuts both ways — this is the
    // property that keeps a user config unable to widen anything.
    serverConfig({ enabled: false });
    await expect(
      sendMail(renderMail("r@example.test", "S", SAMPLE, SILENT)),
    ).resolves.toBeNull();
    expect(mailFor(SILENT)).toEqual([]);
  });

  /**
   * The fourth state, which is not a state at all: **cannot tell.**
   *
   * `getUser` returns null for an unreadable content root as readily as for a
   * name that was never a journal — `getUsernames` catches its own
   * `readdirSync` failure and returns an empty list — so gating on
   * `isEnabled("mail", username)` made an I/O fault suppress every journal's
   * letters without a word. It surfaced on main as B135's sweep test, whose
   * `readdirSync` mock is broader than the sweep it means to break; but strip
   * the mock away and it reads "when the config cannot be read, mail is
   * silently suppressed", which is the same failure mode as reading absence as
   * a no. An unreadable directory is not somebody saying no.
   *
   * Failing open costs at most one letter to a journal that had said no,
   * during an outage in which its config is unreadable. Failing closed costs
   * every journal's mail for as long as the fault lasts, silently.
   */
  test("an unreadable content root does not silently suppress a journal's mail", async () => {
    const readdir = vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES");
    });
    try {
      clearUserCache();
      // Not resolvable, therefore not a refusal.
      expect(getUser(SILENT)).toBeNull();
      await expect(
        sendMail(renderMail("r@example.test", "S", SAMPLE, SILENT)),
      ).resolves.not.toBeNull();
    } finally {
      readdir.mockRestore();
    }
  });

  test("the three states, at the parser", () => {
    const journal = (features?: Record<string, unknown>) =>
      parseUserConfig("j", {
        title: "T",
        owner: { name: "R", nickname: "R", email: OWNER },
        ...(features ? { features } : {}),
      }).features.mail.enabled;

    expect(journal(), "absent — no opinion, inherit the server").toBe(true);
    expect(journal({}), "an empty features block is still no opinion").toBe(true);
    expect(journal({ mail: { enabled: true } }), "stated yes").toBe(true);
    expect(journal({ mail: { enabled: false } }), "stated no — the only no").toBe(false);

    // The server's own default is untouched and must stay off: it is the one
    // holding the credentials, and AGENTS.md's "off by default" is about this
    // file. A journal saying yes above cannot reach past it.
    expect(
      parseServerConfig({ site: { name: "T", url: "https://t.test" } }).features.mail.enabled,
    ).toBe(false);
  });
});

describe("/api/health agrees with what actually happens", () => {
  /** An anonymous probe, which is what an uptime monitor is. B234. */
  const probe = () => new Request("https://example.test/api/health");

  test("a journal with mail off is reported off, and told what still arrives", async () => {
    const body = await (await health(probe())).json();

    expect(body.capabilities.mail.enabled).toBe(true);
    expect(body.journals[QUIET].mail).toEqual({
      enabled: false,
      reason: `not enabled by ${QUIET}`,
      stillSent: TRANSACTIONAL_MAIL_NOTE,
    });
    // Reporting `enabled: false` and nothing else was the lie: sign-in codes
    // kept arriving for a journal this page said had mail switched off.
    expect(body.journals[QUIET].mail.stillSent).toMatch(/sign-in codes/);
    // A journal that has mail on is not narrowed, so it is not listed at all —
    // and neither is one that never mentioned mail, because it is not narrowed
    // either. Reporting "not enabled by silent" for a journal that said nothing
    // was the other half of the lie.
    expect(body.journals[LOUD]?.mail).toBeUndefined();
    expect(body.journals[SILENT]?.mail).toBeUndefined();
  });

  test("a healthy instance says so about its content root", async () => {
    const response = await health(probe());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.content).toEqual({ ok: true });
  });

  /**
   * B197, second half. The gate no longer reads "cannot tell" as "the journal
   * said no" — that is asserted above, at `sendMail`. What was still missing
   * is that nothing could *say* the fault was happening.
   *
   * `getUsernames()` swallows its own `readdirSync` failure and returns an
   * empty list, because a failed listing must not take every page down with
   * it. But an empty list is exactly what an instance with no journals looks
   * like, so this page reported `status: ok`, an empty `journals` block, and
   * no hint that it could not see anything. An operator reading it during the
   * outage would conclude nobody had narrowed anything.
   */
  test("a content root it cannot read is reported, not passed off as ok", async () => {
    const readdir = vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    try {
      clearUserCache();
      const response = await health(probe());

      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe("error");
      expect(body.content.ok).toBe(false);
      // The fault is reported; the absolute path in it is not, to a caller
      // holding no HEALTH_TOKEN. B234, and test/health-disclosure.test.ts.
      expect(body.content.code).toBe("unreadable");
      expect(body.content.error).toBeUndefined();
      // The config file parsed fine; it is the directory around it that did
      // not, and conflating the two sends the operator to the wrong file.
      expect(body.config.ok).toBe(true);
      // And the empty block is now explained rather than misleading.
      expect(body.journals).toEqual({});
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("no journal resolves until this is fixed"),
      );
    } finally {
      readdir.mockRestore();
      clearUserCache();
    }
  });

  test("the fault is not remembered once the directory reads again", async () => {
    const readdir = vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });
    clearUserCache();
    expect((await health(probe())).status).toBe(503);

    // No `clearUserCache()` after this: the point is that the *successful*
    // read clears the recorded fault, not that the test seam does.
    readdir.mockRestore();
    expect((await health(probe())).status).toBe(200);
  });
});

const SAMPLE = {
  preheader: "Three new days",
  title: "Three new days since you last looked",
  blocks: [{ kind: "paragraph" as const, text: "Here is what happened." }],
  footer: "You are getting this because you asked to follow the trip.",
};
