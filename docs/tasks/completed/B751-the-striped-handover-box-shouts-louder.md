---
id: B751
title: The striped handover box shouts louder than anything it sits beside, and it is on the page up to four times
type: FEATURE
priority: medium
complexity: medium
area: landing, agent, brand
found: "2026-09-07T15:30:00Z"
started: "2026-09-07T13:20:24Z"
merged: "2026-09-07T13:56:00Z"
completed: "2026-09-09T16:44:57Z"
---

# B751 — The striped handover box shouts louder than anything it sits beside, and it is on the page up to four times

## Why

The owner, looking at the live page: *"i dont like this color flashing prompt,
also it is too often on the page, at some points it should just not be."* They
pointed at the calm panel used for the signed-in handover as the treatment
they want instead.

Both halves are right, and they are separate faults.

**It is drawn to be the loudest thing on any page it lands on.** `AgentBlock`
in `components/LandingSections.tsx` paints a 5px `repeating-linear-gradient`
in coral and sky — an airmail border, chosen because it is the one piece of
postal vernacular everybody recognises. As a signature on a page that was
*about* handing a string to an agent it earned its place. It no longer sits on
such a page: since B694 and B732 the first screen is about the helper, and this
block now appears inside a disclosure, beside a sign-in panel, and under a
heading — each of which is quieter than it is. The stripes are also the only
place in the product where a colour is used decoratively rather than to mean
something, which is why they read as flashing rather than as brand.

**It renders in four places.** `components/LandingSections.tsx:246` (inside
the disclosure), `components/AgentDoor.tsx:179`, and
`components/Landing.tsx:205` and `:268`. On `/agent` in particular it sits
near `AgentHandover`, which does the same job better — that panel gives a real
key and the instructions, while this one gives only the public URLs. Two
panels telling somebody how to hand over to an agent, one of which cannot
actually hand anything over, is worse than one.

## Work

**The treatment.** Match the panel the owner pointed at: `cream-50` on the
paper ground, a `navy-200` hairline, `rounded-2xl`, a real heading in
`font-display`, one plain sentence of body copy, and the yellow pill button
that the rest of the page now uses (`PRIMARY_BUTTON`). No stripes, no
gradient. The airmail motif is not the mark and is not protected — but do not
delete `docs/branding/`'s record of it if one exists.

**The heading stops being an all-caps mono kicker.** A tracked-out uppercase
label above a block is decoration standing in for hierarchy; the panel the
owner prefers uses a plain bold heading, and it reads better. The mono voice
stays where it means "this is machine text" — which here is the instruction
itself, not the title above it.

**The instruction stays visible.** B255 is why: a postal-style address and a
sentence fragment used to sit here while the clipboard carried something else,
and a button that copies what you cannot see is the fault that was fixed. Set
it quietly — an inset `cream-100` block, mono, smaller — rather than as the
centrepiece. Visible text and copied text must remain the same string from the
same key.

**Then cut it back to one per page.** Decide per call site and write the
reasoning in the code:
- `/agent` signed in: `AgentHandover` is the real answer; this block should
  not also be there.
- `/agent` signed out: it is the second door and belongs.
- `/` inside the disclosure: it belongs — that is what the disclosure is for.
- `/` signed in (`Landing.tsx:205`): judge it. If the reader already has a
  journal they are not being sold the handover.

## Acceptance

- No page renders `AgentBlock` more than once.
- No `repeating-linear-gradient` remains in `components/`.
- The block reads as quieter than the primary call to action next to it.
- Visible instruction text still equals what the copy button puts on the
  clipboard, asserted by the existing test if there is one.
- Checked at 390px, in German — the instruction is longest there.

## Done

**The treatment** (`components/LandingSections.tsx`, `AgentBlock`): rebuilt to
match `AgentHandover` — `rounded-2xl border border-navy-200 bg-cream-50`, a
`font-display text-xl font-semibold` heading, one sentence of body copy
(`landing.handBody` / `home.helperBody`, new keys, en/de/hu), then the
instruction in an inset `bg-cream-100` mono block (same string, same key as
what the button copies — B255 preserved), then a yellow pill copy button.

**The pill button is a new `CopyLine` variant.** `components/CopyLine.tsx`
gained `variant?: "quiet" | "primary"` (default `"quiet"`, unchanged for
every other caller — `AgentHandover`, `ContactsAdmin`, `BuddyHandover`);
`"primary"` is the yellow pill (`bg-yellow-400`, `border-yellow-600`,
`text-yellow-950`). `AgentBlock` passes `variant="primary"`.

**No more all-caps mono kicker** — was `font-mono text-[11px] uppercase
tracking-[0.18em]`, now `font-display text-xl font-semibold`. Mono stays only
on the instruction block itself.

**Call sites, decided and commented in place:**
- `components/LandingSections.tsx:246` (inside `AgentDisclosure`) — kept, only
  place it renders on this arrangement.
- `components/AgentDoor.tsx:179` — kept, gated on `!signedIn ||
  journals.length === 0`; never renders alongside a journal's own
  `AgentHandover`.
- `components/Landing.tsx` `/` signed out, helper off — kept, it's the only
  door with no helper.
- `components/Landing.tsx` `/` signed out, helper on — moved inside
  `AgentDisclosure` (already covered by the disclosure call site above).
- `components/Landing.tsx` `/` **signed in** — see addendum below; no longer
  a bare `AgentBlock` call at all when the helper is on.

**Addendum, from the owner while this was in flight:** on `/` signed in, with
the helper on, replaced the direct `AgentBlock` call with the same two-door
shape the signed-out page uses — a `PRIMARY_BUTTON` pill to `/agent`
(`home.helperCta`: "Write today's day" / "Heutigen Tag schreiben" /
"Mai nap megírása"), one sentence of body copy (`home.helperBody`), and
`AgentDisclosure` underneath holding the handover material. New `home.*` keys
in all three locales, written for somebody coming back to write rather than
somebody deciding whether to use this at all — no exclamation, no arrow.
Helper off keeps the old direct `AgentBlock` offer, still gated on the reader
owning no journal here (unchanged from the ticket's own "judge it" note).

**Verified in a browser** (Playwright, Chrome for Testing, 390×844):
- `/` signed out, disclosure open, English and German — calm panel, single
  yellow pill, no stripes, German instruction wraps cleanly with no page
  overflow (`scrollWidth` 390).
- `/agent` signed out — same treatment.
- `/` signed in, English and German, disclosure closed then opened — hero
  pill + one sentence + disclosure; opened, the disclosure shows exactly the
  calm `AgentBlock`, once.
- `grep -r "repeating-linear-gradient" components/` → no matches. New test
  `test/no-striped-panels.test.ts` enforces this going forward; also updated
  `test/identity-signin.test.tsx`'s existing (now-inverted) assertion.
