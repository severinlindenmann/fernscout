---
id: B441
title: A postcard can only be started by an agent — the gallery has no way in
type: FEATURE
priority: medium
complexity: medium
area: postcards, gallery
found: "2026-09-05T10:52:00Z"
---

# B441 — A postcard can only be started by an agent — the gallery has no way in

## Why

B434 shipped the order flow API-only. An agent composes a set of cards and the
owner sees the *preview* page at the end of it; there is no control anywhere on
the site that starts one. Every other `postcard` string in the frontend is the
**reader's** consent checkbox — "send me a real postcard" on the contact,
invite and manage forms — which is a different thing entirely.

So the owner standing in their own gallery looking at the photograph they want
to post has no way to act on it. Asking an agent works, and is not the same as a
button being there when the thought occurs.

Nothing new is needed underneath it: `POST /api/v1/<user>/postcards` and
`GET …/postcards/recipients` both authenticate through `isOwner(user, request)`,
which accepts the owner's **cookie** as well as a bearer token. The browser can
call the endpoints that already exist and land on the preview page that already
exists.

## Work

- `getAllMedia` (`lib/entries.ts:403`) builds each tile from an entry and drops
  the entry's `slug`. The order needs `trip` + `day` + `photo`; the photo path
  is derivable from `src` and the day is not. Carry `slug`.
- `components/PostcardSheet.tsx`, new, client. Opens with one photo already
  chosen. On open it fetches the recipient list, and fetches
  `/<user>/day/<slug>.md` — the markdown twin that already exists — to prefill
  the message with the day's opening, trimmed to postcard length. Renders a
  textarea, recipient checkboxes showing **name and town only**, a live
  `15 × n` cost, and one **Create preview** button that `POST`s and redirects
  to `/<user>/postcards/<id>`.
  **The sheet never sends.** Sending stays the preview page's button, which is
  the whole point of B434.
- Two entry points, one sheet: a control in `components/Lightbox.tsx` on an
  open photo (**images only**, never a video), and a button in the gallery
  header beside the slideshow that puts the grid into a pick-a-photo state so
  a tile opens the sheet instead of the lightbox.
- **Gate on a prop of its own**, `canSendPostcards = isOwner && postcards on &&
  contacts on`, computed in the gallery's server page. *Not* `canPublish`:
  that already rides in `TripProvider` and happens to equal `isOwner` today
  (`lib/tripGate.ts:126`), and overloading it is how two meanings drift apart.
  Anybody else sees nothing at all — not a disabled button.

**Not doing:** editing an order after creation (make another; the first expires
in a week), and a list of pending orders — that is B442.

## Acceptance

- The gallery is a **public reader page**: a guest, a traveller on the trip and
  an anonymous reader of a public trip see no postcard control anywhere. A test
  asserts that, because this is the failure that ships silently.
- With `postcards` or `contacts` off, the owner sees no control either.
- No video tile offers one.
- The sheet cannot send: nothing in it calls anything that spends credits, and
  the only way onward is the preview page.
- Creating from the sheet lands on `/<user>/postcards/<id>` with the chosen
  photo, the chosen people, and the message as edited.
