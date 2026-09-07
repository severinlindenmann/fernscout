---
id: B751
title: The striped handover box shouts louder than anything it sits beside, and it is on the page up to four times
type: FEATURE
priority: medium
complexity: medium
area: landing, agent, brand
found: "2026-09-07T15:30:00Z"
started: "2026-09-07T13:20:24Z"
session: ccdd5120-0eb0-4abf-b76e-a6fd8e5005d8
claimed: "2026-09-07T13:20:24Z"
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
