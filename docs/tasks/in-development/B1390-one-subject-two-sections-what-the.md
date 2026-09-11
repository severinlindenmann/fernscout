---
id: B1390
title: "One subject, two sections: what the helper does with your words is drawn twice on /me"
type: ISSUE
priority: medium
complexity: low
area: the owner's own page
found: "2026-09-10T19:41:00Z"
started: "2026-09-11T06:40:39Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:39Z"
---

# B1390 — One subject, two sections: what the helper does with your words is drawn twice on /me

## Why

The foot of `/<user>/me` carries two sections, one under the other, with
identical chrome (`mt-10 border-t border-navy-200 pt-6`, same heading size,
same muted body):

- **"Deine Gespräche"** — `components/SessionsConsent.tsx`, rendered at
  `MePageContent.tsx:1138`. A checkbox: *Wir lesen mit, um Fernscout zu
  verbessern.*
- **"Was du dem Helfer zu senden erlaubt hast"** — `components/HelperConsentList.tsx`
  at `:1148`. A dated line and a card per grant, each with *Diese Erlaubnis
  zurückziehen*.

They are the same subject: what leaves this journal and reaches a model or the
operator. A reader has to notice the two headings, read both, and work out for
themselves that "reading along to improve Fernscout" is a fifth permission of
the same kind as "meine Stimme aufschreiben lassen" — which it is.

**Underneath, it already is one thing.** `lib/helper/consent.ts` has one record
per journal with one `agreedAt`, and `HELPER_SCOPES` is five entries with
`sessions` among them (`:70`). Both controls call the same route,
`/api/helper/<user>/consent`, with a `scope`. The split exists only in the
page.

Three things it costs, beyond looking like two settings:

1. **Each section hides independently.** `SessionsConsent` renders when
   `sessionsShared !== null`; `HelperConsentList` returns `null` at `:63` on an
   empty list and is gated again at `:1148`. So a person who has never used the
   wizard sees "Deine Gespräche" alone, with nothing saying the other four
   permissions exist or that they have none. There is no one place that answers
   *what does this journal send anywhere*.
2. **The date belongs to the record, not to the list.** `me.consentBody` says
   *Zuletzt zugestimmt am …* under the second heading only, while the instant
   it names covers `sessions` too. Under the current layout it reads as though
   it does not.
3. **Two copies of one explanation.** `me.sessionsBody`, `me.sessionsOffNote`
   and `agent.room.kept` already say overlapping things about saved
   conversations in three places, and the day one is edited they disagree.

## Work

Draw it as **one section**: one heading, one sentence, one dated line, and the
permissions below it — the four grants and the read-along switch in the same
list, in the same visual language.

**What must survive the merge, because the two controls are deliberately not
the same mechanism** — `HelperConsentList`'s own header comment (`:20-23`) is
the record of why `sessions` was kept out, and that reasoning is still right
even though the conclusion here changes:

- `sessions` **starts on** and toggles both ways. The other four start **off**,
  are granted only by the wizard's own question (B684), and are one-way here:
  this page revokes, it never grants. A merged list must not flatten them into
  five identical switches — that would offer to re-grant "meine Stimme" from a
  page whose job is not to ask, and the button would either lie or fail.
  Different affordance per row (a switch for the one, a withdraw button for the
  others) is correct and is the point; identical framing around them is what
  is being fixed.
- `sessions` names the operator, not a model vendor —
  `currentHelperProvider` returns the site's own name for it (`:150`), so the
  existing `me.consentProvider` line (*geht an Anthropic*, *geht an Deepgram*)
  reads correctly for it without a special case.
- Keep `me.sessionsOffNote`'s sentence — *Ausschalten löscht nichts* — attached
  to that row. It is the one fact a person otherwise gets wrong, and it stops
  somebody believing they deleted their conversations.
- The section must render with **nothing granted**, unlike today: the four
  ungranted permissions are worth naming as not granted, which is the answer to
  point 1 above. Decide whether that is a listed row in a "not granted" state
  or one closing sentence; the mockup is the place to see which reads better.

Language: this is `/me`, so `site/locales/en.json`, `de.json` and `hu.json`
each need whatever the merge adds, plus `npm run i18n:keys`. Retire the keys
the merge makes redundant rather than leaving them unreferenced — `knip` will
find them anyway. Real German and real Hungarian, per AGENTS.md.

**Not in this ticket.** No change to `lib/helper/consent.ts`, to the consent
route, or to what the wizard asks. No change to what any scope means. This is
the page only.

## Acceptance

- `/<user>/me` shows one heading covering all five permissions, at 390px and
  on a desktop width, checked in a browser (`test-in-a-browser`) — the section
  is a drawing, and `verify` cannot see it.
- On a journal that has **never** used the helper, the section still appears
  and says what is not granted. That is the case that shows nothing useful
  today.
- Turning the read-along switch off, reloading, and finding it off; withdrawing
  a grant, reloading, and finding it gone — the same two round trips as now,
  through the same route.
- `npm run verify` clean, including `test/locales.test.ts` and `knip`.
