---
id: B956
title: The honesty matchers use ASCII word boundaries against three languages
type: ISSUE
priority: medium
complexity: low
area: helper, honesty, i18n
found: "2026-09-08T11:48:58Z"
started: "2026-09-08T11:53:07Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T11:53:07Z"
---

# B956 — The honesty matchers use ASCII word boundaries against three languages

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Every matcher in `lib/helper/model.ts` is built from `\b`, and JavaScript's
`\b` is an **ASCII** word boundary. Between a space and `ö` there is no
boundary at all, because `ö` is not a word character to it.

So `\bösszesen\b` matches nothing that follows a space — which is everywhere
the word appears. Found in B955 by writing a Hungarian sentence into a test:
*"A nap átlagosan 12000 forint"* was invisible to a matcher that names
`átlag` explicitly. Both patterns were fixed there by dropping the leading
`\b`.

The trailing `\b` has the mirror fault. `\bképernyő\w*\b` — the screen, one of
the words B928 exists to catch — fails on the bare word at the end of a
sentence: `\w*` matches nothing after `ő`, and `ő` to `.` is not a boundary.
It matches *"képernyődön"* by luck, because the `d` in the middle happens to be
ASCII.

Nothing is known to be broken in production because of this. That is the
argument for the ticket rather than against it: these matchers are the last
thing standing between somebody and a false claim about their own journal, and
two of the three languages they cover are full of characters `\b` cannot see.

## Work

Read every pattern in the file for a `\b` adjacent to a non-ASCII letter, and
replace those with something that means what was intended — `(?<![\p{L}])` /
`(?![\p{L}])` with the `u` flag, which is what a language-aware boundary looks
like, or nothing at all where the word is distinctive enough.

Then a test per language that spells out real sentences, which is what found
the first one. `test/helper-honesty.test.ts` already has the shape.

Not doing: a general regex helper. The patterns are read as much as they are
run, and one clear expression beats a clever one.

## Acceptance

A German and a Hungarian sentence for every matcher in the file, asserted, and
none of them passing by luck.
