import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { sendMail, sendTransactional } from "@/lib/mail";
import { renderMail } from "@/lib/mail/template";
import { TRANSACTIONAL_MAIL_NOTE } from "@/lib/mail/types";
import { sendWelcome } from "@/lib/journals";
import { sendCodeMail } from "@/lib/contacts/mail";
import { runDigest } from "@/lib/digest";
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
 * digests and welcome letters sent on its behalf, and with `keepCopy` on it
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

function writeJournal(username: string, mail: boolean) {
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
        mail: { enabled: mail },
      },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

/** Every `.eml` filed under one journal. The evidence, in both directions. */
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

  test("the digest refuses, and names the file to change", async () => {
    // Loud, so this is the journal's own answer and not the server's — the two
    // are separate errors because the fix is a different file in each case.
    await expect(runDigest(QUIET)).rejects.toThrow(/not enabled for "quiet"/);
    expect(mailFor(QUIET)).toEqual([]);
  });

  test("a --dry-run digest still plans, because it sends nothing", async () => {
    await expect(runDigest(QUIET, { dryRun: true })).resolves.toMatchObject({
      dryRun: true,
    });
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

describe("/api/health agrees with what actually happens", () => {
  test("a journal with mail off is reported off, and told what still arrives", async () => {
    const body = await (await health()).json();

    expect(body.capabilities.mail.enabled).toBe(true);
    expect(body.journals[QUIET].mail).toEqual({
      enabled: false,
      reason: `not enabled by ${QUIET}`,
      stillSent: TRANSACTIONAL_MAIL_NOTE,
    });
    // Reporting `enabled: false` and nothing else was the lie: sign-in codes
    // kept arriving for a journal this page said had mail switched off.
    expect(body.journals[QUIET].mail.stillSent).toMatch(/sign-in codes/);
    // A journal that has mail on is not narrowed, so it is not listed at all.
    expect(body.journals[LOUD]?.mail).toBeUndefined();
  });
});

const SAMPLE = {
  preheader: "Three new days",
  title: "Three new days since you last looked",
  blocks: [{ kind: "paragraph" as const, text: "Here is what happened." }],
  footer: "You are getting this because you asked to follow the trip.",
};
