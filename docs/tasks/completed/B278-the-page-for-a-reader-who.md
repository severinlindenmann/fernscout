---
id: B278
title: The page for a reader who may see nothing names nobody to ask and offers no way in
type: ISSUE
priority: medium
complexity: medium
area: trips, access, i18n
found: "2026-09-04T12:32:34Z"
started: "2026-09-04T12:50:15Z"
merged: "2026-09-04T13:09:00Z"
completed: "2026-09-04T20:01:43Z"
---

# B278 — The page for a reader who may see nothing names nobody to ask and offers no way in

## Why

B264's message is live and reads, in German:

> **Nichts, was du lesen kannst**
> Hier gibt es nichts, was du lesen kannst. Reisen in diesem Tagebuch können
> privat sein — frag, wer dir davon erzählt hat, nach einem Einladungslink,
> oder melde dich mit der eingeladenen Adresse an.

The owner's judgement on seeing it, 2026-09-04: it tells somebody what to do
and gives them nothing to do it with. Two specific gaps.

**It names nobody.** *"Ask whoever told you about it"* is a description of a
person the reader may not be able to identify — an address forwarded twice
arrives from nobody in particular. The journal's owner has a nickname in
`config.json` for exactly this purpose (`owner.nickname`, "Viki"), it is the
name the site uses in its own voice everywhere else, and a reader who is
looking at "Vikis Travels" learns nothing new from being told to ask Viki. So
naming them costs no privacy and turns an instruction into an action.

**There is no way in from the page.** The message tells an already-invited
reader to sign in; the only sign-in is a link in the journal nav. The owner's
words: *"I'd rather have a page like we had before, where a person can either
get a passcode if he already is a user."* A reader who has been approved and
cleared their cookie is exactly the person this page is for, and it sends them
hunting.

## Work

- **Name the owner** in the message, from `owner.nickname`, in all three
  locales. Fall back to the journal title where a nickname is missing rather
  than rendering an empty name — a journal written before nicknames existed
  must not produce "ask ".
- **Put the code request on the page**: the address field and the one-shot code
  exchange the sign-in gate already implements, reused rather than rebuilt.
  Find what the existing gate component is and use it; there should not be two
  implementations of asking for a passcode.
- **B264's property is not negotiable and this must not break it.** A journal
  with no trips and a journal filtered to nothing must still render
  **byte-identically** to a signed-out reader — the owner's nickname is
  constant for the journal, so it is safe, but a form whose presence or
  contents varied with what exists behind the gate would leak precisely what
  B264 closed. The exact-equality test in `test/empty-journal.test.tsx` must
  still pass, unchanged, and extended to cover the form.
- Keep the owner's own branch as it is — that is B75 and B76's work.
- Mind what the sign-in gate already says about a closed trip not naming
  itself (B117). Naming the *journal's* owner is fine; naming a trip is not.

## Acceptance

- The message names the owner, in all three locales, with a title fallback.
- A reader can request and enter a code without leaving the page.
- The two signed-out cases still render byte-identically, form included,
  asserted by the existing test.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
