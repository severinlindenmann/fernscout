---
id: B479
title: The photobook receipt test bans an English word rather than checking a claim
type: CHORE
priority: low
complexity: low
area: tests, i18n, photobook
found: "2026-09-05T15:20:00Z"
started: "2026-09-06T14:20:15Z"
session: 6b9bf0a6-5ea8-4f27-bfcd-df5022696053
claimed: "2026-09-06T14:20:15Z"
---

# B479 — The photobook receipt test bans an English word rather than checking a claim

## Why

`test/photobook-receipt.test.ts` asserts the receipt body does not match
`/\bposted\b|\bshipped\b/`. The claim it is trying to protect is real and
important: no provider is called anywhere in the photobook feature, so a mail
that says the book was printed or posted would be false.

But the assertion tests for a *word*, not for a claim, and it is wrong in both
directions.

It fails correct text. The English string originally written for this feature
was "Nothing has been printed and nothing has been posted" — true, clear, and
rejected by the regex, which does not read the negation in front of the word it
is banning. It was reworded to "nothing has left this server" to get past the
test, which is a fine sentence but was not a fix for anything.

And it passes text it should catch. The mail renders in the **owner's** locale
(`pickLocale(user.defaultLocale)`), and the fixture is `en`, so only English is
ever exercised. A German or Hungarian string could claim outright that the book
was posted and this test would not notice.

A reviewer on B476 read the German "Es wurde nichts gedruckt und nichts
verschickt" and the Hungarian "Semmi nem került nyomtatásra és postázásra" as
making a false claim, and recommended rewording both. That reading is wrong —
both are negations and both say nothing was sent — but the fact that a careful
reader got there from the test's framing is the argument for this ticket.

## Work

Decide what the assertion is actually for, then write that. Options, in
increasing order of effort: assert on the presence of the honest sentence
rather than the absence of a word; or parametrise the test over the three
locales with a per-locale expectation; or drop the regex and assert the
`notPrinted` key is present in the rendered body, which is the thing that
carries the claim in every language.

**Not doing:** rewording the German or Hungarian strings. They are correct.

## Acceptance

- The test fails if any locale's receipt stops carrying the "nothing was
  printed, nothing was sent" statement.
- The test does not fail a sentence that states the truth using the word
  "posted" inside a negation.

## Resolution (2026-09-06)

Took the third, cheapest option named in Work: dropped the regex and assert
on the rendered `notPrinted` key instead, which is the string that actually
carries the claim in every language `lib/photobook/receipt.ts` can render in.

`test/photobook-receipt.test.ts`:
- The old assertion (`expect(eml.toLowerCase()).not.toMatch(/\bposted\b|\bshipped\b/)`)
  is gone.
- `writeUserConfig` now takes a `defaultLocale` (still `"en"` by default), so
  a locale can be swapped in without touching the rest of the fixture.
- A new `test.each(["en", "de", "hu"])` case rewrites the user's
  `defaultLocale`, clears the config cache, sends the receipt, and asserts the
  mail contains `dictionaryFor(locale)["photobook.receipt.notPrinted"]`
  verbatim — the exact sentence a reader would see, in their own language,
  read straight from the same locale file the receipt itself translates from.

Evidence against the two Acceptance lines:
- Deleting/blanking any locale's `photobook.receipt.notPrinted` value in
  `site/locales/{en,de,hu}.json` makes its `test.each` case fail, because the
  mail would no longer contain the (now-empty or missing) string — checked by
  reasoning about the assertion; the parametrised case reads the same value it
  asserts against, so the two cannot drift silently.
- The German (`"Es wurde nichts gedruckt und nichts verschickt."`) and
  Hungarian (`"Semmi nem került nyomtatásra és postázásra."`) strings — both
  negations, both correct, and the ones a reviewer previously misread as false
  claims — are asserted present as-is; nothing was reworded, per the ticket's
  "Not doing".

`npx vitest run test/photobook-receipt.test.ts` — 4 passed (the original
"links to both files" case, now without the word-ban line, plus the three new
per-locale cases).
