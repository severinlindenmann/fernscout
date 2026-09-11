---
id: B1454
title: A refused book never shows that the credits came back, because the sentence is in an unreachable branch
type: ISSUE
priority: high
complexity: low
area: photobook, design, i18n
found: "2026-09-11T12:15:24Z"
started: "2026-09-11T12:15:55Z"
merged: "2026-09-11T12:29:33Z"
---

# B1454 — A refused book never shows that the credits came back, because the sentence is in an unreachable branch

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Seen on a phone, in German, on a real refused order:

> **Drucken**  ● Abgelehnt

And nothing else. A person is told their book was refused and not one word
about the 181 credits they paid, which are in fact already back. The failure
*mail* says it plainly — *"alle 284 Credits sind zurück auf deinem Konto"* —
so the page is the one place that leaves them wondering whether they have lost
the money.

**The sentence exists and cannot be reached.** `app/[user]/photobooks/[id]/page.tsx`:

```ts
if (print?.providerRef) {
  // …pill from Gelato's live status…
} else if (print?.failure) {
  pill = { tone: "coral", label: t("photobook.print.status.refused") };
  statusText = t("photobook.print.refusedRefunded", { credits: … });
}
```

A refused order **has** a `providerRef` — Gelato accepted the order, returned
an id, and only then refused it; that is the whole shape of the failures this
instance has actually seen. So it takes the first branch, gets its coral pill
from the live status, and `statusText` is never set. The `else if` fires only
for a book whose submission never reached Gelato at all, which is the rarer
case by far.

So the refund notice is written, translated, correct — and dead for the
orders it was written for.

## Work

Two things, and the first is the bug.

**1. Compute the context sentence independently of the pill.** Whether the
credits came back is a fact about `print.failure`, not about which branch drew
the chip. Set `statusText` from the order's own state, then draw the pill
separately.

**2. Give every state a sentence, not just the failure.** A pill alone is a
label; a person wants to know what it means for them and whether anything is
expected of them. One short line under the chip:

| State | What the line has to say |
| --- | --- |
| accepted (`created`, `passed`) | the printer has it; nothing to do; you will hear when it is printed |
| being made (`in_production`, `printed`) | it is being made now |
| posted (`shipped`) | it is on its way — the tracking rows below already carry the codes, so do not repeat them |
| refused | nothing was printed or sent, **and all N credits are back**; ordering again is done from the trip's photobook page |
| unknown word | **nothing.** No invented explanation for a status we have not mapped — the same rule B1451 established for colour applies to prose |

Reuse `photobook.print.refusedRefunded`, which already exists and is already
translated. The other four are new keys: real English and German, `hu` may
carry English with a note in this file — it joins the `photobook.*` block's
existing translation debt rather than starting a new one.

**Do not** put the reason for the refusal on this page. B1165 settled that: on
a hosted instance the printer's own message is about the operator's Gelato
account, not this owner's business, and it stays on `/admin`.

## Acceptance

- A refused order says, on the page, that the credits are back and how many.
- Each mapped state carries one line of context; an unmapped one carries none.
- Checked in a browser at 390px in German, on a real order — not judged from
  source.
- `npm run verify` clean.
