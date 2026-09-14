---
id: B1666
title: Finish decision 5: journal-level features and manualRates are still read by live code
type: CHORE
priority: medium
complexity: high
area: v2-migration
found: "2026-09-13T13:07:39Z"
merged: "2026-09-13T18:32:49Z"
completed: "2026-09-14T16:32:35Z"
---

# B1666 — Finish decision 5: journal-level features and manualRates are still read by live code

## Why

Decision 5 (`docs/v2-migration/00-decisions.md:23`) says the per-journal
`features` block is instance-only now, and `manualRates` lives per-trip
inside `rates.manual` instead of on the journal. Neither half is true of the
code today:

- `lib/capabilities.ts:517-522` (`resolveOne`) still reads
  `user.features[name]?.enabled` for every capability not in
  `OPERATOR_ONLY_FEATURES`, and a journal's own block still narrows what that
  journal gets — contacts, postcards, weather, analytics and the rest.
  `docs/v2-migration/05-status.md:538-543` already recorded this while
  converting `content/example`: dropping the block there switched
  reactions, costs, weather and analytics **off** for the demo journal, and
  says outright "Decision 5 is owed by the CODE first; content cannot lead
  it."
- `lib/rates.ts:125-134` (`currencyOptions`) still reads a journal's own
  `site.manualRates` to fill gaps the ECB archive does not cover, for the
  whole journal's currency picker (`app/[user]/layout.tsx`,
  `app/agent/page.tsx`). Decision 5 says this moves to a trip's own
  `rates.manual` (`lib/tripWrite.ts`'s `eurManualRates`), but that is a
  *different* mechanism — one trip's accepted currencies at trip-creation
  time — not a journal-wide fallback for the currency switcher every page
  renders. Nothing today gives a journal-wide converter a v2 home if the
  per-journal block goes away.

This is why `app/api/v1/[user]/config/route.ts` is still alive
(see B1595 / the v2-config-last work): both fields it writes are read by
live code, on every journal, right now.

## Work

Not done by B1595 on purpose — this is a production behaviour change for
every deployed journal and needs its own scoped rollout, not a side effect
of deleting a v1 route:

1. Audit every real journal's `config.json` on the deployed instance(s) for
   a non-empty `features` block and a non-empty `manualRates` block —
   `content/example` is the only one checked in this repository, and it is
   not representative of what is actually deployed.
2. For `features`: decide what happens to a journal that currently narrows
   itself below the instance ceiling (e.g. `contacts: false` while the
   server has it on) once the journal's own vote is deleted from
   `resolveOne`. Silently turning a capability a journal deliberately
   switched off back **on** is not a safe default either.
3. For `manualRates`: give the journal-wide currency-picker fallback in
   `lib/rates.ts`'s `currencyOptions()` a v2-shaped home before removing the
   journal-level field it reads today, or accept and document that a
   journal using a non-ECB currency (e.g. VND) loses its converter.
4. Only then remove `user.features` from `lib/journals.ts` and the
   `user.features[name]` read in `lib/capabilities.ts`, and the
   `site.manualRates` read in `lib/rates.ts`.

## Acceptance

- `lib/capabilities.ts`'s `resolveOne` no longer reads any journal-level
  `features` field, and `/api/health` / `/status` are still the only place a
  capability's state is reported, with a stated migration path for a
  journal that had narrowed itself.
- `lib/rates.ts`'s `currencyOptions()` no longer reads `site.manualRates`,
  or a documented decision says the journal-wide fallback stays and decision
  5 is narrowed to say so.
- `content/example`'s `features` key (`docs/v2-migration/example-migration-report.txt:24`)
  can be dropped without changing behaviour.
