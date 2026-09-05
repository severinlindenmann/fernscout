---
id: B480
title: One instance-wide address opens every journal
type: FEATURE
priority: high
complexity: low
area: auth
found: 2026-09-05T00:00:00Z
---

## Why

Access on this instance is per journal and there is no way above it. The
operator of a multi-journal instance — the person who runs the server, holds
the VPS and answers for the content on it — cannot read a journal they do not
own, cannot publish into one, and cannot even obtain an agent code for one:
`mayRequestAgentToken` (`app/api/auth/request/route.ts:305`) refuses any
address that is neither `owner.email` nor on the named trip.

That is correct for a public instance and wrong for this one, where one person
owns the machine and the agent doing the work is a single address.

## Work

One address, named in the environment as `FERNSCOUT_ADMIN_EMAIL`, is treated
as the owner of every journal on the instance. Environment and not
`content/config.json` because it is an authorisation control: it changes on the
server without a content commit, and does not sit in the repository.

`lib/admin.ts` answers the one question. The gates that ask it:

- `isOwner` (`lib/contacts/session.ts`) — cookie, identity, or the address's
  own agent bearer token, whichever journal that token was minted for.
- `mayReadTrip` and `isGuestOf` (`lib/tripGate.ts`) — a `private` trip in
  somebody else's journal is otherwise refused; `isOwner` is not consulted
  there today because a journal's real owner arrives through `peopleNamedIn`.
- `ownsUser` (`lib/api/auth.ts`) — so one bearer token reaches every journal's
  REST routes.
- `mayRequestAgentToken` — so a code can be issued for a journal the address
  does not own.
- `journalsFor` (`lib/home.ts`) — the home view lists every journal.

**Not** `peopleNamedIn`/`peopleOf`: those feed the day digest
(`lib/digest/dayLetter.ts:122`), so an admin merged in there would be mailed
every day published anywhere on the instance. And not `journalsOwnedBy`, which
reads what is on disk and backs the three-journals-per-address cap.

The byline is untouched — credit stays the `people:` block, per AGENTS.md.

## Acceptance

`FERNSCOUT_ADMIN_EMAIL` unset: every existing access test passes unchanged, and
the address opens nothing. Set: the address reads a `private` trip in a journal
it does not own, sees its drafts, and its agent token writes to it.
`test/admin-address.test.ts` covers both.
