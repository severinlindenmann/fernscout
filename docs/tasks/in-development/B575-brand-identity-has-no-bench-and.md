---
id: B575
title: Brand identity has no bench, and its numbers live in three files
type: DOCS
priority: medium
complexity: medium
area: docs/branding
found: "2026-09-06T13:45:35Z"
started: "2026-09-06T13:46:05Z"
session: ccfbf357-ec9d-4044-a6b3-f8614796e175
claimed: "2026-09-06T13:46:05Z"
---

# B575 — Brand identity has no bench, and its numbers live in three files

## Why

The four benches at `/docs/branding` cover what the *product* draws — scenes,
figures, a day card, print margins — and nothing covers the identity itself.
Somebody asking "what colour is this, and may I set text in it" has to read
`docs/branding/BRAND.md`, and BRAND.md is a file of numbers that are copied
from somewhere else:

- Hexes are in `app/globals.css:6`, and again in BRAND.md's role table.
- Contrast ratios are in `app/globals.css:24` as a comment table, in
  BRAND.md's "Contrast — measured, not assumed" table, and a third time in
  `.claude/skills/apply-the-brand/SKILL.md`.
- The lockup files are listed in BRAND.md §3 and again in the skill's
  "which file for which slot" table.

Three copies of a measured number is three chances to be wrong, and the copy
a person reads is never the one that was updated. None of it is rendered
anywhere either — the ratios are asserted, not shown, and the mark is only
ever seen at whatever size the slot that used it happened to pick.

## Work

A fifth bench, `/docs/branding/identity`, that derives instead of restating:

- Swatches parsed out of `app/globals.css` at request time, so the hex on the
  page is the hex the site ships.
- Contrast computed, not typed — every token against the three grounds text
  is set on, with the verdict (AAA / AA / fill only) falling out of the
  number rather than being asserted beside it.
- Every lockup file in `docs/branding/` rendered from disk, at its real size
  and at 16px.
- The prose — name, mark, lockups, type, iconography, motion, voice —
  rendered from BRAND.md's own sections, the way `/docs/contributing` already
  reads `CONTRIBUTING.md`.

Then delete what it replaces: BRAND.md's hex column and contrast table, the
ratio table in the `globals.css` comment, and the skill's colour numbers and
file table — each becomes a pointer.

Not doing: a colour picker, a downloadable asset zip, or dark-mode variants.

## Acceptance

- `/docs/branding/identity` renders, and is listed on `/docs/branding`.
- Changing a hex in `app/globals.css` changes the page with no other edit.
- `grep -rn '2.36\|4.82\|10.13' docs/ .claude/skills/ app/globals.css`
  finds no hand-written contrast ratio outside a test fixture.
- `npm run verify` passes.
