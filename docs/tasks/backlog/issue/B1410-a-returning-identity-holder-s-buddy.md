---
id: B1410
title: A returning identity-holder's buddy invite looks redeemed but the confirm step is never submitted
type: ISSUE
priority: high
complexity: low
area: contacts, buddy invites
found: "2026-09-10T19:54:58Z"
---

# B1410 — A returning identity-holder's buddy invite looks redeemed but the confirm step is never submitted

## Why

Reported directly: the owner of `/severin` had previously deleted that journal
(through the proper confirmation-mail flow) and, after recreating it, issued a
fresh buddy invite for the trip `algarve-2026` to his wife
(`viktoriazentai96@gmail.com`). She opened the link and was not asked to
verify her address again — expected, since her `fs_identity` cookie is bound
to no journal (`owner_id: NO_JOURNAL`, `lib/auth/index.ts:989-990`) and proves
her address on any journal, including a freshly recreated one with the same
username. But afterwards she appears nowhere: not in `/severin/contacts`
(checked directly, confirmed absent), not as a buddy on the trip.

Checked on the live instance's Postgres:

```
contact_invites: id=7c955090-258e-4743-9a38-d8f9b63e5e55 owner_id=severin
  kind=buddy trip_id=algarve-2026 uses=0 revoked_at=(null)
contacts: no row at all for owner_id=severin and viktoriazentai96@gmail.com
```

`uses` is incremented at exactly one call site — inside `requestContact`
(`lib/contacts/index.ts:327`, called from
`app/api/contacts/redeem/route.ts:300-313`) — once the `contacts` row is
written. It is not a last-step, post-success counter; it fires early, right
after the insert. `uses = 0` with no contact row at all rules out the two
candidate silent-failure paths: a stale `blocked` contact row surviving the
old journal's deletion (there is no row for her under `owner_id=severin` at
all, so nothing could be `blocked`), and a request that reached
`requestContact` and failed later (that would still have bumped `uses`). The
token itself is valid — not expired, not revoked. So the redeem POST was
simply never made.

The client-side reason: `RedeemPage` sets `knownEmail` whenever any proven
address exists — session *or* identity (`app/[user]/invite/redeemPage.tsx`,
consumed at `components/InviteRedeem.tsx:104-109`) — and `InviteRedeem` starts
at `step: knownEmail ? "confirm" : "form"` (`InviteRedeem.tsx:137`). That
"confirm" step still renders a real `<form onSubmit={redeem}>` with a submit
button (`InviteRedeem.tsx:301,323-326,574-578`); nothing auto-submits it, and
`redeem()` only runs on that press (`InviteRedeem.tsx:202-260`). For a
first-time invitee this is fine — they still type a name and press "get my
code". For a returning identity-holder, the *only* thing that visibly changed
from the six-digit-code flow is that a step got skipped, which reads as "you
are already known here, this must be done" — and closing the tab at that point
leaves no contact row, no invite use, and no signal to the owner that anything
was ever attempted. Neither side sees an error, because there wasn't one: the
request never went out.

## Work

**Recommended fix: when the reader is already known (identity or session
proven), submit the confirm step automatically rather than waiting for a
press.** The server already has everything the confirm step would send —
there is nothing left for the person to decide or type, unlike the
first-time `"form"` step which genuinely collects a name. Concretely:

- In `components/InviteRedeem.tsx`, when mounting into `step === "confirm"`,
  call `redeem()` immediately (e.g. from an effect keyed on that initial
  state) instead of waiting for `BusyButton`'s `onSubmit`. Keep the button as
  a fallback for the case the auto-submit itself fails (network error) so
  there is still a way to retry by hand.
- Keep the existing behaviour for `step === "form"` (first-time invitees)
  unchanged — they still need to supply a name.
- No change to `requestContact`, `countInviteUse`, or the server-side
  `alreadyIn` short-circuit (`app/[user]/invite/redeemPage.tsx:85-88`), which
  is a separate, correct case (genuinely already has access, no invite to
  redeem).

**Not in this ticket.** Nothing about the deletion/recreation path itself —
`deleteJournal` (`lib/deletions.ts:585-598`) does sweep `contacts`,
`contact_invites`, `access_grants` and `trip_people` by `owner_id`, and this
investigation found no evidence of a stale row surviving it; the DB state
above shows a clean recreation. Do not go looking for a tombstone/sweep bug
without new evidence — this ticket's finding is the confirm-step UX gap, not
the deletion sweep.

## Acceptance

- A buddy or guest link opened by a reader who already holds a proven
  identity/session for a different (or the same, freshly recreated) journal:
  the flow completes — a `contacts` row is written, `contact_invites.uses`
  increments — without the person pressing anything, and they land on the
  "you're in" / "waiting for approval" screen the same way a code-verified
  redemption does.
- A first-time reader with no proven address still sees and must complete the
  name-entry form as today.
- Driven in a browser (`test-in-a-browser`) as a returning identity-holder
  rather than asserted from the API alone — the bug is precisely that the API
  was never called.
- `npm run verify` clean.
