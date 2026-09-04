---
id: B178
title: costsVisibility is read from a trip but nothing can write it, so guests-only money is unreachable
type: ISSUE
priority: medium
complexity: low
area: trips, api, costs
found: "2026-09-03"
started: "2026-09-04T05:58:32Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T05:58:32Z"
---

# B178 — Two trip fields that can be read but never written

## Why

Found while verifying B41, which is blocked on exactly this. Two acceptance
bullets could not be checked against the live instance — not because the
behaviour is wrong, but because **the fixtures they need cannot be created by
any means the product offers.**

### `costsVisibility: guests`

`parseTrip` reads it (`lib/trips.ts:279`) and `maySeeCosts` acts on it
(`lib/access.ts:77`). Nothing writes it:

- `POST /api/v1/<user>/trips` accepts `id, title, tagline, start, end, status,
  accent, visibility, listed, test, intro` and nothing else
  (`app/api/v1/[user]/trips/route.ts:108-119`).
- MCP `create_trip` takes the same set (`lib/mcp/tools.ts:1092`).
- `createTrip` writes no `costsVisibility` line (`lib/tripWrite.ts`).
- An absent field defaults to `public` (`lib/trips.ts:279`).

So **every trip on the live instance has public costs**, and the guests-only
branch has nothing to act on. Confirmed:
`grep -rl 'costsVisibility: *guests' /var/lib/fernscout/content --include=trip.md`
returns nothing.

This is the part that makes it more than a QA inconvenience. `AGENTS.md` states
there is no editing interface and there never will be — writing happens through
an agent. An owner who works only through an agent therefore **cannot make a
trip whose money is guests-only**, even though the field is documented and the
gate that enforces it is implemented and tested. The feature exists everywhere
except where somebody could reach it.

This is the same shape as **B51** ("a trip's `listed` frontmatter key is
documented and never read") — a field that is real on one side of the boundary
and absent on the other. B51 is the read half; this is the write half.

### `access_grants.expires_at`

`approveContact` writes `expires_at: null` unconditionally
(`lib/contacts/index.ts:669`) and nothing else inserts into `access_grants`.
There is no REST or MCP field for it. The expiry *is* enforced —
`grantIsLive` in `lib/grants.ts`, covered by `test/access-gate.test.ts` — but
no expired grant can exist on a running instance, so the behaviour has no
observable form outside the unit suite. B41's "a contact whose grant has
expired is refused" can only ever be verified in tests.

Lower stakes than the first: nothing is promised to an owner here, and a grant
that never expires is a defensible product decision. It is worth deciding on
purpose rather than by omission.

## Work

- Accept `costsVisibility` on the trip write path — REST and MCP both, since
  the two doors are meant to be the same content — and write it into
  `trip.md`. Values as `parseCostsVisibility` already understands them.
- Say in the trip field list (`add-a-trip`) what the field does and who it
  reveals money to, since it becomes settable for the first time.
- Decide `expires_at`: either give approval an optional expiry that an owner
  can set, or record that grants are permanent until revoked and that the
  column is retained for a future need. Do not leave it as an enforced rule
  that nothing can trigger.
- While in the write path, check the rest of the parsed frontmatter for the
  same gap. Two have turned up in one day (this and B51); a third would not be
  a surprise.

## Acceptance

- A trip created through REST or MCP can carry `costsVisibility: guests`, and
  an approved contact sees its costs where a stranger does not — B41's bullet,
  finally checkable.
- The two doors write identical frontmatter for identical input.
- The decision on grant expiry is written down, and matches what the code does.
