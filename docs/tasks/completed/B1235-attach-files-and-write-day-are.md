---
id: B1235
title: attach_files and write_day are refused as web-only on WhatsApp, and they are the channel's core flows
type: ISSUE
priority: high
complexity: low
area: whatsapp, helper
found: "2026-09-10T06:06:23Z"
merged: "2026-09-10T06:32:55Z"
completed: "2026-09-10T15:12:34Z"
---

# B1235 — attach_files and write_day are refused as web-only on WhatsApp, and they are the channel's core flows

## Why

`lib/whatsapp/proposalExecution.ts`'s `ROUTE_BY_TOOL` opted in eight tools
when B1230 shipped it, and left `attach_files` and `draft_words` (the tool
behind "write_day") out for a reason its own doc comment called "not yet
exercised" rather than money. On the owner's live walkthrough on
2026-09-10, tapping "Auf den Tag legen" (an `attach_files` proposal) logged
`press of attach_files refused: web_only` and the chat read *"Das braucht
das Web — öffne das Journal, um es dort abzuschließen."*; asking for a day
to be written up deflected to the web with a bare `/agent` link. Both are
this channel's two core flows — putting a photo on a day, and writing one
up — refused on the channel they exist for.

The exclusion had already been overtaken by the owner's own decision on
B1061: "writing a day up, captioning and transcribing spend credits from
WhatsApp exactly as they do on the web," so "spends a credit" was never a
reason to keep `draft_words` off the list. Nothing else about the tool
registry (`lib/helper/tools/areas/*`) had been walked since to see what
else the same stale reasoning was still holding back.

## Work

Widened `ROUTE_BY_TOOL` from 8 tools to 18, walking every area of the
registry. Added: `attach_files`, `draft_words`, `set_day_words` (without
which `draft_words` drafts something nobody can ever keep — the note it
writes tells the model to call `set_day_words` next), `add_cost`,
`set_rate`, `set_budget`, `invite_guest`, `revoke_invite`, `tell_readers`,
`channels`, `journal_settings`. Left excluded, and documented why in the
file's own module comment: postcards/photobook (`propose_postcards`,
`photobook`, `print_order` — a real order at a printer), buying room or
credits (`buy_room`, `buy_credits` — nothing an agent holds can pay),
anything deletion-shaped (`remove_photo` deletes the kept original with no
undo, `discard_file` throws inbox bytes away for good, `revoke_key` ends an
agent's own access, `cleanup` is the operator's storage broom).

`describe_photos` — named in the ticket brief alongside `draft_words` — is
**not** in the list and cannot be: it is not a `Tool` in
`lib/helper/tools/registry.ts` at all. A browser button posts to its route
directly; the model never proposes it, so there is no `Proposal` whose
`tool` field could ever be `"describe_photos"` for this file to press.
Giving it a `ROUTE_BY_TOOL` entry would be a route nothing can reach.
Building a model-tool wrapper for photo captioning so WhatsApp could reach
it at all is a bigger feature than "widen the allowlist" and is out of this
ticket's scope — captured separately as B1238.

Every added route was checked for how it reads its request: all of them
read `request.json()` the same way `create_trip`'s route already does, so
`pressProposal`'s existing generic mechanism (POST `proposal.arguments` as
the JSON body) needed no special-casing.

Added the credits refusal `pressProposal` can now actually hit:
`handleProposalReply` in `lib/whatsapp/dispatch.ts` used to answer every
non-`web_only` failure with the generic `wa.proposalFailed` ("that couldn't
be saved"). A `draft_words` press that cannot pay now gets the
`wa.balanceRefusal` sentence instead — the same one-sentence, cost-and-
balance shape a voice note that cannot pay already gets — via a small
`CREDIT_COST_BY_TOOL` map (`{ draft_words: WRITE_DAY_CREDITS }` today; a
tool without a known fixed cost still refuses `no_credits` correctly, just
with the plainer sentence).

## Acceptance

- `npx vitest run test/whatsapp-proposal-press.test.ts` — two new cases:
  pressing `attach_files` really moves a staged photograph onto a day
  through the real route (`runAsCaller`, no second implementation), and
  pressing `draft_words` on a fresh (zero-balance) journal answers with the
  cost and the balance rather than "couldn't be saved".
- `npx vitest run test/whatsapp-render.test.ts test/whatsapp-model-turn.test.ts`
  — unaffected, still green.
