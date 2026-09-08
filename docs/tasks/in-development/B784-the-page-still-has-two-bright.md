---
id: B784
title: The page still has two bright buttons even though the card has one
type: ISSUE
priority: low
complexity: low
area: agent, ui
found: "2026-09-07T14:29:54Z"
started: "2026-09-08T21:14:15Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:14:15Z"
superseded: "B984 — /agent no longer renders the journal card (or AgentHandover) this ticket was about; see below."
---

# B784 — The page still has two bright buttons even though the card has one

## Why (original)

B767 made the journal card have exactly one bright control. The *page* still
has two: `components/AgentHandover.tsx:112` renders a second `bg-yellow-400`
button ("Schlüssel und Anleitung holen") below the rule on the same screen.

So the work that gave the person one obvious thing to press is undone a scroll
further down by a button of equal weight offering something only a technical
person wants.

The component is shared with `/<user>/me` and `/<user>/trips`, which is why
B767 left it alone: recolouring it is a decision about three pages, not one.

## Work (original)

Decide what weight the bring-your-own-agent panel carries on each page it
appears on. On `/agent` it is the second door and should look like it; on
`/<user>/me` it may well be the primary thing. A variant prop is probably
enough.

## Acceptance (original)

`/agent` has one bright button on the whole page.

## Triage 2026-09-08 — stale, superseded by B984

Read `app/agent/page.tsx` and `components/AgentDoor.tsx` as they stand today,
before touching anything (this is validation, not the fix).

**The page this ticket describes no longer exists.** B984 ("/agent is the
room", `git log` commits `a68b5b5d`/`bec077f6`, merged 2026-09-08 20:39, i.e.
*after* this ticket was found on 2026-09-07) rebuilt `/agent` so a signed-in
owner with the `helper` capability on lands straight in `HelperRoom` (the
conversation) — there is no journal card, no per-journal button, and no
`AgentHandover` rendered on that path at all. `app/agent/page.tsx` now passes
`AgentDoor` only `siteUrl, docUrl, agentUrl, codeMinutes, signedIn,
identityEmail, signupEnabled` — no `journals` prop exists any more.

`git show a68b5b5d -- components/AgentDoor.tsx` confirms the diff: B984
deleted the entire `{signedIn && journals.length > 0 && (...)}` block that
used to render the yellow "resume/start a day" link, the `HelperAsk` box and
(per the code comments, though it had already stopped literally rendering
`<AgentHandover>` and used `AgentBlock`/`HelperAsk` instead) the second bright
control this ticket named.

What `/agent` shows today (checked by reading the current component, not
assumed):
- Signed out, `signup` off: `IdentitySignIn` (its own button, not yellow) plus
  the bring-your-own-agent note collapsed behind a `<details>` — closed by
  default, so its `bg-yellow-400` button (`AgentBlock`, `components/LandingSections.tsx:64`)
  is not on screen at all until a reader opens it.
- Signed out, `signup` on, before choosing: one `bg-yellow-400` button
  ("have a journal") and one navy-bordered outline button — one bright
  control.
- Signed in with a journal and the helper on: `HelperRoom`, not `AgentDoor`,
  entirely outside this ticket's page.
- Signed in with no journal, or helper off: `SignupWizard` / a plain sentence,
  plus the same collapsed `<details>` panel as above.

So the acceptance line — "`/agent` has one bright button on the whole page" —
already holds, for a reason unrelated to anything this ticket asked for: the
screen that had two was deleted by B984, not recoloured. `AgentHandover`
itself is unchanged and still renders its own `bg-yellow-400` button, but only
on `/<user>/me` and `/<user>/trips` now (`app/[user]/me/MePageContent.tsx:908`,
`app/[user]/trips/TripsIndexContent.tsx:385`) — pages this ticket never
objected to (B767's card was `/agent`'s, and the ticket's own Why says
`/<user>/me` may fairly keep it primary).

**Not related to B1021** (the room-opening dot / `bg-yellow-400` count on the
helper preview) — different component (`RoomOpening.tsx`/`StoryPager.tsx`),
different page, different bright element. No overlap.

**Left behind by B984 and worth its own ticket, not this one's job:**
`components/AgentDoor.tsx` still imports `AgentHandover`, `AgentRow`,
`HelperAsk`, `Link` and exports the now-unused `AgentJournal` type and
`LOW_CREDITS` constant — all dead since the block above was deleted.
`npx eslint components/AgentDoor.tsx` reports 8 `no-unused-vars` warnings.
Filed separately as B1033 rather than folded into this already-stale ticket.

No code changed for B784 itself — the fault it names does not exist on the
page as it stands today.
