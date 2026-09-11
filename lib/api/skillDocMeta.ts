/**
 * The names and one-line summaries of the nine task documents at
 * `/skill/<name>.md` — split from `skillDocs.ts` so that `documentation.ts`
 * can list them (in `instanceDocumentation()` and `userDocumentation()`)
 * without importing the module that imports `agentGuide()` from
 * `documentation.ts` itself. See `skillDocs.ts` for how each is built.
 */

export type SkillDocSlug =
  | "new-account"
  | "add-journal"
  | "add-a-trip"
  | "add-a-day"
  | "ingest-photos"
  | "invite-someone"
  | "costs"
  | "send-postcards"
  | "make-a-photobook";

/**
 * The path of one skill document — typed on `SkillDocSlug`, so a caller
 * cannot misspell a slug and point a `next:` field at a document that does
 * not exist. `test/skill-docs.test.ts` also greps every route source file
 * for a literal `/skill/<name>.md` and checks the name against
 * `SKILL_DOC_SLUGS`, in case a string ever bypasses this helper.
 */
export function skillDocPath(slug: SkillDocSlug): string {
  return `/skill/${slug}.md`;
}

export const SKILL_DOC_SLUGS: SkillDocSlug[] = [
  "new-account",
  "add-journal",
  "add-a-trip",
  "add-a-day",
  "ingest-photos",
  "invite-someone",
  "costs",
  "send-postcards",
  "make-a-photobook",
];

export const SKILL_DOC_TITLE: Record<SkillDocSlug, string> = {
  "new-account": "Getting a token, from nothing or from an existing journal",
  "add-journal": "A journal's own settings, and deleting one",
  "add-a-trip": "A trip: making one, and changing it afterwards",
  "add-a-day": "Writing a day: fields, correcting one, and publishing",
  "ingest-photos": "Photographs and video: attaching them, and the inbox",
  "invite-someone": "Letting other people in",
  costs: "A trip's budget and what it actually cost",
  "send-postcards": "Real postcards, in the post",
  "make-a-photobook": "Printing a photobook",
};

/** What each is for — the one line an index gets to say about it. */
export const SKILL_DOC_SUMMARY: Record<SkillDocSlug, string> = {
  "new-account": "Prove an address, get a journal made, and get a token for it.",
  "add-journal": "Change what a journal says about itself, and delete one.",
  "add-a-trip": "Create a trip, describe who was on it, and change its own fields afterwards.",
  "add-a-day": "Write one day as a draft, correct it, and put it on the site.",
  "ingest-photos": "Attach photographs and video to a day, or stage them before the days exist.",
  "invite-someone": "Let somebody else read the journal or write to one trip.",
  costs: "A trip's budget, what it actually cost, and the rates that convert it.",
  "send-postcards": "Propose a printed postcard from a day — a person still has to send it.",
  "make-a-photobook": "Propose printing a book that has already been built — a person still has to print it.",
};
