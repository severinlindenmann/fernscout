---
id: B1237
title: The model claims a screen on a channel that has none, and links the bare /agent
type: ISSUE
priority: medium
complexity: low
area: whatsapp, helper
found: "2026-09-10T06:06:25Z"
merged: "2026-09-10T06:33:00Z"
completed: "2026-09-10T15:12:35Z"
---

# B1237 — The model claims a screen on a channel that has none, and links the bare /agent

## Why

`lib/helper/model.ts`'s honesty net checks a claim about a screen or a
button (`ON_SCREEN`, via `claimsAButton`) only when `proposals.length ===
0` — right on the web, where a real proposal really is drawn on a real
screen and "the button below" is then a true sentence. WhatsApp has
neither a screen nor a page in that sense, proposal or not: a chat message
carries at most two reply buttons and a line of text. The live evidence —
*"Ein Vorschlag liegt auf deinem Bildschirm"* and *"Die Seite zum
Hochladen liegt vor dir"* — was said on turns that, respectively, really
did carry two real buttons and really did hand over a real link, and the
existing guard let both through because a proposal (or a block) was
present. B1056's own carve-out for a `choose`/`confirm` block correctly
stopped the guard from calling an honest "press the button" a lie; it had
no way to also catch a claim about a *screen*, because the guard was never
told which channel it was checking.

Separately: `lib/whatsapp/dispatch.ts`'s `answerOnWhatsapp` builds
`journalUrl` as a bare `${serverSite().url}/agent` — no `?c=<session>` —
even though the exact session-linked form already exists three lines away
in the same file's greeting (`agentUrl`, using `sessionId(username,
"whatsapp")`). Every `form`-shaped proposal and every overflowed `choose`
falls back to this bare link, which drops whoever opens it into a fresh
room with no memory of the conversation they were just having.

## Work

`answerInThread` (`lib/helper/model.ts`) takes an eighth, optional
parameter — `channel: "web" | "whatsapp" = "web"` — rather than a second
options object, since one more positional argument was the smaller change
against seven existing call sites. `lib/whatsapp/dispatch.ts`'s own call
now passes `"whatsapp"`; every other caller (the `/api/helper/[user]/ask`
route) is unaffected by the default.

Added `claimsAChatScreen` beside `claimsAButton`: a narrower pattern
(`CHAT_SCREEN_LIE`) matching only "on your screen" / "auf deinem
Bildschirm" / "liegt vor dir" / "in front of you" / "képernyőd" — never
"button" or "press", which stay `claimsAButton`'s own territory so an
honest "press the button" (real buttons drawn this turn) is never touched
by this guard. `amiss()` checks it first and unconditionally when `channel
=== "whatsapp"` — not gated behind `proposals.length === 0` the way the
existing button check is, because a screen or a page is never there on
this channel whether or not a proposal is. A new retry
(`SCREEN_RETRY`) and fallback sentence (`agent.noScreenHere`, added to
`en`/`de`/`hu` and regenerated into `lib/i18n.ts` via `npm run
i18n:keys`) follow the same one-retry-then-plain-sentence shape every
other guard here uses.

`journalUrl` in `answerOnWhatsapp` now reads
`` `${serverSite().url}/agent?c=${await sessionId(username, "whatsapp")}` ``
— the same construction the greeting already used three lines up, so a
`form` or an overflowed `choose` now hands over a link that adopts the
conversation rather than one that starts over.

## Acceptance

`npx vitest run test/whatsapp-model-turn.test.ts` — two new cases: a
turn that calls `create_trip` (a real proposal, real buttons) and then
claims *"Ein Vorschlag liegt auf deinem Bildschirm"* is retried and the
corrected answer goes out with no mention of "Bildschirm"; a turn that
says *"Drücke den Button, um die Reise anzulegen"* on the same
real-buttons turn is left alone, proving the guard does not fire on an
honest button claim.
