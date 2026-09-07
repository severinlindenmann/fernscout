---
id: B786
title: Two identical sign-in forms sit on top of each other and nothing says which is yours
type: ISSUE
priority: high
complexity: low
area: agent, ui, auth
found: "2026-09-07T14:32:46Z"
started: "2026-09-07T14:46:59Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T14:46:59Z"
---

# B786 — Two identical sign-in forms sit on top of each other and nothing says which is yours

## Why

Confirmed in a browser against the live instance on 2026-09-07. Signed out,
`/agent` renders two forms, one above the other:

```
Sign in
  Your email address   [        ]
  [ Send me a code ]

New here?
  Your email address   [        ]
  [ Send me a code ]
```

Same label, same button, same shape, two centimetres apart. Nothing on the
screen says which one belongs to somebody who already has a journal and which
to somebody starting out — and a person who does not know the word "journal"
in this sense cannot tell which they are.

A 71-year-old tester stopped here, read both paragraphs three times, and
telephoned her son before doing anything else. It is the first screen of the
product and it is where the least confident people arrive.

It is nobody's mistake in particular: B681 built the sign-in and B688 added
signup beneath it, and neither could see the other. It is what two tickets
landing on one screen looks like.

## Work

One question first, then one form. *Hast du schon ein Reisetagebuch?* — and
only the matching form appears, with a way back if they chose wrong. The
signup path already knows how to tell somebody their address has no journal, so
the wrong choice is recoverable and cheap.

Do not solve it with better headings. Two forms that look identical stay
confusing however they are labelled, and the person who most needs this screen
is the one least likely to read a heading carefully.

## Acceptance

A signed-out visitor sees one email field. Choosing wrongly is recoverable
without reloading.
