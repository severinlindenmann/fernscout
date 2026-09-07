---
id: B717
title: README.md still says there is no editing interface and there will not be one
type: DOCS
priority: low
complexity: low
area: docs, landing
found: "2026-09-07T11:43:55Z"
started: "2026-09-07T12:53:39Z"
merged: "2026-09-07T13:11:43Z"
---

# B717 — README.md still says there is no editing interface and there will not be one

## Why

`README.md:9` says **"There is no editing interface, and there will not be
one."** immediately under the tagline. B694 found and fixed the same sentence
in the nine places `/agent` (B681-B688) makes it wrong — the landing page
hero, `lib/api/documentation.ts`, `docs/helper.md`, `app/docs/helper/page.tsx`
and `docs/guides/de/creator.md` among them — but `README.md` was outside that
ticket's named scope and was left alone. It is the first thing a visitor to
the GitHub repository reads, and it now disagrees with what the hosted
instance itself does.

## Work

Reword `README.md`'s opening claim the same way B694 reworded
`landing.noEditor` and `docs/helper.md`: there is still no CMS, no web form,
no upload widget, and the folder is still the owner's — but this instance can
host an agent at `/agent` for people who do not bring their own. Keep it
short; this is a README, not a guide.

## Acceptance

`README.md` no longer states flatly that there is no interface at all; it
still asserts there is no CMS/web form/upload widget (ROADMAP decision 24 is
unchanged), and the wording is consistent with `AGENTS.md`'s post-B262
amendment of decision 24.

## Done

`README.md`'s opening claim, right under the tagline, went from "There is no
editing interface, and there will not be one" to "There is no CMS, no web
form, no upload widget, and there will not be one," with a clause naming the
hosted helper at `/agent` for people who don't bring their own agent. Matches
the current `AGENTS.md` phrasing ("There is no CMS, and there will not be one
(ROADMAP decision 24): no form that maps fields onto frontmatter, no upload
widget with its own idea of what a day is") and decision 24's third
amendment, which is careful that the helper "holds none of a CMS's shape"
and still writes drafts through the same API, publishing separately. Kept
the README's own brevity — one added clause, not a paragraph.

No test covers README prose; checked by grep that nothing else in
`lib/`, `app/`, `components/` asserts the old sentence against this file
specifically (nothing did — the other occurrences of the old sentence are in
completed task files and doc comments outside this ticket's scope).
