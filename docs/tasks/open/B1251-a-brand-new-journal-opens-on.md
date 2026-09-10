---
id: B1251
title: A brand new journal opens on a red nearly-out-of-credits alarm, because the grant equals the threshold
type: ISSUE
priority: high
complexity: low
area: helper, credits
found: "2026-09-10T09:47:41Z"
---

# B1251 — A brand new journal opens on a red nearly-out-of-credits alarm, because the grant equals the threshold

## Why

The first screen a person sees after creating a journal on fernscout.ch carries
a red-bordered coral panel:

> Your credits are nearly used up — about ten more written days. **Buy credits**

and the balance pill in the header is filled coral-600 with white text — the
same treatment the room uses for a problem. Nothing has been written yet. The
journal is ninety seconds old.

The cause is arithmetic, not judgement. `SIGNUP_CREDIT_GRANT = 10`
(`lib/credits.ts:375`) and `const lowCredits = credits !== null && credits <= 10`
(`components/HelperRoom.tsx:450`). The threshold is inclusive and equal to the
grant, so **every journal on this instance begins in the alarm state** and can
never be seen out of it without buying.

What it costs is the opening move of the product. A person who has just been
told the free tier is generous — the landing page's "Free, forever" card lists
unlimited trips and days — arrives to a red warning and a Buy link before they
have written a sentence. It also spends the alarm: by the time credits genuinely
are nearly gone, the panel has been on screen since the first day and reads as
furniture.

Found by driving signup at 390px on 2026-09-10; the panel and the red pill are
both in the first viewport (screenshot in the run).

## Work

**Decided: the warning fires at 5 credits.** (Severin, 2026-09-10, at triage.)
So `lowCredits` becomes `credits <= 5` against a `SIGNUP_CREDIT_GRANT` of 10 —
half the grant spent before the alarm, and a new journal is not born in it.

- Change the threshold in `components/HelperRoom.tsx:450` to 5.
- State the invariant in the code beside `SIGNUP_CREDIT_GRANT`: the threshold and
  the grant must not meet. A future change to either has to keep that true, and
  the comment is what tells the next person why the two numbers are related at
  all.
- The sentence itself needs re-checking against the new number.
  `agent.room.lowCredits` reads *"Your credits are nearly used up — about ten
  more written days."* At a threshold of 5 that says ten when it means five, so
  the string is now wrong in all three locales — either make it count, or say
  something that does not name a number.
- Not in scope: the value of the grant, which `lib/credits.ts` argues for at
  length; and whether the *first* balance deserves a different sentence, which
  is a separate decision.

## Acceptance

- Create a journal on a fresh instance and open the helper: no coral panel, and
  the balance pill is the ordinary navy treatment.
- Spend to 6 credits: still no alarm. Spend to 5: the panel and the coral pill
  both appear.
- The warning's own sentence does not claim a number of days the balance does
  not carry, in English, German or Hungarian.
