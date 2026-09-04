---
id: B220
title: The rest of a journal's config.json still cannot be changed after it is created
type: ISSUE
priority: low
complexity: medium
area: config, api
found: "2026-09-04T06:41:01Z"
---

# B220 — The rest of a journal's config.json still cannot be changed after it is created

## Why

Found while building B182, which asked which fields a config-writing call
should cover and deliberately answered "the `features` block only".

`PATCH /api/v1/<user>/config` and MCP `set_journal_features` now write that
block, so a journal is no longer frozen as whatever `createJournal` said on the
day it ran. Everything else in `content/<user>/config.json` still is:

- **`title`** and **`tagline`** — what the site is called. A typo made at
  signup is permanent without a shell on the server.
- **`locales`**, **`defaultLocale`** — the languages the journal speaks.
- **`baseCurrency`**, **`displayCurrencies`**, **`manualRates`** — how money is
  read across every trip.
- **`units`**, **`startLocation`**, **`visibility`** — the journal's own
  `public`/`private`, which decides whether this instance advertises it at all.
- **`media`** — a journal's own narrowing of the server's upload limits.

None of it is a capability, so none of it is covered by B182, and each has the
same shape of consequence: the person who owns the journal has never seen the
folder, so "edit config.json" is advice with nowhere to go (B28).

`owner.email` is **not** in this list and should stay out of it. It is the
address that decides who can obtain a token for the journal (decision 24), and
a token must not be able to move the boundary that issued it. B182's endpoint
refuses the whole body when it names anything but `features`, and that refusal
says so.

## Work

- Decide per field rather than opening the whole file. `visibility` and
  `baseCurrency` change what readers see and what every cost means; `title` and
  `tagline` are cosmetic. They do not deserve the same care.
- Whatever is accepted goes on **both** doors with the round trip asserted,
  the way B178 and B175 did for trip fields.
- Reuse `setJournalFeatures`'s shape: edit the file in place rather than
  regenerating it, so keys this code has never heard of survive; read back
  through `getUser` and restore the previous bytes if it does not parse.
- `manualRates` and `media` are maps rather than scalars and need a shape check
  before they reach the file.

Not doing: a settings page. There is no editing interface and there will not be
one (decision 24).

## Acceptance

- For each field above, the file records either a writer with a round-trip
  test, or a sentence saying why it stays file-only.
- `owner.email` is still refused, and the test that says so still passes.
