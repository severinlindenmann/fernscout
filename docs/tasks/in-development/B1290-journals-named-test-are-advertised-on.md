---
id: B1290
title: Journals named test- are advertised on the public landing page beside the demo
type: ISSUE
priority: medium
complexity: low
area: landing
found: "2026-09-10T10:59:23Z"
started: "2026-09-10T16:54:38Z"
session: 0b65a2c0-133d-4fda-b7d5-b9e50d6f6b55
claimed: "2026-09-10T16:54:38Z"
---

# B1290 — Journals named test- are advertised on the public landing page beside the demo
## Revalidation (2026-09-10)

**Valid.** `listedUsernames()` in `lib/users.ts:253` filters only on
`visibility === "public"`; nothing anywhere reads the `test-` prefix. The
landing page (`publicJournals()` in `lib/home.ts:89`), the sitemap
(`app/sitemap.ts`), the instance documentation (`lib/api/documentation.ts:129`)
and the openapi example username all route through `listedUsernames()`, so it
is the one place to act on the convention.

## Why

The landing page of fernscout.ch, under **Public journals on this server**,
lists three journals:

| | |
| --- | --- |
| Fernscout Demo | `/example` · 5 trips |
| **Test Elena** | `/test-elena` · 1 trip |
| **Test Jonas** | `/test-jonas` · 1 trip |

Two of the three are leftovers from persona and testing runs, sitting on the
front page of the instance beside the demo, each with a card the width of the
screen. A visitor arriving at the product sees that two thirds of what this
server hosts is called "Test".

AGENTS.md already establishes the naming convention and says exactly why it
exists:

> **A whole journal made for testing is named for it** … The directory name is
> the one label that survives an export, a backup and an `ls`, and it is what
> lets anybody — or any later agent — delete the thing without stopping to find
> out whose it is.

Nothing acts on it. `publicJournals()` in `lib/home.ts` lists whatever is
`public`, so a test journal is advertised until somebody notices and removes it
by hand — which is how these two survived.

Two separable things:

- **The convention should do something.** A `test-` prefix is already the agreed
  marker for content nobody lived; `test: true` on a *day* is kept out of the
  feed, the search index and the sitemap for exactly this reason, and a journal
  has no equivalent.
- **These two should go.** That is an operations task, not this ticket, but the
  reason they are still here is the missing rule above.

## Work

- **Chose the prefix, not a switch**: it is free, already the documented
  convention, and (the ticket's own words) a switch is a field nobody will
  set.
- One filter in `listedUsernames()` (`lib/users.ts`): a `test-` journal is
  treated like a `guest` one — unlisted, not gone. That is the root cause,
  because everything that advertises a journal instance-wide routes through
  it: the landing page (`publicJournals()`), `sitemap.xml`,
  `/documentation.txt`, and the openapi example username. The feed and the
  search index are per-journal (`/[user]/feed.xml`), the same surfaces an
  unlisted `guest` journal already serves to anybody sent the address, so
  they are deliberately unchanged — consistent with how `guest` behaves, and
  `test: true` days inside are already filtered by `isIndexable`.
- Test beside the `guest`-journal one in `test/journals.test.ts`.
- Removing `test-elena` / `test-jonas` from the live instance stays an
  operations task, as the ticket says.

## Acceptance

- A journal named `test-<something>` does not appear among the public journals on
  the landing page.
- A real journal is unaffected.
