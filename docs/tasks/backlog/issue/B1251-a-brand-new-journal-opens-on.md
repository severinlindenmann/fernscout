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

- Make the threshold strictly below the grant, so a new journal is not born in
  it. Whatever number is chosen, the invariant worth stating in the code beside
  `SIGNUP_CREDIT_GRANT` is that the two must not meet.
- Consider whether the *first* balance deserves a different sentence entirely —
  "10 credits to start with" is the same fact without the alarm — but that is a
  second decision and can be split out.
- Not in scope: the value of the grant, which `lib/credits.ts` argues for at
  length.

## Acceptance

- Create a journal on a fresh instance and open the helper: no coral panel, and
  the balance pill is the ordinary navy treatment.
- Spend down to the low threshold and both appear.
