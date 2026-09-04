---
id: B152
title: The guide calls the relayed sign-in link the same link as the mailed one, and never says what kills it
type: CHORE
priority: low
complexity: low
area: docs, auth
found: "2026-09-03"
started: "2026-09-04T06:22:42Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:22:42Z"
---

# B152 — Two documentation gaps around the relayed sign-in link

## Why

Found while verifying B29, which passes: `signIn` is separately named in the
201, documented in `agent.md` and `openapi.json`, redeems to a guest session,
and is refused as a bearer token in both directions. Nothing here disputes
that. These are two things the guide says imprecisely, both discovered by
watching the live flow.

**"The same link" is two different tokens.** `agent.md` says *"the same door is
in their welcome mail"* and the live `signInNote` says *"The same link is in
their welcome mail if they miss it."* They are separate `login_codes` rows —
`issueRelayLink` (`lib/auth/index.ts:432`) and `issueStandingLink` (`:466`).
Observed on `xydhd-qa5`: the 201 carried `…/s/S0P6FxUm…`, the welcome mail
written three seconds later carried a different token, and each redeems
independently.

"Same door" is a fair description of where they lead. It is misleading about
lifetime, and the difference is load-bearing: the relayed link expires in
fifteen minutes, the mailed one is standing and permanent. An agent that reads
"same link" has no reason to expect the one it handed over to die while the
other keeps working — and, per B142, the mailed one is the one a scanner
spends, so the two behave *oppositely* in practice.

**Nothing says what kills a relayed link early.** It is not standing, so
`revokeCodes` sweeps it when an ordinary sign-in code is issued for that
address (asserted at `test/auth.test.ts:334-341`). So: an agent hands a person
their link, the person goes to the site and asks for a sign-in code instead,
and the link the agent just gave them stops working. Correct behaviour — one
live code per address is the invariant — but invisible, and the person
experiences it as the agent having handed them something broken.

Neither is a defect. Both are the kind of imprecision that turns into a support
question nobody can answer from the docs.

## Work

- Say in `agent.md` that the welcome mail carries a **second, longer-lived**
  link to the same place, not the same one. Two sentences.
- Say that issuing a sign-in code for that address invalidates a relayed link
  that has not been used yet — and therefore that the link is worth handing
  over immediately rather than held.
- `signInNote` is returned in the 201 but appears in neither `agent.md`'s
  example nor `openapi.json`. Either add it to both or drop it from one; an
  agent reading the documented schema does not currently know the field exists.

Not doing: changing any of the behaviour. Fifteen minutes, single use, and the
revoke-on-new-code rule are all right; only the description is off.

## Acceptance

- `agent.md` distinguishes the relayed link from the mailed one by lifetime,
  and neither calls them the same link.
- The revoke-on-new-code interaction is documented where an agent will meet it.
- `signInNote` is either in the documented schema or not in the response.
