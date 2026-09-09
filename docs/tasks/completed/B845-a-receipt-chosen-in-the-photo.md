---
id: B845
title: A receipt chosen in the photo picker is called a photo
type: ISSUE
priority: medium
complexity: low
area: agent, media
found: "2026-09-07T16:43:30Z"
started: "2026-09-07T17:03:01Z"
merged: "2026-09-07T17:23:38Z"
completed: "2026-09-09T16:46:47Z"
---

# B845 — A receipt chosen in the photo picker is called a photo

## Why

B791 widened the picker's `accept` so a bank statement or a location export
could be chosen — that was right and it unlocked the whole import feature.

The label did not follow. A tester attaching `receipt.pdf` was told **"1 photo
chosen"**, with no warning that it is not a picture. The file goes to the inbox
(correctly), but the screen has just called a PDF a photograph and given no
sign that anything different will happen to it.

> "a quiet trap for someone trying to attach a receipt the wrong way"

The upload progress line has the same fault, noted when B683 was built: it says
"{done} von {total} gesendet" as though a CSV were a photograph.

## Work

Count and name the kinds separately: "3 Fotos und 1 Datei gewählt", and say in
a line what will happen to the file — it goes to your inbox, where you can read
it into the trip. That sentence is also the discovery path for the import
feature, which nothing currently advertises.

## Acceptance

Choosing a PDF says a file was chosen, not a photograph, and says where it went.
