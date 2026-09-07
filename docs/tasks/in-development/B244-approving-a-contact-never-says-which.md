---
id: B244
title: Approving a contact never says which trips the approval opened
type: ISSUE
priority: medium
complexity: medium
area: contacts, trips, api
found: "2026-09-04T08:43:45Z"
started: "2026-09-07T11:06:08Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T11:06:08Z"
---

# B244 — Approving a contact never says which trips the approval opened

## Why

Found while building B213.

`approveTripPlaces` (`lib/tripPeople.ts`) ends with `return opening.map((row)
=> row.trip_id)`, and its own doc says why: "Returns the trips that were
opened, so the caller can say so." There is one caller. `approveContact`
(`lib/contacts/index.ts:697`) calls it as a statement and drops the array, and
`POST /api/contacts/admin {"action":"approve"}`
(`app/api/contacts/admin/route.ts:124`) answers `{"ok": true, "contact": …}` —
a contact record, with no trip in it anywhere. `ContactsAdmin.tsx` renders one
Approve button and no result beyond the row changing colour.

So the owner clicking approve is never told that the click also handed
somebody **write access to a named trip**. That is the strongest thing an
approval does — `AGENTS.md` calls a buddy link "the stronger of the two and
not the one to forward" for exactly this reason — and it is the one part of the
outcome no surface mentions.

It is not a wrong answer, which is why it is not B213: since B213 the trips
really are open, so `ok: true` is true. It is a missing one, and it matters in
two places at once. Approving a pending buddy request opens the trip it named;
approving a contact the owner previously **revoked** now re-opens every place
that revocation closed (B213), possibly months later, when the owner may only
have meant "you may read my journal again".

The information exists, is computed, is returned, and is thrown away one line
later. That is the cheap half. The rest is a response field and something for a
person to read.

## Work

- Carry the trip ids out of `approveContact` to its callers. The blocker is the
  signature: it returns `ContactRecord | null` and roughly twenty-five test
  call sites read `.status` or assert `toBeNull()`, so widening it to
  `{ contact, tripsOpened }` is the change to cost first. A second exported
  reader that re-queries is the alternative and is worse — it would ask a
  different question from the writer, which is the divergence B82, B130, B161
  and B213 were each one instance of.
- Name the trips in the admin route's approve response.
- Say it in the panel, in words the owner reads before or after the click —
  "this also puts them back on <trip>, with write access". `components/
  ContactsAdmin.tsx`, plus the i18n strings.
- Not in scope: changing what approval *does*. B213 settled that. This is only
  about the approval saying it.

## Acceptance

- `POST /api/contacts/admin {"action":"approve"}` names the trips the approval
  opened, and names none when it opened none.
- Approving a contact whose place was revoked says the place came back.
- A test asserts both, including the empty case — an approval that opens
  nothing must not claim a trip.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.

## Resolution

**`approveContact`'s signature widened**, exactly as the Work section
anticipated: `lib/contacts/index.ts` now returns `{ contact: ContactRecord;
tripsOpened: string[] } | null` — `null` on the same two refusals as before
(no such contact; unconfirmed address), so every caller that only checks
`if (!x)` is unaffected. `tripsOpened` comes straight from the existing
`approveTripPlaces(owner, id)` call, which already computed and discarded it.

Every real caller updated:
- `app/api/contacts/admin/route.ts` — `case "approve"` destructures `{
  contact, tripsOpened }`, resolves each id to its trip's title via
  `getTrip(tripRef(username, tripId))?.title`, and returns `{ ok: true,
  contact: ownerView(contact), tripsOpened: <titles> }`. `case "self"`
  (the owner's own row) just reads `.contact`.
- `app/api/contacts/confirm/route.ts` and `app/api/contacts/redeem/route.ts`
  — both read `.contact.status` instead of `.status` off the pre-approved
  auto-approve call; neither surfaces `tripsOpened` to the reader, since
  these are the *reader's* own screen and a reader is never told which trips
  a journal opened for them (AGENTS.md: "A closed trip does not name itself"
  — the same reasoning that keeps a trip's identity out of the sign-in gate
  applies to not naming it in a redemption confirmation either).

Ten test call sites that read `.status`/`.approvedAt`/`toBeNull()` directly
off the old flat shape were updated to `.contact.status` etc.
(`test/contacts.test.ts`, `test/invite-links.test.ts`,
`test/postcard-contacts.test.ts`, `test/postcard-orders.test.ts`,
`test/postcard-signature.test.ts`, `test/trip-place-revival.test.ts`,
`test/write-revocation.test.ts`) — found mechanically via `npx tsc --noEmit`
after the signature change, which is exactly the fifteen-or-so sites the Work
section estimated. The `toBeNull()` sites needed no change: `null` on refusal
is unchanged.

**The admin route names trips by title, not id** — the owner reads this page,
not an agent, and a trip id they never chose to remember (AGENTS.md: ids are
"chosen by hand and guessable") is not what they parse; `viaLabel` in the same
file already makes the identical choice for the same reason.

**`components/ContactsAdmin.tsx`** says it in the panel. The Approve button's
`onClick` now goes through a dedicated `onApprove`/`approve()` handler (rather
than the generic fire-and-forget `act`) that reads `tripsOpened` off the
response and stores it in the top-level component's `approvedTripsByContact`
state, keyed by contact id. It has to live at that level rather than in
`ContactRow`'s own state: a successful approve moves the row from the
`pending` group to the `approved` one, which is a *different* `<ContactGroup>`
subtree — a `useState` inside `ContactRow` would be unmounted the instant
`refresh()` re-renders the lists, before the owner could read it. The row
renders one of two new strings — `contact.adminApprovedTrips` (naming the
trip(s), joined) or `contact.adminApprovedNoTrip` — immediately under the
button, distinguishing "opened nothing" (`[]`, a real answer) from "nothing to
say yet" (`undefined`, before any click this page-load).

## What this reveals to a non-owner

Nothing new. `app/api/contacts/admin/route.ts`'s `guard()` still requires
`isOwner` before any of this is reachable — an agent bearer token never
reaches it (AGENTS.md: "an agent token reaches `/api/…` and never a rendered
page", and this route is not even under `/api/v1/`). The trip titles named in
the response were already readable by the same owner via `GET
/api/contacts/admin` (the `contacts` list) and `GET /api/v1/{user}/trips`; no
address, token or anything about who *else* holds access is added. The one
new fact surfaced is exactly the one the Why section says was missing: that
this owner's own click just handed a named trip write access — which is
theirs to know, since they are the one who did it.

**Contract**: `app/api/contacts/admin` is not under `app/api/v1/` or
`app/api/auth/`, so it is outside `lib/api/openapi.ts`'s scope — confirmed by
grepping `paths:` in that file and by `test/openapi-contract.test.ts` only
walking `app/api/v1` and `app/api/auth`. No OpenAPI change needed or made.

**Tests**:
- `test/contacts-admin-invite.test.ts`, new describe "approving names the
  trips it opened" — one case with a claimed trip place (names `["Welcome
  Trip"]`), one with none (names `[]`). Both go through the real `POST
  /api/contacts/admin` route, an owner agent token, and a `getTrip`-backed
  title lookup.
- `test/write-revocation.test.ts` — the existing "writes again when the owner
  approves them back" test, which already exercises the exact B213 scenario
  (a revoked place restored by re-approval), now also asserts
  `back?.tripsOpened` equals `["owner-only-2026"]` — the empty-vs-named
  distinction landing on the one scenario the Why section calls out by name.
- `test/contacts.test.ts` — the "makes the contact active" test now also
  asserts `approved?.tripsOpened` is `[]` for a plain journal-wide approval
  with no trip claim.

All three, plus the full suite, pass under `npm run verify` (build → tsc →
eslint → vitest, 332 files / 4280 tests, 0 errors).

Not done: an interaction test clicking the button in a real DOM and asserting
the note appears — this repository has no `@testing-library/react` or
equivalent installed, and every existing UI test in `test/` renders statically
with `renderToStaticMarkup`. The wiring (state lift, prop threading, the two
i18n keys) is exercised by `npx tsc --noEmit` and by the route-level tests
above, which cover the actual data the panel renders; only the click-and-see
step is unverified by an automated test. Worth a `backlog/` capture if this
repo ever adds interaction-testing tooling for its admin panels generally —
not scoped to this ticket alone.
