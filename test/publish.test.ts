import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { createDraft, publishDraft } from "@/lib/api/entries";
import { getAllEntries, getEntryBySlug } from "@/lib/entries";
import { confirmationMatches, issueConfirmation } from "@/lib/agentConfirm";

/**
 * Publishing, and what the draft rule still guarantees afterwards.
 *
 * The rule was always "an agent writes drafts, a person publishes them", and
 * the second half had no mechanism: the only way to publish was to open the
 * file and delete a line, which is fine for the author on their own laptop and
 * impossible for somebody handed a journal by an agent. The guide said "a
 * person publishes it" four times and never said how.
 *
 * What must remain true, and is what these tests are for:
 *
 *  - writing and publishing are two separate calls, and nothing sent to the
 *    write can publish;
 *  - publishing is confirmed, with a code bound to that exact day;
 *  - the file is otherwise untouched — publishing is the removal of one line,
 *    not a rewrite.
 */

let dir: string;
const REF = "alex/reise";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-"));
  process.env.CONTENT_DIR = dir;
  process.env.SESSION_SECRET = "publish-test-secret-publish-test";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "reise", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A" } }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "reise", "trip.md"),
    [
      "---",
      "id: reise",
      'title: "Reise"',
      'start: "2026-09-01"',
      'end: "2026-09-05"',
      "status: current",
      "visibility: public",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

const DRAFT = {
  title: "Erster Tag",
  date: "2026-09-01",
  location: "Bellinzona",
  country: "Switzerland",
  content: "Ankunft am Morgen.",
};

describe("publishing a draft", () => {
  test("makes it visible to every reading path", () => {
    createDraft(REF, DRAFT);
    // Invisible first — this is the state an agent leaves behind.
    expect(getAllEntries(REF)).toHaveLength(0);

    expect(publishDraft(REF, "erster-tag")).toEqual({ ok: true, slug: "erster-tag" });
    expect(getAllEntries(REF)).toHaveLength(1);
    expect(getEntryBySlug(REF, "erster-tag")?.draft).toBeUndefined();
  });

  test("removes the status line and nothing else", () => {
    const made = createDraft(REF, { ...DRAFT, tags: ["tessin"] });
    if (!made.ok) throw new Error("expected the draft to be written");
    const before = fs.readFileSync(made.file, "utf8");

    publishDraft(REF, "erster-tag");
    const after = fs.readFileSync(made.file, "utf8");

    // Exactly one line gone, and it is the one.
    expect(before.split("\n").length - after.split("\n").length).toBe(1);
    expect(after).not.toMatch(/^status:\s*draft$/m);
    for (const kept of ['title: "Erster Tag"', 'location: "Bellinzona"', "Ankunft am Morgen."]) {
      expect(after).toContain(kept);
    }
  });

  test("a second attempt is refused rather than shrugged off", () => {
    // An agent that gets a cheerful 200 might report having just done a thing
    // that happened last week.
    createDraft(REF, DRAFT);
    expect(publishDraft(REF, "erster-tag").ok).toBe(true);
    const again = publishDraft(REF, "erster-tag");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already published/);
  });

  test("a slug that names nothing is refused", () => {
    expect(publishDraft(REF, "no-such-day").ok).toBe(false);
  });

  test("`status: draft` in the prose is not the frontmatter's", () => {
    // The line is removed only from inside the frontmatter block. A day that
    // talks about drafts is a day, not a bug.
    const made = createDraft(REF, {
      ...DRAFT,
      content: "We argued about whether status: draft was the right default.",
    });
    if (!made.ok) throw new Error("expected the draft to be written");

    expect(publishDraft(REF, "erster-tag").ok).toBe(true);
    const after = fs.readFileSync(made.file, "utf8");
    expect(after).toContain("whether status: draft was the right default");
    expect(getAllEntries(REF)).toHaveLength(1);
  });
});

/**
 * The confirmation is not proof a person consented — an agent can make both
 * calls. What it guarantees is that publishing is a distinct, deliberate act
 * bound to one day, which is why a code for one thing must not work for
 * another.
 */
describe("the confirmation binding", () => {
  const op = (target: string) =>
    ({ action: "publish_day" as const, scope: REF, target });

  test("a code publishes the day it was issued for", () => {
    expect(confirmationMatches(issueConfirmation(op("erster-tag")), op("erster-tag"))).toBe(true);
  });

  test("and not another day", () => {
    expect(confirmationMatches(issueConfirmation(op("erster-tag")), op("zweiter-tag"))).toBe(false);
  });

  test("and not the same day in another trip", () => {
    const code = issueConfirmation(op("erster-tag"));
    expect(
      confirmationMatches(code, {
        action: "publish_day",
        scope: "alex/andere-reise",
        target: "erster-tag",
      }),
    ).toBe(false);
  });

  /** The property that keeps publishing separate from deleting. */
  test("a code to delete a draft cannot publish it", () => {
    const deleteCode = issueConfirmation({
      action: "delete_draft",
      scope: REF,
      target: "erster-tag",
    });
    expect(confirmationMatches(deleteCode, op("erster-tag"))).toBe(false);
  });

  test("and a code to publish cannot delete", () => {
    const publishCode = issueConfirmation(op("erster-tag"));
    expect(
      confirmationMatches(publishCode, {
        action: "delete_draft",
        scope: REF,
        target: "erster-tag",
      }),
    ).toBe(false);
  });

  test("an invented code does not verify", () => {
    expect(confirmationMatches("cf_abc_madeitup", op("erster-tag"))).toBe(false);
  });
});
