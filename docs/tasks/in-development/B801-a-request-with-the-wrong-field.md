---
id: B801
title: A request with the wrong field name is accepted and silently does nothing
type: ISSUE
priority: medium
complexity: low
area: contacts, api
found: "2026-09-07T14:58:58Z"
started: "2026-09-08T19:14:16Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T19:14:16Z"
---

# B801 — A request with the wrong field name is accepted and silently does nothing

## Why

`POST /api/contacts/request` takes the invite token in a field named `invite`.
Sending it as `token` — the obvious guess, and what a careless integrator
writes — returns `202 {"status":"accepted"}` and does nothing at all.

The uniform `202` is deliberate and correct: the endpoint must answer the same
way whether or not a token is real, or it becomes an oracle for guessing them.
That reasoning covers a *wrong* token. It does not cover a *malformed request*,
where no token was supplied at all — refusing that leaks nothing, because the
caller has told you they sent no token.

As it stands the caller is told their request succeeded when nothing happened,
which is the failure mode AGENTS.md singles out: "it was accepted" must not be
a different claim from "it is there".

Found by an integrator on the live instance, 2026-09-07.

## Work

Refuse a body with no `invite` field with a `400` naming the field. Keep the
uniform `202` for every case where a token *was* supplied, valid or not.

Check the other uniform-answer endpoints for the same distinction — a missing
field is not a wrong value.

## Acceptance

A request with no invite token is refused and says which field is missing. A
request with a wrong token still answers exactly like one with a right token.

## What was found and changed

`app/api/contacts/request/route.ts` resolved `invite` with
`inviteToken ? await resolveInvite(...) : null` and then folded every failure
— no token, an invented one, an expired one, a revoked one, a buddy token —
into the same `202 {"status":"accepted"}`. That is right for the last four
(a *wrong value*, where telling the caller apart from success would make the
route an oracle for guessing live tokens) and wrong for the first (a
*malformed request*, where the caller already knows they sent no token, so
refusing discloses nothing about any token).

Fixed by splitting the check: a body whose `invite` field is absent or an
empty string now gets `400 {"error":"invalid_invite", "message": "..."}`
*before* `resolveInvite` is ever called. Everything that reaches
`resolveInvite` — invented, expired, revoked, or a buddy token — is
unchanged and still answers the uniform `202`.

`/api/contacts/*` is not part of the documented API contract
(`lib/api/openapi.ts` only covers `/api/v1/**` and `/api/auth/**`), so no
`openapi.ts` change was needed — confirmed by grepping for `contacts/request`
there (no hits).

**Checked the other uniform-answer endpoints, as asked:**
- `app/api/contacts/redeem/route.ts` — already distinguishes: a missing or
  bad `token` answers `202 {"status":"expired"}`, never `{"status":"accepted"
  }`/success-shaped, because the landing page it's posted from has *already*
  told the visitor in words that the link may be dead. B801's complaint (a
  claim of success that didn't happen) doesn't apply there — left unchanged.
- `app/api/contacts/ask/route.ts` — identity comes from the reader's own
  session, never a body field, so there is no "wrong field name" for a token
  to go missing under. Left unchanged.
- `app/api/auth/request/route.ts` — a missing/malformed `email` or `user`
  currently folds into the same uniform `202` as an unrecognised address, for
  the same "does this leak who's registered" reason `/api/contacts/request`
  used to lean on. Whether a syntactically-invalid email can safely be
  refused by name (it doesn't depend on whether any account uses it) looked
  like the same shape as this ticket, but is a separate route with its own
  callers and tests — out of scope here. Captured as a new backlog ticket
  rather than folded into this diff (see below).

## Evidence per acceptance line

- "A request with no invite token is refused and says which field is
  missing." — `test/contacts.test.ts`, new cases `"no token at all"` and
  `"an empty token"` under the loop titled `"is refused as a missing field,
  writes nothing"`: POSTing with `invite: undefined` or `invite: ""` now
  returns `400` with `{"error":"invalid_invite"}`, and asserts zero contacts
  and zero codes written.
- "A request with a wrong token still answers exactly like one with a right
  token." — unchanged pre-existing tests in the same file: `"a live
  invitation still writes a pending row"` (real token → `202
  {"status":"accepted"}`), `"an invented token creates no contact and sends
  no code"` (wrong token → `202 {"status":"accepted"}`, same body/status,
  now covered by its own loop after the missing-field cases were split out),
  and `"a revoked token creates no contact, and is answered like a live
  one"` (byte-identical body and status to a real token). All pass.

## Backlog capture

B1026 — the same missing-vs-wrong-value question for `/api/auth/request`'s
`email`/`user` fields, filed rather than folded into this diff since it is a
different route with its own tests and blast radius.

## Verification

`npx vitest run test/contacts.test.ts test/invite-links.test.ts
test/redeem-mail-off.test.ts test/contacts-request-timing.test.ts` — all
pass (136 tests).

`npm run verify` (full, with build) passed build, tsc, eslint, and got to
vitest; that run hit three unrelated timeouts under heavy concurrent load
from other worktrees on this machine (`generator-output.test.ts`,
`locales.test.ts`, `media-upload.test.ts` — each times out at exactly
30000ms mid-suite) plus one pre-existing failure in
`test/task-ids.test.ts` caused by this worktree's branch point being behind
the shared `main` (five `wont-do` task files were re-filed on `main` after
this branch was cut). All four were confirmed unrelated to this change by
re-running each file in isolation: the three timeout files pass cleanly
alone, and `task-ids.test.ts` also passes on `main` directly. A follow-up
`npm run verify -- --quick` (honest here — no route added, moved or deleted)
came back with only the same pre-existing `task-ids.test.ts` drift, nothing
else.
