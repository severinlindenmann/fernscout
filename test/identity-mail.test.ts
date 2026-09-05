import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  NO_JOURNAL,
  identitySignInUrl,
  issueCode,
  listIdentities,
  verifyLink,
} from "@/lib/auth";

/**
 * B430 — the identity mail's link, and the language it is written in.
 *
 * Two separate complaints in one ticket. The mail offered six digits to type
 * and nothing to press, and it was English whatever language the reader had
 * the site in — the second being a plain bug, since the route rendered
 * hardcoded literals where every other mail in the codebase goes through
 * `translateIn`.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-identity-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  delete process.env.AUTH_DEV_CODE;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {},
    }),
  );
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the link in the mail", () => {
  test("an identity code now carries one, like a guest code", async () => {
    const issued = await issueCode(NO_JOURNAL, "ana@example.test", "identity");
    expect(issued.linkToken).toBeTruthy();
  });

  /** An agent holds no cookie jar and a signup code creates a journal; a URL
   * that quietly opens a browser session is the wrong shape for either. */
  test("an agent and a signup code still get none", async () => {
    expect((await issueCode("ana", "a@example.test", "agent")).linkToken).toBeUndefined();
    expect((await issueCode(NO_JOURNAL, "a@example.test", "signup")).linkToken).toBeUndefined();
  });

  /**
   * At the root, because an identity belongs to no journal — and safe there
   * because `USERNAME_RE` needs two characters, so nothing can be called `s`.
   */
  test("points at /s/<token>, with no journal in it", () => {
    const url = identitySignInUrl("https://example.test", "abc123");
    expect(url).toBe("https://example.test/s/abc123");
    // A trailing slash on the base must not double up.
    expect(identitySignInUrl("https://example.test/", "abc123")).toBe(
      "https://example.test/s/abc123",
    );
  });

  test("redeeming it opens an identity, and records the browser", async () => {
    const { linkToken } = await issueCode(NO_JOURNAL, "ana@example.test", "identity");
    const result = await verifyLink(NO_JOURNAL, linkToken!, "identity", "Mozilla/5.0 (iPhone)");
    expect(result.ok).toBe(true);

    const [device] = await listIdentities("ana@example.test");
    expect(device.userAgent).toContain("iPhone");
  });

  test("it is single use", async () => {
    const { linkToken } = await issueCode(NO_JOURNAL, "ana@example.test", "identity");
    expect((await verifyLink(NO_JOURNAL, linkToken!, "identity")).ok).toBe(true);
    expect((await verifyLink(NO_JOURNAL, linkToken!, "identity")).ok).toBe(false);
  });

  /**
   * The B142 property, one level up: a scanner that follows the link costs the
   * reader the button and not the sign-in, because the six digits are consumed
   * separately and are still live.
   */
  test("spending the link leaves the code alive", async () => {
    const { code, linkToken } = await issueCode(NO_JOURNAL, "ana@example.test", "identity");
    await verifyLink(NO_JOURNAL, linkToken!, "identity");

    const { verifyCode } = await import("@/lib/auth");
    expect((await verifyCode(NO_JOURNAL, "ana@example.test", code, "identity")).ok).toBe(true);
  });

  /** A guest link and an identity link are both `login_codes` rows; redeeming
   * one as the other must not work. */
  test("a guest link cannot be spent as an identity link", async () => {
    const { linkToken } = await issueCode("ana", "ana@example.test", "guest");
    expect((await verifyLink(NO_JOURNAL, linkToken!, "identity")).ok).toBe(false);
  });
});

describe("the language of the mail", () => {
  /**
   * Source assertion rather than a render: the route reads the locale from the
   * request, which needs a request. What is worth pinning is that it no longer
   * carries English literals — that was the bug, and it is the kind that comes
   * back the next time somebody adds a paragraph in a hurry.
   */
  test("the route translates rather than hardcoding English", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app/api/auth/identity/request/route.ts"),
      "utf8",
    );
    expect(src).toContain("requestLocale()");
    expect(src).toContain('translateIn(locale, "mail.identitySubject"');
    // The literals that used to be here.
    expect(src).not.toContain("Your code is");
    expect(src).not.toContain("It lasts a year");
  });

  test("every language carries the whole mail", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    const keys = [
      "mail.identitySubject",
      "mail.identityTitle",
      "mail.identityCode",
      "mail.identityButton",
      "mail.identityApp",
      "mail.identityWhat",
      "mail.identityLasts",
      "mail.identityIgnore",
      "mail.identityFooter",
    ];
    for (const locale of ["en", "de", "hu"]) {
      const dict = dictionaryFor(locale);
      for (const key of keys) {
        expect(dict[key], `${locale} is missing ${key}`).toBeTruthy();
      }
    }
  });

  /** The number comes from CODE_TTL_MS, so no locale file may spell it out. */
  test("no language writes the code's lifetime into the sentence", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    for (const locale of ["en", "de", "hu"]) {
      expect(dictionaryFor(locale)["mail.identityCode"]).toContain("{minutes}");
    }
  });
});
