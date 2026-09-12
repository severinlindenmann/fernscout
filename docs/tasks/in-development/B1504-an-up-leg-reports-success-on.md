---
id: B1504
title: An up leg reports success on config fields that can never reach the site
type: ISSUE
priority: low
complexity: low
area: helper, api, config
found: "2026-09-11T18:32:07Z"
started: "2026-09-12T08:20:20Z"
session: 615a7d13-b735-48b0-a399-bf28e199b7bb
claimed: "2026-09-12T08:20:20Z"
---

# B1504 — An up leg reports success on config fields that can never reach the site

## Why

Found while researching B1495. Three fields of `content/<user>/config.json`
have no write door and are refused on purpose, each with its reasoning written
beside it at `app/api/v1/[user]/config/route.ts:219`: `owner.email` is the auth
boundary itself, `baseCurrency` would silently misconvert every cost already
recorded, and `media` is a ceiling a journal must not be able to widen for
itself. All three refusals are right and none of them should change.

The problem is what a client does with them. B1495's up leg pushes a local
folder to the site; a person who corrects one of those three lines in their own
`config.json` and runs a sync gets a run that reports success, because every
call the run made did succeed. The line simply never reaches the site, and
nothing says so.

That is the shape AGENTS.md keeps coming back to: *"It was accepted" is not the
same claim as "it is there"*, and a person reading the run's output has no
other way to know. The same argument the helper's own stale-trip-field warning
was built on — `publish.mjs:395-418` already does exactly this for trip fields.

## Revalidated 2026-09-12 — valid, with one correction and one decision

**Still true.** `JOURNAL_FIELD_REFUSALS` (`lib/journals.ts:912`) still refuses
`owner`, `baseCurrency` and `media`, and the refusal is whole-body rather than
silent — so a caller that *sends* one is told. What nobody is told is the case
this ticket is about: a client that correctly declines to send them, and
therefore reports a clean run while the line never reaches the site.
`publish.mjs:293` is that client, and its key list is hardcoded.

**Correction to the Why.** The ticket says the comparison is possible once the
client asks the instance. Only one of the three is readable today:

| field | readable from `GET .../config`? |
| --- | --- |
| `baseCurrency` | **yes** — `journalProfile()`, `lib/journals.ts:977`, and deliberately so: a caller sending `displayCurrencies` must know what it has to contain |
| `media` | **no** — not in `JournalProfile` at all. `/api/health`'s `media` block is the *server's* ceiling, not this journal's narrowing of it |
| `owner.email` | **no**, and on purpose — `app/api/v1/[user]/config/route.ts:150-155`: *"a token that can read a journal's config is not the same thing as permission to collect its owner's email"* |

**Decided 2026-09-12, by the owner.** `media` is read back, so it can be
compared exactly; `owner.email` is not, and that refusal stands. The up leg
therefore does two different things:

- **An unconditional scope line, every run**, naming all three fields and
  saying they are never sent. That is the "no silent caps" pattern, and it is
  what covers `owner.email`, whose local edit cannot be detected at all without
  a read-back. It is a statement, not an alarm.
- **A named warning, only on a real difference**, for `baseCurrency` and
  `media`. A guard that fires on an honest run is a bug, so these are
  conditional on a compared value actually differing.

**Second problem found in the same line, captured not absorbed:** `publish.mjs`
hardcodes nine profile keys where `JOURNAL_PROFILE_FIELDS` now has eleven, so
`ownerTel` (B614) and `travellers` (B1526) are dropped in silence — the same
drift B1518 fixed one level down for `trip.md`. Captured as its own id; the fix
is the same edit, because replacing the hardcoded list with a shared
`journalFields.mjs` is what this ticket needs anyway.

## Work

The up leg compares those three fields against what the instance reports and
prints a named warning per field that differs, rather than passing over them in
silence. Reuse the machinery `publish.mjs` already has for the trip-field
staleness check rather than writing a second one.

Mostly a `fernscout-helper` change. If `GET .../config` does not read back
enough to make the comparison, that part is here.

## Acceptance

- Editing `owner.email`, `baseCurrency` or `media` locally and running the up
  leg prints a warning naming the field and saying it cannot be sent, and the
  run does not report those fields as applied.
- Editing a field that *does* have a door still reaches the site with no
  warning — a guard that fires on an honest run is a bug.


## Built, 2026-09-12

**In this repository:** `journalProfile()` (`lib/journals.ts`) gains `media`,
read-only, beside the `baseCurrency` that was already there for the same
reason. `app/api/v1/[user]/config/route.ts` says why; `lib/api/openapi.ts`
describes both read-only fields and, now, says out loud that `owner.email` is
deliberately absent. `owner.email` is unchanged and stays unreadable.

**In `fernscout-helper`:** `shared/journalFields.mjs` is the one list —
`JOURNAL_UPDATE_DOORS` (eleven), `JOURNAL_NO_UPDATE_DOOR` (the three, with the
sentence a person is told) and `JOURNAL_COMPARABLE_NO_DOOR` (the two that can
be read back). `publish.mjs` prints the scope line on every run and the named
warning only on a real difference, and sends the shared eleven keys instead of
its hardcoded nine — which is B1569, fixed in the same edit because it is the
same line.
