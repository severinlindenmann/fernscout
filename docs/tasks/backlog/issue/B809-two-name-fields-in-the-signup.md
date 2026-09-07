---
id: B809
title: Two name fields in the signup form cannot be told apart
type: ISSUE
priority: medium
complexity: low
area: agent, signup
found: "2026-09-07T15:16:59Z"
---

# B809 — Two name fields in the signup form cannot be told apart

## Why

The signup form asks for a name twice, and a 23-year-old tester could not tell
the two apart:

> "'Your name' vs 'What should the site call you?' — I could not tell these
> apart and put 'Kevin' in both. I don't know what the second one is for that
> the first isn't."

He also did not learn until after typing that the "address" he chose becomes a
public web address — the hint sits under the field rather than above it.

## Work

Say what each name is for, in the label rather than a hint: one is who owns the
journal, the other is what a reader sees. If they are the same thing for most
people, ask once and let it be corrected later.

Move the "this becomes part of the web address" hint above the field, and say
it cannot be changed afterwards.

## Acceptance

Somebody who has never registered anything can answer both name questions
without guessing.
