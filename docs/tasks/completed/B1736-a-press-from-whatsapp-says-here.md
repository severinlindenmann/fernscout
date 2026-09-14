---
id: B1736
title: A press from WhatsApp says Here is the link and sends no link
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper
found: "2026-09-14T14:50:07Z"
started: "2026-09-14T15:50:54Z"
merged: "2026-09-14T16:26:11Z"
completed: "2026-09-14T16:33:09Z"
---

# B1736 — A press from WhatsApp says Here is the link and sends no link

## Why

**Valid**, revalidated 2026-09-14 against the code on disk:
`lib/whatsapp/proposalExecution.ts:105` was `if (response.ok) return { ok: true }`
with the body parsed only on the failure path, and
`lib/whatsapp/dispatch.ts:1011` built its confirmation from `pending.done` and
the enrichment nudge alone. `app/api/helper/[user]/invite/route.ts:92` returns
`url`; `components/HelperAsk.tsx:110` is the web reader of that same field.

Live, on `severin`, 2026-09-14 12:05 UTC. An `invite_guest` proposal was
accepted from the WhatsApp buttons. The press succeeded — the journal log says
`pressed invite_guest from WhatsApp`, and `contact_invites` holds the row
(`93cf119c…`, guest, expires 2026-10-14, unused). What went back to the phone
was `agent.tool.inviteGuestDone`, which in German opens with **"Hier ist der
Link"** and is followed by nothing. The owner had to go looking for a link the
message had just promised.

The cause is one line. `lib/whatsapp/proposalExecution.ts:pressProposal` ends
with `if (response.ok) return { ok: true }` — the route's JSON body is thrown
away. `app/api/helper/[user]/invite/route.ts` returns `url` in that body, and
on the web `components/HelperAsk.tsx:previewOf` reads exactly that field and
renders a `link` block. WhatsApp has no equivalent, so the one piece of
information the whole flow exists to produce never leaves the server.

`invite_guest` is the sharpest case because its `done` sentence names the link
outright, but the hole is generic: every pressable tool whose route answers
with a `url` (see `previewOf`'s comment — the invite link, the postcards
preview, the photobook maker) loses it on this channel. A link shown once, at
issue, and then not shown, is a link that does not exist: `invites` deliberately
never repeats a token, so the only recovery is `/<user>/contacts`, which
`listInvitesWithLinks` backs.

## Work

- Widen `PressResult` to carry the route's parsed body (or just its `url`).
- In `dispatch.ts:handleProposalReply`, append that `url` to `pending.done`
  when there is one, the way `previewOf` appends its `link` block on the web.
  One URL on its own line is what a person can long-press and forward.
- Do not special-case `invite_guest`; the web path is field-driven and this
  should be too.

## Acceptance

- Accepting an `invite_guest` proposal from WhatsApp returns the invite URL in
  the confirmation message, in `inviteLinkUrl`'s own guest shape
  `/<user>/invite/guest/<token>` (the ticket first guessed `/<user>/i/<token>`,
  which is the *personal* invite's path — `lib/contacts/invites.ts:179`).
- A pressed tool whose route answers without a `url` is unchanged — covered by
  the existing "tapping accept" test, which still asserts `create_trip`'s
  confirmation verbatim. A second test of the same thing only tripped the
  route's own per-IP rate limit, so it was dropped rather than kept green by
  widening the limit.
- A test in `test/whatsapp-proposal-press.test.ts` presses a real
  `invite_guest` proposal through the real route and asserts the link is in
  the message that goes out.
