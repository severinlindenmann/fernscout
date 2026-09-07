---
id: B717
title: README.md still says there is no editing interface and there will not be one
type: DOCS
priority: low
complexity: low
area: docs, landing
found: "2026-09-07T11:43:55Z"
started: "2026-09-07T12:53:39Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T12:53:39Z"
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
