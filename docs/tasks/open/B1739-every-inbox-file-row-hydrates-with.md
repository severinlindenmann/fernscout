---
id: B1739
title: Every inbox file row hydrates with a mismatched date, because toLocaleDateString has no locale
type: ISSUE
priority: medium
complexity: low
area: agent room, i18n
found: "2026-09-14T16:17:12Z"
---

# B1739 — Every inbox file row hydrates with a mismatched date

## Why

`components/InboxFileGroups.tsx:135` renders a row's date as
`new Date(file.at).toLocaleDateString()` with no locale argument. On the server
that formats in the process's ICU default; in the browser it formats in the
viewer's. React sees two different strings for the same node and throws a
hydration mismatch, which regenerates that subtree on the client.

Seen while checking B1737 in a browser at 1280 and 390 against the demo
journal with one file staged in its inbox:

```
+ 111 B · 14/09/2026     (server)
- 111 B · 9/14/2026      (client)
```

It is not specific to a contact card — the row is shared by every inbox kind,
and any entry carrying `uploadedAt` reaches it. It was simply never seen
locally because the demo journal's inbox is empty, so an `/agent` capture with
nothing staged has a clean console. B1737 did not introduce it and does not
change that line; it made the row reachable for two more kinds.

A hydration mismatch shows up nowhere except the console, which is why this
sat: the pane looks right in a screenshot.

## Work

- Format the date the way the rest of this codebase formats a date for a
  reader — through the room's own locale rather than the ambient one. Check
  what `components/` already does before adding anything; this is a reuse
  question, not a new helper.
- Or render it server-side only, as a `suppressHydrationWarning` on a value
  that is genuinely environment-dependent. Prefer the first: a date the two
  sides agree on is better than a warning silenced.

## Acceptance

- `/agent` with at least one file staged in the inbox captures with zero
  console errors at 1280 and 390.
- The date shown is the same before and after hydration.
