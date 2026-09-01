---
id: B76
title: An empty journal renders four zeroes and no way forward
type: ISSUE
priority: medium
complexity: medium
area: trips, ui, onboarding
found: "2026-09-01"
---

# B76 — An empty journal renders four zeroes and no way forward

## Why

Found on 2026-09-01, opening a journal created minutes earlier and containing
nothing. `/<user>` redirects to `/<user>/trips`
(`app/[user]/(trip)/page.tsx:26`), which is right, and the trip list then says,
in full:

> **Unsere Reisen**
> Überall, wo wir waren — und wohin es als Nächstes geht.
>
> Länder **0** · Tage unterwegs **0** · Fotos & Videos **0** · Reisen **0**

That is the whole page. `TripsIndexContent`
(`app/[user]/trips/TripsIndexContent.tsx:68–105`) renders the heading and the
four `Stat` tiles unconditionally, then hides everything that could have said
more: the lifetime map behind `mapRoutes.length > 0` (`:85`), and each of the
three status sections behind `group.length === 0` (`:92`).

The result is a page that looks finished. The subtitle claims the journal
records everywhere its owner has been; the tiles report, with the composure of
a real total, that this is nowhere. Nothing distinguishes it from a journal
whose trips have all been filtered away, and nothing says what to do — which,
per ROADMAP decision 24, is the one thing a new owner genuinely cannot guess,
because there is no button and never will be. The instruction they need is
"hand these two lines to an agent", and it exists, on `/<user>/me`, in a block
they have no reason to have visited.

This is the first page a new journal's owner sees. It is currently the weakest.

## Work

Give `TripsIndexContent` an empty branch: when `trips.length === 0`, drop the
four zero tiles and say the journal has no trips yet. For the owner, follow it
with how one is made — the documentation URL and their address, the same pair
`app/[user]/me/MePageContent.tsx:151–159` already assembles behind `CopyLine`;
lifting that into a small shared component is preferable to writing the
handover text twice. For anybody else, the honest line is that there is nothing
here yet.

Whether the page can tell owner from visitor needs checking first:
`app/[user]/trips/page.tsx` currently resolves `listableTrips` but no viewer,
and adding one makes the route dynamic. If that is unwelcome, an owner-agnostic
empty state is still a large improvement over four zeroes.

Distinct from **B44**, which is a *guest* seeing a complete-looking journal
whose trips the gate has removed — there the totals are non-zero and the
problem is that a filter ran silently. Here the journal is genuinely empty.
A fix for one may well serve the other; they should not be merged, because
B44's reader needs a sign-in prompt and this one needs an agent.

Related: **B73**, the nav links that 404 from this same page.

## Acceptance

- A journal with no trips does not render the four zero stat tiles.
- It says, in the journal's locale, that there are no trips yet.
- Its owner is shown, or is one click from, what to hand an agent.
- Strings in `de`, `en` and `hu`; `test/locales.test.ts` green.
