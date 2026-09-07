---
id: B773
title: The postcard's words only reach the card when a Save button is pressed
type: FEATURE
priority: medium
complexity: medium
area: postcards, composer
found: "2026-09-07T00:00:00Z"
---

# B773 — The postcard's words only reach the card when a Save button is pressed

## Why

Asked for while B771 was dressing the same page: *"update when typing text /
auto save"*.

The postcard page draws the back of the card at print size, directly above a
form that changes what is written on it — and the two do not talk. Typing in
the textarea changes nothing on the card; pressing **Save the back** posts the
form, the server redirects, the page reloads, and only then does the drawing
catch up. So the one thing the page exists for — *seeing* what will be
printed — is behind a button and a page load.

The photobook composer next door has answered this since it was built: change
an option and the preview re-plans, debounced, with no button anywhere. This
is the same page in the same product asking the same question.

There is also a real risk in the button: the words are a draft, the order
expires in a week, and an owner who types a better sentence and closes the tab
loses it with no warning that they had to press anything.

## Work

- The message, the signature and the figures switch become client state, and
  the drawn back renders from that state — so the card follows the typing with
  no round trip at all.
- Autosave on a debounce, to the route that already exists
  (`/[user]/postcards/[id]/message`), with a line that says where it stands:
  saving, saved, or could not save. Never silent.
- The form keeps working with no JavaScript: it is still a `<form method=post>`
  with a submit button, and the button stays for that path.
- The route answers a fetch with JSON rather than a redirect, and keeps
  redirecting for a real form post. Everything it refuses today — an agent's
  token, a non-owner, an order that has left `draft` — it goes on refusing
  identically; this is a second way to ask, not a second set of rules.
- Not doing: autosaving the crop. `PostcardCropper` already saves itself, and
  the photograph is fixed once the order exists.

## Acceptance

- Typing changes the drawn card immediately, with no request.
- Stopping typing saves within a second or so, and the page says so.
- With JavaScript off, the form and its button behave exactly as they do now.
- A card whose order has been sent cannot be edited by either path.
