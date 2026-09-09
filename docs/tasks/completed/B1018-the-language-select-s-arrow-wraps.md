---
id: B1018
title: The language select's arrow wraps and moves, and a newly ticked recipient shows no address
type: ISSUE
priority: high
complexity: low
area: Postcards
found: "2026-09-08T19:30:00Z"
started: "2026-09-08T19:25:40Z"
merged: "2026-09-08T19:56:18Z"
completed: "2026-09-09T16:47:00Z"
---

# B1018 — The language select's arrow wraps and moves, and a newly ticked recipient shows no address

Two faults on the preview page, both reported from the live site in German.

## Why

**The "written in" select is sized by nothing.**
`app/[user]/postcards/[id]/PostcardBack.tsx:334` lays the signature and the
language out as `flex flex-wrap gap-3`, and each `<label>` is a flex item with
no basis holding a `w-full` control. A flex item with no basis takes its
content's width and the content is `w-full` of the item, so the browser
resolves the width from the label text and the select's own longest option —
which means the box changes width when the value changes, and the native arrow
lands wherever that leaves it. In German it wraps onto a line of its own under
the word, so the control reads as a box with a stray triangle beneath it. It is
worse in German because the labels are longer, which is exactly the case a
`flex-wrap` with no basis handles worst.

**A recipient you have just ticked has no address to open.**
`page.tsx:386` resolves the street only for `people.has(contactId)` — the
people already named on the order — with a comment of mine saying a candidate
nobody has ticked "has no business handing their address to a page that is not
posting to them". That was right when the list was frozen at creation and is
wrong since B1005 made it editable: the person you have just ticked *is* who
you are posting to, and they are the one whose envelope you want to check. The
disclosure is simply absent for them, so the page looks like it is hiding
something rather than offering it.

## Work

- Give the two fields real columns — stacked on a phone, two from `sm` — so
  each control has a definite width and the arrow sits where a native select
  puts it.
- Resolve addresses for **every** candidate (`addressesFor`), not only those on
  the order, so the disclosure is there for anybody the owner ticks. The
  address still only renders for a ticked recipient and still only inside the
  `<details>`: B434's reasoning about four home addresses on a phone at a table
  stands, and this changes who has one, not who sees one by default.

Not doing: opening the disclosure by default. That is a one-word change
(`open`) if it turns out to be what is wanted, but the reason it is closed has
not changed.

## Acceptance

- At 390px in German the select is a plain box with its arrow on the right, and
  the box does not resize when the language changes.
- Ticking a second recipient on the send step gives them the same address
  disclosure the first one has, without a page load.
