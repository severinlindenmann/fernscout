---
id: B982
title: "The send flow jumps: pressing send reloads the page instead of posting the card"
type: FEATURE
priority: medium
complexity: medium
area: Postcards
found: "2026-09-08T16:17:16Z"
---

# B982 — The send flow jumps: pressing send reloads the page instead of posting the card

## Why

`/<user>/postcards/<id>` is the one page in this product where a person spends
money, and every step of it is a document load.

- `components/PostcardSheet.tsx` finishes with `window.location.assign(url)` —
  a hard load out of the composer into the preview.
- The send button posts a `<form method="post">` and takes a 303 back
  (`lib/postcard/redirectBack.ts`): the page flashes white, re-renders from
  scratch, and the reader is put wherever `#send` lands them. B850 and B892
  each chipped at this; the *send itself* is still the one press that reloads.
- "Buy credits" is a bare `<a href>` to `/<user>/me`, another full load.

So the sequence a person actually walks — compose, look, press, press — is four
white flashes, and the most consequential press of the four looks exactly like
a page that has gone wrong. Nothing marks the one moment in the flow where
something physically leaves: the cards go to the printer and the interface just
re-renders.

`components/EnvelopeFly.tsx` already draws that moment (B753, for a sign-in
code) and is used on one page.

## Work

- `app/[user]/postcards/[id]/send/route.ts` answers JSON when asked, via the
  `wantsJson`/`answerJson` pair `redirectBack.ts` already exports for the
  message route. Same route, same guards, same refusal words.
- New `app/[user]/postcards/[id]/PostcardSend.tsx`: the cost line, the confirm
  step and the button, as one client component. Confirm expands in place
  instead of navigating to `?confirm=1`; the press is a `fetch`; on success the
  envelope flies from the button and `router.refresh()` brings the rest of the
  page (heading, "already sent", the back going read-only) up to date without a
  load.
- **The no-JavaScript path is unchanged and is still the real one**: the same
  `<form method="post" action=…>`, the same `?confirm=1` link behind
  `preventDefault`, the same 303. B466's two-press guard is untouched — nothing
  can send on the first press with or without JavaScript.
- Soft-navigate the two remaining hard loads: `router.push` out of the
  composer, `Link` on "Buy credits".

Not doing: any change to what sending *is* — `sendOrder`, the credit spend, the
claim, the receipt. Not touching `PostcardBack` or the cropper, which B773 and
B892 already made live.

## Acceptance

- Pressing send on a sendable order prints nothing to the network log but one
  `POST …/send`, and the page never navigates: no `pageshow`, no scroll jump.
- The envelope flies from the button that was pressed, once, and not under
  `prefers-reduced-motion`.
- After it lands the heading reads "Postcards, sent" and the back is read-only,
  without a reload.
- With JavaScript disabled the whole flow still works exactly as it does today,
  two presses and a redirect.
- A failed send (no credits) shows its own sentence in the box and leaves the
  order sendable.
