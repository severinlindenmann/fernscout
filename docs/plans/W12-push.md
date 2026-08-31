# W12 — Push fan-out + install onboarding

**Roadmap:** D1, D7, decision 16 · **Depends on:** W10 · **Wave G**

> Kept in scope by decision 16 despite the audience estimate. With W10's
> contacts model, fan-out is cheap: grants and subscriptions live in one place.

## Scope
- Extend `scripts/notify.mjs` from "all subscriptions" to "grants that can see
  this trip" — per recipient, respecting W09 visibility
- Subscriptions move to the DB (W06), linked to contacts (W10)
- Expired/gone subscriptions (410) pruned automatically
- **D7 install onboarding**: illustrated one-screen iOS explainer, shown once.
  iOS requires Add-to-Home-Screen *before* push can be requested, and the prompt
  must come from a user gesture — `components/PushOptIn.tsx` already has the copy
- Build it **after W11 ships**: email reaches everyone, push reaches whoever manages

## Acceptance
- [ ] `push.enabled=false` → opt-in renders nothing, no VAPID needed
- [ ] Notification reaches only contacts with access to that trip
- [ ] Dead subscriptions pruned, send continues
- [ ] Onboarding shown once, dismissible, never on desktop
- [ ] Verified on a real iPhone Home Screen install (the only untestable-locally path)
