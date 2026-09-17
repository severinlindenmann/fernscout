---
id: B1824
title: An import asks for a file before it says why or how
type: FEATURE
priority: high
complexity: medium
area: import, design, i18n
found: "2026-09-16T19:35:05Z"
---

# B1824 — An import asks for a file before it says why or how

## Why

Three of the four import types drop a person straight onto a file picker. No
statement of what they get, no instructions for prising the file out of Google
or Apple, no preview before something is written. The photographs flow has a
real wizard (`components/extract/ExtractFlow.tsx`); the other three do not.

The hardest part is not the picker, it is that **people cannot get the file.**
Google moved Timeline exports onto the phone in 2024, Android and iOS disagree
about the filename and the path, and the iPhone cannot share several contacts at
once. None of that is guessable, and B1826 deletes the documentation that
half-covered it — deliberately, because a person should be taught at the moment
of need rather than sent to a manual.

NN/g's wizard guidance says each step must be **self-sufficient**, needing no
information from elsewhere in the app. Measured against that rule the
`/docs/extract` link at the bottom of the hub is not a helpful extra; it is the
defect.

**Overlaps B1797** (in testing: "the import drops a person onto a bare file
picker with no framing, no way back, and no way in from the journal"). Read its
outcome before scoping this; it may be the same ticket, or this may be its
larger successor. Also overlaps **B1803** (in development on
`components/extract/*`).

Full skeleton, per-type table, the export instructions per platform, and
screen-by-screen copy for location and contacts in English and German:
`docs/plans/2026-09-16-import-onboarding.md`.

## Work

Generalise the photographs wizard into one five-step shape used by all four
types: **why → get it → deliver it → peek → decide**. Only the last step writes.

- **Why** carries the promise, at the question rather than in a footer —
  especially for location history, which is the most sensitive data in the
  repository.
- **Get it** is platform-tabbed, with a screenshot per tap and the exact
  filename to expect.
- **Deliver it** offers two doors of equal weight: send it on WhatsApp, or pick
  it here. The prefilled `wa.me` text and the "attach as **Document**, not as a
  photo" warning are in the plan. **One route to build:** the cookie-side inbox
  listing — `listInbox()` exists in `lib/inbox.ts` but only the bearer
  `GET /api/v2/<user>/inbox` exposes it.
- **Peek** states what was read in real numbers and says plainly that nothing
  has been written. For location it shows the bounding **extent, not the
  route** — drawing the real track there would publish by accident the thing
  the why screen just promised not to show.
- **Decide** is a check-answers screen: every row changeable, and the button
  named after its consequence. Never a generic "Next" or "Continue".

Every failure names the likely cause and a way back — the commonest being a
file sent as a photo rather than a document.

Depends on B1819 (the location flow is pointless while Android exports import
nothing) and on B1822 and B1823 (onboarding wraps a flow that has to finish).

Hungarian is not written and must not be invented.

## Acceptance

- All four types follow the same five steps, with the steps visible and the
  current one marked.
- A person can leave mid-flow and resume.
- Nothing is written before the final button, and that button names the action.
- A file delivered through WhatsApp appears on the waiting page by itself.
- Rows and files that cannot be used are shown with the reason, never dropped.
- Real English, German and Hungarian entries for every new string;
  `npm run i18n:keys` clean.
- Verified in a real browser at desktop and phone width, per type — the suite
  cannot judge whether a sequence reads as why → how → doors → peek → decide.
- `npm run verify` passes.

## Revised 17 September 2026 — this ticket builds the studio's flow skeleton

Per `docs/plans/2026-09-17-the-studio.md`, the five-step shape described above
is not import-specific. It is the shape **every** owner action wears, and the
studio hub (B1829) consumes it.

So this ticket's deliverable widens by one word: the skeleton is general, and
the four import types are its first four users. **B1829 and this ticket should
be taken together** — one is the skeleton, the other is the hub that lists what
wears it.
