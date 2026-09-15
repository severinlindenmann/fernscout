---
id: B1779
title: Nothing carries a sensitive frame from the description pass to the review page, so the person hunts for it by date
type: FEATURE
priority: medium
complexity: medium
area: fernscout-helper icloud-export, describe.mjs, review.mjs
found: "2026-09-15T06:24:46Z"
started: "2026-09-15T06:40:01Z"
merged: "2026-09-15T07:09:17Z"
completed: "2026-09-15T08:19:31Z"
---

# B1779 — Nothing carries a sensitive frame from the description pass to the review page, so the person hunts for it by date

## Why

Looking at every photograph of a trip finds things nobody went looking for. In
one ten-year run the per-day descriptions turned up an identity card front and
back with its MRZ, a bank card showing the full cardholder name, a phone screen
with a name, IBAN and BIC, a hostel envelope with a door code and booking
reference, hotel cards with guest names and Wi-Fi passwords, locker receipts
with access codes, a signed waiver with a personal link, a traffic notice with
a case number and address, and a parcel label with a name and address.

That is the strongest argument for the whole pipeline, and none of it reaches
the person in a usable form. `describe.mjs` writes `sheets/index.json` — day,
cells, files, places — and has nowhere to put "cell 7 shows a document with
somebody's name on it". Whoever read the sheet says it in prose that goes into
a conversation, and the person then hunts the review page by date for a frame
they have been told about.

## Work

A `flags` array in `review.json`, written by the description pass and keyed by
filename: what was seen, in the reader's own words, and nothing inferred. The
review page gets a way to jump to flagged frames, and says how many are
outstanding. It marks, it does not decide — dropping the photograph stays the
person's press.

Worth keeping honest: a flag is an observation about what is visible, the same
standing `observed` has. It is never the journal's text, and an unflagged
photograph is not a claim that there is nothing in it.

## Acceptance

A description pass can record a flag against a photograph; the review page
lists the flagged frames of the trip and opens on them directly; dropping one
is still a separate press.

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `sheets/index.json` had nowhere to put "cell 7 shows a
document with somebody's name on it", and the review page knew nothing of it.

`review.json` carries `flags`, a map of filename to what was seen, written by
whoever read the contact sheets. The page outlines those frames in red, says in
its own words what was noticed under each one, counts them in the bar, and
offers a jump straight to them. It marks; it does not decide — turning the
photograph off is still a press.

The save route was the part that would have quietly broken this: the page used
to write the whole document back, which would have deleted `flags` and
`observed` on the first keystroke. It now merges over what is already in the
file.

Keeper: three checks in `review.server.test.mjs`, one of them that a save keeps
the flags and the observations. Documented in `icloud-export/SKILL.md` with the
shape to write.
