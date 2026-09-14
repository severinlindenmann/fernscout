---
id: B1736
title: A press from WhatsApp says Here is the link and sends no link
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper
found: "2026-09-14T14:50:07Z"
started: "2026-09-14T15:50:54Z"
session: 47321abb-ce05-46ca-8dfe-58c5b70fa908
claimed: "2026-09-14T15:50:54Z"
---

# B1736 — A press from WhatsApp says Here is the link and sends no link

## Why

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
  the confirmation message, and opening it reaches `/<user>/i/<token>`.
- A pressed tool whose route answers without a `url` is unchanged.
- A test in `test/` drives `handleProposalReply` over a stubbed route that
  answers `{url}` and asserts the URL is in the sent body.
