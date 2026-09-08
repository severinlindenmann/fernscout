---
id: B856
title: The journal visibility answer explains listing but not what it decides for trips
type: ISSUE
priority: low
complexity: low
area: api, journals
found: "2026-09-07T17:09:24Z"
started: "2026-09-08T19:51:10Z"
merged: "2026-09-08T20:08:17Z"
---

# B856 — The journal visibility answer explains listing but not what it decides for trips

## Why

The journal-visibility answer explains one half of what the choice does:

> "public is listed on this server's own index, its landing page and its
> sitemap; guest is on none of them."

It does not say the other half, which `/agent.md` does say: **it is also this
journal's own answer for a new trip's default**, unless the create call
overrides it.

A tester picked `public` "because it's the word I understand, same as a public
Insta", and learned three screens later, from a different message, that it had
also decided who his future trips are open to by default.

He also did not know what a sitemap is — worth noting separately, because the
sentence explains the choice in the vocabulary of the thing being configured
rather than the consequence being chosen.

## Work

Add the trip-default half to the answer, in the API and on the form, and say
"not listed anywhere, and search engines are asked not to index it" rather than
naming the sitemap.

## Acceptance

Somebody choosing public or guest learns both things it decides, in words that
do not assume they know what a sitemap is.

## Found on validation (2026-09-08)

The web helper's own welcome form (`site/locales/{en,de,hu}.json`, keys
`welcome.public`/`welcome.private`, rendered from `lib/journals.ts`) already
said both halves and already avoided naming the sitemap — that copy was fixed
under B306/B510, before this ticket was captured. The gap was narrower than
the ticket's quote suggested: `POST /api/v1/journals`'s *missing-value*
refusal (`app/api/v1/journals/route.ts`, then around line 158) already carried
the trip-default sentence too, added by B306. The one answer still missing
both halves was the *unrecognised-value* refusal a line below it (then around
line 179) — the message an agent actually receives from
`visibility: "hidden"` or any other typo — which said only what a value is
listed on, named "its sitemap", and said nothing about a new trip's default.

`lib/api/agentCopy.ts`'s `VISIBILITY_MEANING` — the sentence `/agent.md`,
`/openapi.json` and `/documentation.txt` already share — already carried the
trip-default half but still named "its sitemap". Reworded it to
"public is listed on this server's own index and on its landing page; guest
is not listed anywhere, and search engines are asked not to index it" and
had both `app/api/v1/journals/route.ts` refusals import and use it, instead
of each carrying its own hand-typed copy (one of which had drifted). Also
reworded the matching hand-written paragraph in `lib/api/documentation.ts`'s
`/agent.md` prose, which named the sitemap too.

## What changed

- `lib/api/agentCopy.ts`: `VISIBILITY_MEANING` no longer names "the sitemap";
  says "not listed anywhere, and search engines are asked not to index it"
  for `guest`. (It already had the trip-default sentence.)
- `app/api/v1/journals/route.ts`: both the missing-`visibility` and the
  unrecognised-`visibility` refusals now interpolate `VISIBILITY_MEANING`
  instead of each hand-typing its own copy — the second of these previously
  had neither the trip-default sentence nor plain language for "guest".
- `lib/api/documentation.ts`: the `/agent.md` paragraph explaining a
  journal's `visibility` no longer names "the sitemap".
- `test/journals-required-fields.test.ts`: the "unrecognised value" test now
  asserts the refusal mentions "new trip's default" and never says
  "sitemap" — this failed against the pre-fix message (no trip-default
  sentence, and the earlier message named the sitemap even though this
  particular refusal happened not to).

## Acceptance — evidence

- "Somebody choosing public or guest learns both things it decides": every
  answer that states journal `visibility`'s meaning — the missing-value and
  unrecognised-value API refusals, `/agent.md`, `/openapi.json`,
  `/documentation.txt`, and the web helper's welcome-form copy — now states
  both the listing surfaces and the trip-default consequence, sourced from
  one shared sentence (`VISIBILITY_MEANING`) plus the already-correct
  welcome-form strings.
- "in words that do not assume they know what a sitemap is": "sitemap" no
  longer appears in any of those answers; the `guest` half now reads "not
  listed anywhere, and search engines are asked not to index it", matching
  the ticket's suggested phrasing exactly.
- `npx vitest run test/journals-required-fields.test.ts` — new assertions
  pass; `npm run verify` — full pass (443 files, 5745 passed, 4 skipped;
  `unused` 5/5), no known-noise failures encountered on this run.
