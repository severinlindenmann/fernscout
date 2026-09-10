---
id: B1346
title: The owner cannot ask to delete their journal from a browser
type: FEATURE
priority: medium
complexity: low
area: app/[user]/me
found: "2026-09-10T17:10:27Z"
merged: "2026-09-10T17:24:28Z"
---

# B1346 — The owner cannot ask to delete their journal from a browser

## Why

`/[user]/me` is the page that answers "what do I have access to?", and since
`components/SignOut.tsx` it answers "and how do I stop". It has never answered
"and how do I leave".

The only door is `DELETE /api/v1/<user>`
(`app/api/v1/[user]/route.ts:26`), which goes through `authenticate()` and
therefore needs a bearer token. An owner with a browser and no agent in front
of them cannot reach it at all — and `MAX_JOURNALS_PER_EMAIL` is three, so
three journals they cannot delete is a permanent ceiling for exactly the person
least able to do anything about it. B38 built the whole mail-gated flow for a
caller the server cannot see; the person it was trying to reach has no button.

## Work

- `app/[user]/me/delete/route.ts` — the same door-shape as B1321's
  `app/[user]/trips/[trip]/delete/route.ts`: cookie only, any `Authorization`
  header refused before it is read. `GET` answers the inventory, `POST` calls
  `requestDeletion` and nothing else.
- **Not** a second remover. A trip deletes outright from its own page because
  the owner standing there is the person the mail was trying to reach; a whole
  journal stays in the mailbox for everybody, which is what AGENTS.md says and
  what makes re-proving the address worth the detour when there is no undo.
- `components/DeleteAccount.tsx` — a `ConfirmPanel` carrying the inventory
  (B28), a confirm label that says "send me the link" rather than "delete",
  and a `role="status"` line naming the address afterwards. Owner only, gated
  on `viewer.owner` like every other owner-only panel on the page.
- Eight `me.delete*` strings in all three locales.

Not doing: any change to `/api/v1/<user>`, to the mail, or to the confirmation
page the link lands on. Not doing a credits warning on this panel either —
`del.credits` is already on the deletion page itself, which is where the money
question belongs, since nothing has been decided until that page.

## Acceptance

- `npx vitest run test/me-delete-account.test.ts` — a bearer token is refused
  on both verbs, a guest's own cookie is refused, and the owner's `POST`
  writes one `.eml` and leaves the journal on disk.
- On a local checkout with `auth` and `mail` on, signed in as the owner of
  `example`: the foot of `/example/me` shows "Delete this journal"; pressing it
  asks with the demo journal's real inventory ("5 journeys, 41 days and 153
  files (23 MB)"); pressing "Send me the link" replaces the button with the
  address the mail went to, and `content/example/` is untouched.
