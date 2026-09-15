---
id: B1805
title: The resume screen shows a deletion timestamp nobody can read at a glance, and no way to let a run go early
type: FEATURE
priority: medium
complexity: low
area: extract, resume
found: "2026-09-15T16:56:21Z"
started: "2026-09-15T16:56:49Z"
merged: "2026-09-15T17:37:03Z"
---

# B1805 — The resume screen shows a deletion timestamp nobody can read at a glance, and no way to let a run go early

## Why

The resume screen tells a person when their photographs will be deleted like
this:

> Fotos werden bis 17/09/2026, 15:39:28 aufbewahrt.

Two problems with that line.

**Nobody reads a timestamp as a duration.** "Until 17/09/2026, 15:39:28" makes
somebody do arithmetic against today's date and the current time to learn the
only thing they want to know: *how long have I got?* The seconds are precision
nobody asked for and the date needs a calendar. The expiry rule this feature was
built around is already phrased as a duration everywhere else — the warning mail
says "24 hours left", the design's own welcome-back screen says "safe for 41
more hours". The one screen a person actually stands on says neither.

**There is no way to let a run go.** Somebody who uploaded the wrong folder, or
finished with a run they do not want to keep, can only wait two days for the
sweep. Meanwhile it sits on the resume screen every time they open the import,
offering to continue something they have mentally abandoned. `removeRun` exists
in `lib/staging/store.ts:62` and nothing exposes it.

## Work

**A countdown that ticks.** Replace the timestamp with the time remaining,
updating live. Scale the precision to the urgency rather than showing seconds
for two days: days and hours when it is far out, minutes under a few hours,
seconds only in the last one. Tick at the rate the displayed precision needs —
a per-second re-render of a list that says "2 days left" is wasted work on a
phone.

Two cases to get right, because both are reachable:

- **Zero.** The sweep runs when somebody starts a run, not on a timer, so a run
  can outlive its own deadline. At zero the line says the photographs are about
  to be cleared — never a negative number, never a stale positive one.
- **Extended.** Continuing a run extends it once, and the countdown must reflect
  the new deadline rather than the one it was rendered with.

**A way to destroy a run now.** A control per run that deletes it and its
photographs immediately.

- It is destructive and irreversible, so it goes through
  `components/ConfirmPanel.tsx` with an action-specific button — this repository
  forbids `window.confirm` outright. Read its props; it takes a `question`,
  `details`, and a `confirmLabel`.
- The confirmation must say what is actually lost and what is not: the staged
  photographs go, and **days already committed are part of the journal and
  stay**. That sentence appears three times already in this feature; reuse the
  existing key rather than writing a fourth.
- A new owner route, the same shape as its siblings: `isEnabled("extract")` then
  `isHelperOwner`, cookie not bearer, 404 when the capability is off. `removeRun`
  does the work.
- Do not offer it as the same weight as "Continue". Continuing is the ordinary
  action; destroying is the rare one, and the visual weight should say so.

**Real en/de/hu** for every string, then `npm run i18n:keys`. A count beside a
noun needs `tn()` and a `.one` entry.

## Acceptance

- The resume screen shows time remaining, ticking, with precision that scales as
  the deadline approaches.
- A run past its deadline reads as about-to-be-cleared rather than showing a
  negative or stale figure.
- An extended run shows the extended deadline.
- An owner can destroy a run from the resume screen, through a confirmation that
  names what is lost and what is kept, and the run and its staged files are gone
  afterwards — asserted on disk, not on the response.
- A stranger and a guest cannot reach the delete route.
- Checked in a browser at 390px in both themes with more than one run listed.

## Related

The expiry rule is B1751's; the resume screen is B1803's. This is neither's bug —
both shipped what they specified, and what they specified was a timestamp.
