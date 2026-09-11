---
id: B1537
title: A journal can only have one owner - couples and families can't share ownership
type: FEATURE
priority: medium
complexity: high
area: auth, journals
found: "2026-09-11T20:42:53Z"
---

# B1537 — A journal can only have one owner - couples and families can't share ownership

## Why

`owner.email` in a journal's `config.json` is a single string, and everything
that decides who may read a draft, publish a day, spend credits, or reach
`/agent` reads exactly that one address — `isOwner()`
(`lib/contacts/session.ts:35-49`) compares one `ownerEmail` against the
signed-in reader, and `resolveCookieCaller`/`isHelperOwner` (confirmed live
this session, B1505) is the same shape one level down for the helper. A
couple keeping one journal together, or a family journal several people are
meant to run equally, has exactly one of them as the real owner and
everyone else stuck as a `people:` buddy — trip-scoped, no `/agent` access,
no publish, no credits page, no `/me` — or sharing the one owner's login,
which is not a second identity, just the same session on two phones.

`people:` (up to ten, per trip, AGENTS.md's own "The content model" section)
solves a different problem on purpose — crediting who was physically on one
trip — and is not a stand-in for shared ownership of the whole journal.

## Work

**Needs a design pass before any code** — this is not a small change. At
minimum it touches:

- The `config.json` schema: `owner` becomes some form of list, or a new
  `owners:`/`coOwners:` field alongside the existing singular `owner` (kept
  for backward compatibility with every journal that predates this).
- `isOwner()` and every direct `owner.email` comparison across `lib/` and
  `app/api/` — `grep -rn "owner.email"` is the honest inventory, expected to
  be large.
- `/agent`'s owner-only gate (B1505's own finding) — does a second owner get
  `/agent` too, and does each need their own `helper_sessions`/conversation
  history, or do they share one thread?
- Whose name a trip is credited to when either owner writes it, and whether
  a second owner can add/remove another owner (a way to lock someone out of
  their own journal, if so) or only the original owner can.
- Onboarding (WhatsApp's own wizard, B1507; the web signup wizard) — does
  adding a second owner run through the buddy-invite flow with a new
  "co-owner" grant kind, or a wholly separate mechanism?
- Billing/credits: one balance shared, or does "whose card is charged"
  matter once two people can spend it?

Not doing here: deciding any of the above. This ticket is the capture; the
brainstorming skill's design pass is the next step, and it should probably
produce its own spec before `open/`.

## Acceptance

A design exists (spec or equivalent) that a person has approved, covering at
least: the schema, the full `isOwner()`-equivalent check, and what happens
to `/agent`'s per-owner state. Implementation is separate follow-up work
once that exists.
