---
id: B332
title: The documents still say deleting a budget removes the costs page, which B328 made untrue
type: ISSUE
priority: high
complexity: low
area: agent docs, costs
found: "2026-09-04T18:55:53Z"
started: "2026-09-04T18:56:11Z"
merged: "2026-09-04T19:05:02Z"
---

# B332 — The documents still say deleting a budget removes the costs page, which B328 made untrue

## Why

Found by B328's own agent, correctly declining to widen its scope.

`NOT_WRITABLE` (`lib/api/agentCopy.ts:176-179`), rendered into both generated
documents, says:

> a trip has no costs *switch* — the page follows the data. Write a budget to
> the costs endpoint and the page appears; **DELETE it and the page goes.**

The second half stopped being true an hour ago. B328 widened `hasCostsData` to
ask whether the trip has *any* costs — a `costs.md`, **or** any day carrying a
`costs:` block. So deleting the budget file leaves the page standing whenever a
day still logs spend, which on `viki/asien-2025` is all fifteen of them.

An agent following that sentence would `DELETE` the budget, report the page
gone, and be wrong — and it is exactly the shape of failure B263 and B319 were
about: a call that reports success while the thing the owner asked for did not
happen.

## Work

Correct the second half of `NOT_WRITABLE` to what B328 built: the page follows
the data, and the data is the budget file *or* any day's costs — so taking the
page away means removing both. Keep the first half (`features` are not
writable) and the closing prohibition (no web form, no CMS, no upload page)
exactly as they are; only the costs clause is wrong.

Check `BUDGET_QUESTION` in the same file while you are there — B328 corrected
it, so the two should now agree rather than one being fixed and the other not.

One sentence. B308 is open and this file has grown all day; this is a
correction, not an addition.

## Acceptance

Neither generated document claims that deleting a budget removes the costs
page, and a test asserts the corrected clause is present so it cannot drift
back.

## Also fixed here, because the merge was red

Merging B328 turned `test/draft-audience.test.ts` red. A sibling session's
**B327** landed in the same window and established the rule that *no page
under the trip gate decides drafts for itself*, replacing `isOwner` with
`draftsVisibleTo(trip)` across nine reading paths. B328's costs pages reached
for `isOwner` — B318's pattern from an hour earlier, which B327 had just
superseded everywhere else.

Neither branch's own run could see it: the invariant test and the violation
arrived on different branches, each green against `main` separately.

So this task also put both costs pages on `draftsVisibleTo(trip)`, dropped the
`isOwner` import, and corrected `test/costs-capability.test.ts`'s mock, which
B328 had pointed at `@/lib/contacts/session` for the same reason.

The rule matters beyond the test. `isOwner` is too narrow: somebody named in a
trip's `people:` may read their own writing back, and a guest let into the
journal may not — a per-trip question `isOwner` cannot express. The costs page
was quietly getting that wrong for buddies.

Worth carrying forward: this is the second time today two branches agreed with
`main` separately and disagreed with each other. Running the suite on the
**merge** rather than on the branch is what caught it.
