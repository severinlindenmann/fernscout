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

## What was built

The Why is accurate on both halves. One thing it implies is worth stating
plainly, because it decided the design: `parseCostsVisibility` reads an
unrecognised value as **`guests`**, which is the opposite fail-safe direction
from `visibility`. That is right for a reader — the quiet end of the money axis
is the safe one — and it is what makes a *write* that silently defaults
unacceptable in either direction.

- **`costsVisibility` is accepted on both doors** — the REST body and MCP
  `create_trip`'s `inputSchema` — and written into `trip.md`.
- **Written only when it narrows.** `costsVisibility: guests` appears in the
  file; `public` does not, because an absent key already reads as `public` and
  a line that never says anything is furniture in a file a person is meant to
  open and read straight. Same reasoning the file already applies to `listed:`
  and `test:`.
- **An unrecognised value is refused, not defaulted** — `invalid_costs_visibility`,
  and nothing is written. Defaulting to `public` would widen what the caller
  asked for *and* disagree with the reader about the same file; defaulting to
  `guests` would hide the money of everybody who typed "publik". Neither is a
  thing to decide silently about somebody's trip. This is the one field in
  `createTrip` that does not fall back to a default, and the note in the code
  says why.
- **Documented where it is now reachable**: the trip field list in
  `add-a-trip` (a fifth behaviour field, with the fail-closed default spelled
  out), and the trip-creation section of `/agent.md` (`lib/api/documentation.ts`).

### The `expires_at` decision

**Grants are permanent until the owner revokes them**, and neither door takes
an expiry. Written down at `grantIsLive` in `lib/grants.ts`, which is the one
place the rule is enforced, so the decision and the enforcement are read
together.

The reasoning, recorded there: approving somebody is the owner saying "you are
welcome here", not "you are welcome here until March", and an access list that
silently empties itself is a worse surprise than one the owner has to prune.
The column stays and stays enforced, so "let them in until Christmas" is one
writer away rather than one migration and one writer away. The consequence to
know is the one the Why names — no expired grant can exist on a running
instance, so B41's "a contact whose grant has expired is refused" is
observable only in `test/access-gate.test.ts`, and that is now on purpose
rather than by omission.

### The rest of the parsed frontmatter

Checked, as the Work section asked. There are **four** more fields in
`KNOWN_TRIP_FIELDS` that are read and that nothing can write: `people`,
`cover`, `rates` and `translations`. `people` is the one with a real
consequence — it grants write access and is the byline — and accepting it on a
create is a decision worth taking on its own rather than inside this ticket.
Captured as **B207**.

Also captured: **B206**, MCP `create_trip` has no `listed` property while REST
does, found while checking the two doors accept the same body.

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

### Evidence

- `test/journals.test.ts` → "costsVisibility": guests-only round-trips through
  `createTrip` and reads back as `guests`; an omitted field writes no line and
  reads as `public`; an unknown value is refused with `invalid_costs_visibility`
  and writes nothing.
- `test/mcp.test.ts` → "create_trip and REST write identical frontmatter for
  guests-only costs": the same body through both doors produces byte-identical
  `trip.md`. That is the two-doors bullet, asserted rather than reasoned.
- The half this cannot prove from here is B41's own: *an approved contact sees
  the costs where a stranger does not.* That gate is already covered by
  `test/access-gate.test.ts` → "costs marked for guests"; what was missing was
  a fixture it could run against on a live instance, and that is what this
  makes creatable. Verifying it end-to-end belongs to whoever tests B41.
- Grant expiry: `lib/grants.ts`, the paragraph beginning "Decided, rather than
  left open (B178)". It matches the code — `approveContact` writes
  `expires_at: null` on insert and clears it when reviving a lapsed row, and
  nothing else inserts.
