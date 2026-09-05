---
id: B488
title: The home view calls another journal DEINS to the instance admin
type: ISSUE
priority: medium
complexity: low
area: home view
found: 2026-09-05T00:00:00Z
---

## Why

B480 gave the instance operator owner-level access to every journal, and
`journalsFor` lists them all. It listed them as `role: "owner"`, so the badge
on each card read **DEINS** / *Yours* and the line underneath read "Yours to
publish. Hand the instruction below to your agent to write a day."

Both are false about somebody else's journal, and the second is an instruction
to act on it. The whole purpose of that list is to mix journals a person owns
with journals they merely reach and keep them apart at a glance
(`components/HomeJournals.tsx:47`), which is exactly what this lost.

## Work

A fourth `HomeRole`, `admin`: the operator on a journal whose `config.json`
does not name them. Their own journals stay `owner` — the operator address
owns journals like anybody else.

- `lib/home.ts` — `named` and `admin` computed separately, `owner` is still
  either, so nothing about *access* changes. Sorted last, since on this
  instance `admin` is every other journal on the server.
- `components/HomeJournals.tsx` — its own badge tone (coral, the loudest of the
  four) and its own hint.
- `home.role.admin` and `home.adminHint` in en, de and hu.

## Acceptance

`test/admin-address.test.ts`: with `FERNSCOUT_ADMIN_EMAIL` set, `journalsFor`
returns the operator's own journal as `owner` and the other as `admin`, own
one first. Unset, the address lists nothing and every other row is unchanged.
