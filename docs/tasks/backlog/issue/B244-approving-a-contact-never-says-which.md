---
id: B244
title: Approving a contact never says which trips the approval opened
type: ISSUE
priority: medium
complexity: medium
area: contacts, trips, api
found: "2026-09-04T08:43:45Z"
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
