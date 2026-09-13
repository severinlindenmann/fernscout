---
id: B1686
title: The signup wizard holds a bearer token in a browser
type: ISSUE
priority: medium
complexity: medium
area: Auth
found: "2026-09-13T18:08:19Z"
merged: "2026-09-13T18:32:51Z"
---

# B1686 — The signup wizard holds a bearer token in a browser

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`components/SignupWizard.tsx` takes the agent token `POST /api/v2/journals`
returns and uses it, `Authorization: Bearer`, to create the first trip. The
token lives in component state.

**Pre-existing, not introduced by B1674** — `main` carried sixteen references
to it before the v2 repointing, and that change touched none of them. Filed
because it was noticed, not because it regressed.

The tension is real even so. Decision 24 says agent tokens arrive in
`Authorization: Bearer` and nowhere else, browser sessions arrive in a cookie
and nowhere else, and the two are never interchangeable — *reading the site on
your phone must not put a credential that can rewrite it in your pocket.*
`resolveSession` enforces it by comparing a row's `kind`, and fifteen
`/api/web` cookie proxies exist precisely so pages never need a bearer.

The wizard is the one page that holds one.

**The argument for it**, which should be weighed rather than dismissed: at that
moment there is no cookie session to use, because the journal did not exist a
second ago. The token is what signup just minted, it is never written to a
cookie or to storage, and it dies with the page. That is a genuinely different
situation from a reader's browser carrying a write credential around.

**The argument against**: it is still a bearer token in a browser, reachable
from any script on that page, and "held only in component state" is a property
of today's code rather than something enforced. The rule as written admits no
exception, and an exception nobody has written down is one the next person
will either copy or trip over.

## Work

Decide which it is, and make the code and the rule agree:

- **If the exception is right**, write it into `docs/v2-migration/00-decisions.md`
  beside decision 24 — what is allowed, for how long, and why signup is
  different from every other page. An exception that exists only in one
  component is not a decision, it is a gap.
- **If it is not**, the wizard finishes through a cookie door. The handover
  credential (B283) is the shape that already exists for crossing this line in
  one direction: short-lived, single-purpose, refused everywhere except the
  route that spends it. Something similar could let signup hand the browser a
  session rather than a token.

Worth checking at the same time: how long that token is valid, and whether
anything revokes it when the wizard closes. A seven-day credential left in a
closed tab is a different risk from one that expires in minutes.

## Acceptance

Either `00-decisions.md` names the exception and the wizard's behaviour matches
it, or no page holds a bearer token and `resolveSession`'s separation is true
without qualification.
