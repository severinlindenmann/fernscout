---
id: B876
title: The account page's pointer card on /me is a whole card to say a menu entry exists
type: ISSUE
priority: low
complexity: low
area: account, me
<<<<<<< HEAD
found: "2026-09-07T17:41:41Z"
=======
found: "2026-09-07T19:45:00Z"
>>>>>>> b-me-pointer
---

# B876 — The account page's pointer card on /me is a whole card to say a menu entry exists

## Why

<<<<<<< HEAD
TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO
=======
The owner: *"remove that one from /me"*, pointing at the "Guthaben & Speicher"
card.

B821 moved credits and storage onto their own page and left this card behind
deliberately — *"leave a way through from `/me`, since that is where people
have learnt to look"*. That was a reasonable transitional courtesy and it has
outlived it: B821 also added a menu destination, so the page has a permanent
way in that does not cost a card. What is left on `/me` is a heading, a
sentence explaining that the content is elsewhere, and a yellow button — the
same visual weight as the panels that carry actual figures, spent on a
signpost.

## Work

- Remove the card from `app/[user]/me/MePageContent.tsx`, and the `Wallet`
  import it was the only user of.
- `me.accountCardTitle` and `me.accountOpen` become unused: drop them from all
  three locales and regenerate `lib/i18n.ts`. **`me.accountCardBody` stays** —
  the account page itself uses it for the case where neither figure has
  anything behind it.
- `test/access-panel.test.tsx` asserted the card's presence; it now asserts its
  absence, and keeps B821's real guarantee — that the figures are not on `/me`.
- The account page's own doc comment described the card; correct it rather
  than leave a comment about something that is gone.

Not doing: anything to the account page, or to the nav entry that now carries
the whole job.

## Acceptance

- `/me` has no account card and no link to `/account`.
- The figures are still only on the account page.
- The nav entry still reaches it.
- No orphaned locale keys.
>>>>>>> b-me-pointer
