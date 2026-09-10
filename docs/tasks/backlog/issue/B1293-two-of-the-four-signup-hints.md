---
id: B1293
title: Two of the four signup hints sit above their field and two below, so the address rule reads as the title rule
type: ISSUE
priority: low
complexity: low
area: signup
found: "2026-09-10T10:59:32Z"
---

# B1293 — Two of the four signup hints sit above their field and two below, so the address rule reads as the title rule
## Why

Measured on the live wizard at 390px, by y-coordinate:

| y | element |
| --- | --- |
| 553 | input — **What should we call your journal?** |
| 602 | hint — *"Lowercase letters, digits and dashes. This becomes the web address of your journal…"* |
| 739 | input — **Choose its address** |
| 830 | input — Your full name |
| 871 | hint — *"It appears on your trips as the person who kept them."* |
| 977 | input — What the site should call you |
| 1018 | hint — *"The short form the site uses when it speaks to you…"* |
| 1692 | hint — *"A three-letter code — EUR, CHF, HUF, USD…"* |
| 1829 | input — **Which currency do you count in?** |

Name and nickname have their hints **below**, correctly. Address and currency
have theirs **above** — and 120px and 137px above, with nothing between.

The address one does real damage. A rule reading *"Lowercase letters, digits and
dashes"* sitting 49px under the **journal title** field reads as a constraint on
the title, so a person types `bern-weekend` where their journal's name belongs.
The field it actually describes is off the bottom of the phone screen when the
hint is read.

On a wide screen all four hints are visible at once and the association is
obvious. At 390px you see one field and one paragraph at a time, which is what
makes the inconsistency cost something.

## Work

- Put every hint on the same side of its field. Below is the convention the two
  correct ones already follow.

## Acceptance

- At 390px, each hint on the create form is adjacent to the field it describes,
  on the same side for all four.
