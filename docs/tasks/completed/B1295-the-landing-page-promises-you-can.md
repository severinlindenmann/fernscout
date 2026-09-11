---
id: B1295
title: The landing page promises you can export everything, and somebody without an agent has no way to
type: ISSUE
priority: medium
complexity: medium
area: export, helper
found: "2026-09-10T11:01:13Z"
started: "2026-09-11T16:26:43Z"
merged: "2026-09-11T16:59:26Z"
completed: "2026-09-11T19:13:27Z"
---

# B1295 — The landing page promises you can export everything, and somebody without an agent has no way to

## Why

The landing page's "Free, forever" list ends with

> ✓ **Export everything, whenever you like** — `pricing.freeExport`

`/<user>/export.zip` is the only way to do it, and it refuses a browser session
by design. `app/[user]/export.zip/route.ts:30` requires `mayActAsOwner` — an
**agent token** with unqualified `write:content` whose address matches
`config.json`'s `owner.email` — and answers a plain 404 to anything else. B231,
B240 and B1086 all argue for that, correctly: a buddy-scoped token once selected
the whole archive, and the refusal has to be indistinguishable from an unknown
journal.

Verified on the live instance: the owner's own cookie session, which opens
`/me`, `/contacts` and `/account`, gets **404** on `/test-mobile/export.zip`.

So the export exists for somebody holding a token, and the whole point of
`/agent` is the person who holds none — AGENTS.md: *"a person with no agent of
their own can reach one anyway, through a guided web helper at `/agent`"*. That
person can create a journal, write days, publish them, buy credits and order a
photobook, and cannot take their own words out. Nothing in the helper offers it;
nothing on `/me` or `/account` links to it.

The promise is on the front page, unqualified, in the list of what the free tier
includes.

## What needs deciding

The gate is right and should not be loosened. The question is what the person
without a token gets instead. Options, in rough order of cost:

- The helper hands over an export the way it hands over a photobook link — a
  one-off, expiring URL minted for a request the owner made in the room.
- A control on `/<user>/account` that mails a link, in the shape deletion already
  uses (`lib/deletions.ts`) — mail is already the second factor for the most
  destructive thing here, and this is the least destructive.
- Change the landing page to say what is true.

The last is honest and the worst product answer.

## Acceptance

- An owner who has never held an agent token can obtain their journal as a zip.
- `/<user>/export.zip` still answers 404 to a cookie session, a buddy token and a
  stranger.


## Decision, 2026-09-11 — build it, beside the way out

Asked whether "remove this feature" meant the promise or the capability, and the
answer was neither: **add the way in.**

**Where:** on `/<user>/me`, next to the *Delete this journal* section — the one
that reads *"This is the way out. It sends a link to the address that owns this
journal — nothing is deleted until you press the button in that mail, and
nothing can be put back afterwards."* An **Export** button there, using the same
shape: a link mailed to the address that owns the journal.

That pairing is the point. Leaving and taking your things with you are the same
moment, and the page that offers one should offer the other. It also means the
export is reached exactly the way the deletion is — nothing new to reason about,
and `app/[user]/delete/[token]/export.zip` already implements a single-use,
time-boxed, token-gated archive for a journal on its way out.

**So the work is to generalise that token from "a pending deletion" to "an export
request"**, and give it a button. Mirror the deletion token's shape rather than
inventing one: short-lived, single use, one archive. B1086 and B1387 already
reviewed that shape, including the deliberate exclusion of `config.json`.

The landing page's *"Export everything, whenever you like"* becomes true rather
than being deleted.

Not in scope: changing what the archive contains, or the agent-token route,
which keeps working as it does.

## Work

Built as decided, in `.claude/worktrees/b1295-export-link` (branch
`b1295-export-link`), reusing the `deletion_requests` table rather than a
second one:

- `lib/deletions.ts` gained `requestExport(username)`, `consumeExportToken`
  and `sendExportMail` — the same table, a new `kind: "export"` row
  (`trip_id` always null: this is always the whole journal), a random
  32-byte token hashed with the same `hashSecret`, and the same
  `DELETION_TTL_MS`/`DELETION_TTL_MINUTES` clock the deletion flow already
  uses. An earlier live export link for the journal is retired the same way
  `requestDeletion` retires an earlier deletion link — one live link per
  inbox.
- **New, not reused:** the export flow has no confirmation page, because
  there is nothing to confirm — downloading a copy changes nothing, so
  `consumeExportToken` spends the token the moment the archive route
  resolves it (single use in the literal sense), rather than leaving it live
  the way the deletion flow's own export button must (that one shares a
  token with a delete button still to come).
- `app/[user]/me/export/route.ts` — POST, cookie-only (an `Authorization`
  header is refused before it is read, mirroring `app/[user]/me/delete`),
  owner-gated via `isOwner`, rate-limited with `rateLimitFor("export-request",
  clientIp(request), { max: 3, windowMs: 60 * 60 * 1000 })`. There was no
  existing rate limit on `requestDeletion`'s own callers to match exactly —
  `DELETE /api/v1/<user>`, `.../trips/<trip>` and `/me/delete` all send mail
  with no per-IP throttle today — so this borrows the shape of the nearest
  analogous "resend a link" action instead: `contact-resend` in
  `app/api/contacts/admin/route.ts` (max 3, one hour).
- `app/[user]/export/[token]/route.ts` — GET, streams the zip straight back
  (no confirmation page in front of it, unlike the deletion flow), 404 for an
  unknown journal, 410 for an invalid/expired/used token. Not under
  `/api/v1/`, so `test/openapi-contract.test.ts` does not need an entry —
  same as `/[user]/delete/[token]/export.zip` beside it.
- `components/ExportAccount.tsx` — one button, no `ConfirmPanel` (nothing to
  confirm), wired into `MePageContent.tsx` directly above `DeleteAccount`,
  both owner-only.
- Locale keys `me.export*` (button copy) and `exp.*` (the mail) in en/de/hu;
  `npm run i18n:keys` regenerated the union in `lib/i18n.ts`.
- `pricing.freeExport` ("Export everything, whenever you like") needed no
  wording change — it is true now.
- `config.json` still travels with a whole-journal export (`tripId` absent
  in `createUserExportArchive(user, "all")`), exactly like the owner's own
  `/<user>/export.zip` and the whole-journal deletion mail's export button —
  B1387's exclusion only ever applied to a *trip*-scoped export, and this one
  is never trip-scoped.

**Verified with a real mail**, not just a green suite: a throwaway vitest
test (not committed) called `requestExport`, read the `.eml` `file` transport
wrote under a temp `dataDir()`, decoded the base64 `text/plain` part, and
confirmed the subject ("Your export from Testbed is ready"), the download
link (`https://t.test/anna/export/<token>`), and the 60-minute expiry line
all read correctly. A second run pulled the real token out of that mail,
called `consumeExportToken` twice, and confirmed the first succeeds and the
second is refused with `reason: "used"`.

`npm run verify` (full, unabridged): build, tsc and eslint clean; vitest
526 test files / 6918 tests passed, 4 skipped; knip clean (only the same six
pre-existing `knip.jsonc` configuration hints this tree already had, no
unused-export or unused-file failures). One knip failure was hit and fixed
along the way: `exportLinkUrl` was exported but only used inside
`lib/deletions.ts` itself, so the `export` keyword came off.
