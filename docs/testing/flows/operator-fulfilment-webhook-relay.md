# Flow: operator-fulfilment-webhook-relay

**Persona:** `operator` (docs/testing/personas/operator.md)
**Interface:** admin (`/api/health` plus `/admin`, both operator-only)
**Capabilities exercised:** `fulfilmentRelay`, `fulfilmentAccept`
**Device/locale:** run once at desktop width.
**Check type:** technical only — see the note below on what this flow can
and cannot demonstrate.

## What is actually built, and what is not

Checked against `lib/capabilities.ts` and `docs/plans/2026-09-06-fulfilment-
relay.md` before writing this flow, because the obvious assumption —
"simulate a relay webhook the way `scripts/simulate-webhook.ts` simulates
WhatsApp, Gelato and Stripe" — is wrong for this pair. **B589 (this
capability's own skeleton) is the only ticket in the chain that shipped.**
The intake route that would actually accept a relayed job (B590), the client
that would hand one off (B591), and the status callback that would report on
one (B592) are all filed `wont-do` — "the fulfilment relay is not work this
instance needs." There is no route to POST a job to, no fixture for
`scripts/fixtures/webhooks/` to simulate, and no second instance to relay to
or from even if there were. `docs/plans/2026-09-06-fulfilment-relay.md`
itself says the acceptance line for the whole chain "cannot be shown
end-to-end here" for exactly these reasons — no second instance, no wired
print provider, and a mock payment ledger everywhere.

So this flow tests the one thing that **is** built: the two capabilities
report their own state honestly, which is what B589 actually shipped, and it
is not a placeholder — `fulfilmentAccept`'s refusal reasons are read live
from `postcards`/`photobook`'s own provider and from `stripeMode()`.

## Setup

1. Local dev server with `FERNSCOUT_ADMIN_EMAIL` set and an identity cookie
   for it (per `operator-check-admin-dashboard`'s own setup — this flow reuses
   that session).
2. No fixture needed. Each step below only flips a `features.fulfilmentRelay`
   / `features.fulfilmentAccept` config value and reads `/api/health` (or
   `resolveCapabilities()` directly in a test) back.

## Steps

1. `features.fulfilmentRelay.enabled: true` with no `url` set. Confirm
   `/api/health` reports it disabled with the reason "features.
   fulfilmentRelay is enabled but features.fulfilmentRelay.url is not set
   (which fulfilment instance to hand jobs to)".
2. Set a `url`. Confirm it now reports enabled (there is no reachability
   check on that URL — the spec never asked for one, since relaying is not
   built).
3. `features.fulfilmentAccept.enabled: true` with `postcards` and
   `photobook` both off (or both left on `provider: "dry-run"`). Confirm
   `/api/health` reports it disabled with the reason naming that neither has
   a real provider — `fulfilmentAcceptProblem()`'s own first branch.
4. Turn `photobook` on with a real (non-`dry-run`) provider, but leave no
   Stripe key configured. Confirm it is now disabled for the *other* reason —
   no payment method — quoting `stripeProblem()`'s own message.
5. Configure both a real provider and a Stripe key. Confirm
   `fulfilmentAccept` now reports enabled.
6. As the `operator` persona, confirm `/admin` reflects both switches' true
   state (on, off, or refused-with-a-reason) rather than a single "fulfilment:
   on/off" flag that hides which half and why.

## Done when

- Each of the four states above (`relay` unconfigured/configured,
  `accept` refused for each of its two independent reasons, `accept`
  fully satisfied) reports the exact documented reason, matching
  `lib/capabilities.ts`'s own strings (technical check).
- Neither switch can be coaxed into reporting "enabled" while the condition
  it depends on is actually false — this is the whole of what B589 shipped,
  and the whole of what this flow can honestly test until B590/B591/B592 are
  reopened (technical check).
- **Not covered by this flow, because nothing exists to exercise:** an actual
  relayed job, a payment on a fulfilment instance's own page, or a status
  callback. A future flow can absorb these the moment any of B590/B591/B592
  is un-`wontDo`'d and built.
