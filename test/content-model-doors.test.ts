import { describe, expect, test } from "vitest";

import { contentModel } from "@/lib/contentModel/document";
import { EDITABLE_DAY_FIELDS } from "@/lib/api/entries";
import { TRIP_DETAIL_FIELDS } from "@/lib/api/tripFields";
import { JOURNAL_FIELD_REFUSALS, JOURNAL_PROFILE_FIELDS } from "@/lib/journals";
import type { FileName } from "@/lib/contentModel/types";

/**
 * B1577 — the gate, and the reason this file is the ticket rather than the
 * `doors` section is.
 *
 * A field added to this instance used to have to be remembered in up to five
 * places, the last of them in another repository. Twice it was not: B1518
 * (`teaser`, then `cover`) and B1569 (`ownerTel` and `travellers`) are the
 * same failure a year apart — accepted by a client's local check, silently
 * never sent, and reported as a success.
 *
 * The fix B1569 shipped was a warning in the client, and it is a fallback by
 * construction: it can only notice *after* this instance has already grown the
 * field. So the enforcement has to be here, where the field is added. **Add a
 * key to a file's model without saying which call writes it, and this test is
 * red** — naming the key, in the repository whose change caused it.
 *
 * It is deliberately two-way. A door naming a key the file does not have is
 * just as wrong: it sends a client after something that is not there, and it
 * is what a rename or a removal leaves behind.
 */

const doors = () => {
  const document = contentModel();
  expect(document.doors, "the document must publish a doors section").toBeDefined();
  return document.doors!;
};

/** Every key one file may carry, from the document's own `known-key` rule. */
function knownKeys(file: FileName): string[] {
  return contentModel()
    .rules.filter((rule) => rule.where === file && rule.assert === "known-key" && rule.path === "")
    .flatMap((rule) => ("keys" in rule ? [...rule.keys] : []));
}

/** Keys that cross the API but never sit in the file. They may have a door —
 * `intro` and `coordinates` do — but nothing requires them to, because a
 * request mechanic like `idempotency_key` is not content. */
function apiOnlyKeys(file: FileName): string[] {
  return contentModel()
    .rules.filter((rule) => rule.where === file && rule.assert === "never-in-file")
    .map((rule) => rule.path);
}

const FILES: FileName[] = [
  "config.json",
  "trip.md",
  "entries/YYYY-MM-DD-slug.md",
  "costs.md",
  "plan.md",
];

describe("every file has doors, and they agree with the model", () => {
  test("all five files are covered", () => {
    expect(Object.keys(doors()).sort()).toEqual([...FILES].sort());
  });

  test.each(FILES)("%s: every key it may carry says which call writes it", (file) => {
    const { update, noUpdate } = doors()[file];
    const undeclared = knownKeys(file).filter((key) => !(key in update) && !(key in noUpdate));
    expect(
      undeclared,
      `${file} may carry ${undeclared.join(", ")} and lib/contentModel/doors.ts says nothing ` +
        `about ${undeclared.length === 1 ? "it" : "them"}. Put each in "update" with the call ` +
        `that writes it, or in "noUpdate" with the reason there is none — a key with no door ` +
        `is not the same as one nobody has got round to, and only the sentence tells them apart.`,
    ).toEqual([]);
  });

  test.each(FILES)("%s: no door names a key the file does not have", (file) => {
    const real = new Set([...knownKeys(file), ...apiOnlyKeys(file)]);
    const { update, noUpdate } = doors()[file];
    const stale = [...Object.keys(update), ...Object.keys(noUpdate)].filter((key) => !real.has(key));
    expect(
      stale,
      `${file}'s doors name ${stale.join(", ")}, which the model does not list. A rename or a ` +
        `removal leaves exactly this behind, and it sends a client after a key that is not there.`,
    ).toEqual([]);
  });

  test.each(FILES)("%s: no key is in both lists", (file) => {
    const { update, noUpdate } = doors()[file];
    const both = Object.keys(update).filter((key) => key in noUpdate);
    expect(both, `${file}: ${both.join(", ")} both has a door and has none`).toEqual([]);
  });

  test.each(FILES)("%s: every reason and every call is a real sentence", (file) => {
    // A blank string satisfies the checks above and tells a client nothing,
    // which is the shape a hurried addition takes.
    const { create, update, noUpdate } = doors()[file];
    expect(create.length, `${file} names no create call`).toBeGreaterThan(4);
    for (const [key, call] of Object.entries(update)) {
      expect(call.length, `${file}'s ${key} names no call`).toBeGreaterThan(4);
    }
    for (const [key, why] of Object.entries(noUpdate)) {
      expect(why.length, `${file}'s ${key} gives no reason`).toBeGreaterThan(20);
    }
  });
});

/**
 * The other half: the section is *derived*. If one of these drifts, somebody
 * has re-typed a list that was already imported — which is the habit this
 * whole ticket exists to break.
 */
describe("the doors come from the constants the routes use", () => {
  test("a day's editable fields are EDITABLE_DAY_FIELDS, to the letter", () => {
    const { update } = doors()["entries/YYYY-MM-DD-slug.md"];
    for (const field of EDITABLE_DAY_FIELDS) expect(update).toHaveProperty(field);
  });

  test("a trip's general PATCH is TRIP_DETAIL_FIELDS, to the letter", () => {
    const { update } = doors()["trip.md"];
    for (const field of TRIP_DETAIL_FIELDS) expect(update).toHaveProperty(field);
  });

  test("a journal's writable fields are JOURNAL_PROFILE_FIELDS, to the letter", () => {
    const { update } = doors()["config.json"];
    for (const field of JOURNAL_PROFILE_FIELDS) expect(update).toHaveProperty(field);
  });

  test("the three refusals carry the API's own sentences, not a paraphrase", () => {
    // `JOURNAL_FIELD_REFUSALS` is what a caller who *tried* is told. A second
    // wording here would be the same fact in two places, disagreeing within a
    // month — and the client prints one of them to a person (B1504).
    const { noUpdate } = doors()["config.json"];
    for (const [key, sentence] of Object.entries(JOURNAL_FIELD_REFUSALS)) {
      expect(noUpdate[key]).toBe(sentence);
    }
  });
});

/**
 * The section is additive, and the version says so — B1577. Bumping it would
 * make every client written against version 1 refuse a document it can still
 * use, for a change that takes nothing away.
 */
test("adding doors did not bump the major version", () => {
  expect(contentModel().contentModel).toBe(1);
});
