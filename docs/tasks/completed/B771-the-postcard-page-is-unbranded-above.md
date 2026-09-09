---
id: B771
title: The postcard page is unbranded above the send block, unlike every page the photobook shows
type: FEATURE
priority: medium
complexity: low
area: postcards, brand
found: "2026-09-07T00:00:00Z"
merged: "2026-09-07T14:26:40Z"
completed: "2026-09-09T16:45:14Z"
---

# B771 — The postcard page is unbranded above the send block, unlike every page the photobook shows

## Why

Asked for after the photobook's own pass: *"can you also bring the same feel
and look to the postcard generator?"*

`/[user]/postcards/[id]` is where an owner looks at a card and decides to spend
credits on it, and it is dressed in nothing. `rounded border`, `opacity-70`,
`text-black/50`, `text-lg font-semibold` — four brand tokens in 565 lines, all
four of them inside the send block, which got its own pass when the money
moved there. Everything above it is the unstyled default: the heading is not
`font-display`, the notices are a grey box rather than the yellow panel every
warning on the photobook page uses, the message form's inputs are hairline
grey, and the save button is a bordered rectangle where every other action on
the site is a pill.

The comparison is direct and it is what prompted this:
`BookLevelView.tsx` carries 22 brand tokens; this page carries 4.

Nothing here is a layout problem. The page's *structure* — the two cards side
by side, the message form under them, the recipients, then the one button that
spends — is right, and the reasoning behind each part is written down in the
file. It is the surface.

## Work

- The photobook composer's own vocabulary, applied to the page above the send
  block: `font-display` headings in `navy-900`, secondary type in `navy-600`,
  the warning panel for every notice (`border-yellow-300 bg-yellow-50
  text-yellow-900`), `rounded-lg border border-navy-200 bg-white` for the
  message form, pill buttons with `min-h-11`, and inputs that match the
  settings panel's.
- Mobile first, as the photobook's flow now is: a save button that is a real
  tap target, inputs that fill the width at 390px.
- Not doing: the structure, the copy, or the send block, which is already
  dressed and is the one thing on this page that has been thought about
  twice. Not doing `/[user]/contacts` either — it carries *zero* brand tokens
  and is the same fault one page over, but it is a separate capture.

## Acceptance

- No `opacity-70`, `text-black/50` or bare `rounded border` left on the page.
- Looked at in a browser at 390px and at desktop width against the photobook
  composer, per `test-in-a-browser`: the two pages read as one product.

## Findings (2026-09-07)

The photobook composer's own vocabulary, applied above the send block: heading
in `font-display`/`navy-900`, secondary type in `navy-600`, every notice in the
yellow panel the photobook warns in, the message form as
`rounded-lg border border-navy-200 bg-white`, inputs matching the settings
panel's, and a pill save button with `min-h-11` that fills the width on a
phone.

Two decisions worth naming:

- **The drawn card keeps white paper and black ink.** It is a picture of a
  postcard, not a panel of the interface, so only its *frame* joined the rest
  (`rounded-lg border-navy-200`, a small shadow). `text-black/50` on the
  signature stayed for the same reason.
- **The cost block became the photobook's order block** — heavy, cream, since
  it is the same thing: what this costs and the button that spends. The
  confirmation panel *inside* it inverted to white-on-cream, or a heavy panel
  would have sat inside a heavy panel with neither reading as the louder one.

**Looked at**, per `test-in-a-browser`, at 390px and at 1100px against the
photobook composer. They read as one product now. Seeding a real order to look
at took a contact through `requestContact` → confirm → `approveContact` →
`updateContactByOwner`; worth knowing for the next person, since an unapproved
or address-less contact renders the page's "going to 0 people" branch instead.

`npm run verify`: all four passed (4617 tests).

**Left undone:** `/[user]/contacts`, which carries zero brand tokens — B772,
captured rather than absorbed.
