---
id: B461
title: The postcard preview is English on a German journal, and its language note explains nothing
type: ISSUE
priority: high
complexity: low
area: postcards, i18n
found: "2026-09-05T16:05:10Z"
started: "2026-09-05T13:02:31Z"
merged: "2026-09-05T13:11:58Z"
---

# B461 — The postcard preview is English on a German journal, and its language note explains nothing

## Why

**Every word of `/<user>/postcards/<id>` is hardcoded English.** With the site
switched to DE the page still reads "Postcards, ready to send", "What it says",
"Save the words", "Going to 1 person". Every other page on the site goes
through `useI18n`/`translateIn` and three maintained locales; this one was
written in a hurry and skipped it. The compose sheet (B441) does have its
strings in `content/locales/*.json`, which makes the inconsistency worse rather
than better — half the feature translates and half does not.

**And the language wording is confusing, which is the part that actually
matters.** A recipient row reads `Severin Lindenmann — Wohlenschwil, CH · reads
Deutsch` and the note says "This card is written in English, and one person on
it reads another language." A reader's honest question is *so does he get a
German card or not?* — and nothing on the page answers it. The answer is no:
nothing is translated, everybody gets the same words. That has to be said
plainly, not implied by a dot and a verb.

## Work

- Move **all** preview-page copy into `content/locales/{en,de,hu}.json` under
  `postcard.*`, with the `TranslationKey` union updated. No English left in the
  component. Where a count changes the wording, separate keys — the helper does
  no pluralisation and inventing one for this page is not the job.
- Rewrite the language copy so it answers the question it raises:
  - The card's own language reads as a property of the words, e.g. *"Written
    in: Deutsch"* with a line saying the same card goes to everybody.
  - A recipient's language appears as *"usually reads Deutsch"*, and the
    mismatch note says explicitly that **nothing is translated** and that this
    person will get the card in the language it is written in.
  - Say it once, near the words, not twice in two places that disagree.
- Check the whole flow reads in one language: the sheet (B441), this page, and
  the mail nothing sends. A journal set to DE should not meet an English string
  anywhere in it.

**Not doing:** translating the card itself. The message is the owner's words in
the language they chose; a machine translation of somebody's postcard is not
something this project should offer.

## Acceptance

- With the journal in DE, no English appears on the preview page.
- `test/locales.test.ts` still passes — every key present in all three.
- The page states, in words, that everyone receives the same untranslated card,
  and a reader who prefers another language is shown as a note rather than as a
  promise the card will be in theirs.
