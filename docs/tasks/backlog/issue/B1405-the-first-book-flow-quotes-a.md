---
id: B1405
title: "The first-book flow quotes a price before the recipient is known, so the figure can change before the press"
type: ISSUE
priority: medium
complexity: low
area: photobook, the first-book flow
found: "2026-09-10T21:50:00Z"
---

# B1405 — The first-book flow quotes a price before the recipient is known, so the figure can change before the press

# Why

The last step of the first-book flow says:

> **Dein Buch** — 46 Seiten, also ein geklebter Rücken … *Etwa CHF 8.00 (40
> Credits).* — Alles hier lässt sich weiterhin ändern …

The figure is wrong often enough to be noticed, and the reason is structural
rather than a rounding bug: **at that point nothing has chosen who the book is
posted to, and postage is in the quote.**

`FirstBookFlow.tsx:530-535` renders `photobook.first.price` from
`preview.credits`. `preview` comes from the debounced `POST
…/photobook/preview` in `PhotobookPageContent.tsx:503-527`, whose body carries
`contactId: recipientId` — *"so the quote includes their postage — B1157"*. And
`recipientId` is seeded at `:184` as

```js
useState<string | null>(recipients[0]?.id ?? null)
```

— whoever happens to be first in the list, not somebody the person picked.
Choose a different recipient afterwards, in another country, and the number
moves. Both figures are honest; showing the first one as *the* price mid-flow
is what makes it look wrong.

Two smaller things pull the same way: the quote is 400 ms behind the last
option change by design, and the step's own copy already says *"alles hier
lässt sich weiterhin ändern"* — a sentence that says the book is not settled,
printed directly under a price presented as though it were.

Nothing on that step spends anything. The place a number has to be exactly
right is the button that takes the credits, and that place already states it
(`photobook.price`, `photobook.payTotal`, `photobook.tooPoor`, with the
balance beside them).

## Work

- Remove the price from the flow's summary step — the `photobook.first.price`
  line at `FirstBookFlow.tsx:530-535`. Keep the binding-and-page-count sentence
  above it: that one is a fact about the book and does not depend on the
  recipient.
- Leave the ordering panel's pricing exactly as it is. That is where the
  recipient is known, where the balance is shown, and where the press happens.
- If the step feels bare without any indication of cost, a sentence saying the
  price comes with the recipient is acceptable — a *sentence*, not a figure.
  Never a number qualified by "etwa": that is what is there now, and it did not
  stop it reading as the price.
- `photobook.first.price` then has no caller: remove it from all three locale
  files and run `npm run i18n:keys`, or `knip` will find it.
- While in there, check whether anything else in the flow prints a figure from
  `preview` before a recipient exists.

**Not in this ticket.** No change to how the quote is computed, to postage, to
`creditsInRappen`, or to the debounce. The number is not wrong — it is early.
If the ordering panel's own figure is ever wrong, that is a different ticket
and a more serious one.

## Acceptance

- The flow's last step shows the page count and binding and no price.
- The ordering panel still shows credits, the money equivalent and the balance,
  and the press still costs what it says. Checked in a browser at 390px
  (`test-in-a-browser`).
- With two recipients in different countries, switching between them changes
  the figure on the panel and there is no earlier figure to contradict it.
- `npm run verify` clean — `test/locales.test.ts` and `knip` included.
