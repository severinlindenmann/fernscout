---
id: B887
title: Every row of the access list repeats a sentence where a tag would do
type: ISSUE
priority: medium
complexity: low
area: me, access
found: "2026-09-07T20:20:00Z"
merged: "2026-09-07T18:50:39Z"
---

# B887 — Every row of the access list repeats a sentence where a tag would do

## Why, and what was done

The owner: *"optimize here the text, make it an emoji or a small tag rather —
'Deins' etc."*, on the "Was du lesen kannst" list where five rows each ended
*"sie steht in deinem Tagebuch"*.

The clause was the same on every row, and long enough to squeeze each trip's
title into two or three lines to make room for it. New short keys —
`me.tagPublic` / `me.tagOwner` / `me.tagTraveller` / `me.tagGuest`, "Öffentlich"
/ "Deins" / "Du warst dabei" / "Eingeladen" — rendered as a small pill instead
of body text.

**A tag rather than an emoji**, which was the other suggestion: the four
reasons are *why you may read this*, and the difference between "invited" and
"you were there" decides what else the page offers you. A picture that has to
carry that distinction with no word beside it would be a guess for every
reader who has not been taught the key.

The long `me.via*` strings stay — they are what the trip gate says when there
is one row and space to explain it. Only the list uses the tags.

`test/access-panel.test.tsx` asserted the sentences; it asserts the tags now,
and still asserts the thing that matters (B41): an owner is told the journal
is theirs, never merely that they were there.
