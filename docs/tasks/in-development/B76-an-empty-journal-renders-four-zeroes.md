---
id: B76
title: An empty journal renders four zeroes and no way forward
type: ISSUE
priority: medium
complexity: medium
area: trips, ui, onboarding
found: "2026-09-01"
started: "2026-09-01"
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

> **Correction, made while building this.** The second sentence is wrong, and
> the price it was worrying about had already been paid. `/[user]/trips` is
> `ƒ` in `npm run build` before any change here: `listableTrips` reads the
> session cookie through `cookies()`, and `generateMetadata` reads
> `headers()`. There is no static render to lose, so the choice the Work
> framed as a trade-off is not one. The page is owner-aware.

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

## What was built

**The page is owner-aware**, because the premise that it could not be was
stale — see the correction in *Work*. `app/[user]/trips/page.tsx` calls
`isOwner(user)` (`lib/contacts/session.ts`), not `resolveViewer`: the empty
page needs one boolean, and `resolveViewer` walks every trip in the journal to
build a list this page has no room for. The call is made **only when the
journal has no trips**, so the ordinary page pays nothing, and it reads a
cookie `listableTrips` has already read on the same request.

`empty` is decided from `getTrips(user)` **before the gate**, not from the
filtered list. That is the seam with B44: a journal whose trips this reader
may not see is a full journal behind a silent filter, and telling a guest
there are no trips would be a second untruth stacked on the four zeroes. Only
genuine emptiness takes the new branch; a filtered-empty page still renders
exactly what it rendered yesterday, and B44 is free to decide what it should
say instead.

The prop is a union rather than three nullable fields:

```ts
export type EmptyJournal =
  | { owner: false }
  | { owner: true; docUrl: string; ownerEmail: string | null };
```

so the owner's address is not in the RSC payload of a page a stranger asked
for. That is checked in the browser, not only in a test — `curl` on an
anonymous request finds neither the address nor the documentation URL.

`components/AgentHandover.tsx` is new: the heading, the sentence, the two
lines and the copy button, lifted out of `MePageContent.tsx` and used by both.
`MePageContent` lost thirteen lines and gained three; the rendered `/<user>/me`
is byte-identical. It was extracted rather than copied because two copies of
an instruction is one instruction and one stale instruction, and this one is
the only interface for writing that this software has.

Three strings, in `de`, `en` and `hu`: `trips.emptyTitle`, `trips.emptyBody`
(the visitor's honest line) and `trips.emptyOwnerBody` (decision 24, in a
sentence: there is no form, there never will be, hand the two lines below to
an agent). `lib/i18n.ts` regenerated with `npm run i18n:keys`.

The subtitle goes too, in the empty branch. "Überall, wo wir waren" over an
empty journal is the claim that made the four zeroes read as a total.

`test/empty-journal.test.tsx` — nine cases. Six of them fail against the
component as it was.

## Acceptance, line by line

- **No four zero stat tiles.** `test/empty-journal.test.tsx`, "renders no
  lifetime stat tiles at all", for both readers; it fails before the change.
  Confirmed against a running dev server on a journal created for it: the
  `<main>` of `/nora/trips` contains no `Länder` / `Tage unterwegs` /
  `Fotos & Videos` / `Reisen` tile, anonymous or signed in as the owner.
- **Says there are no trips yet, in the journal's locale.** Same file, "says
  there are no trips yet, in the journal's language" — asserts all three
  locales. The German journal above rendered *Noch keine Reisen* / *Hier steht
  noch nichts. Sobald es eine Reise gibt, findest du sie hier.*
- **Its owner is shown what to hand an agent.** Shown, not one click away.
  Signed in as `nora@example.test`, `/nora/trips` rendered the empty title,
  the owner's paragraph, *Zum Schreiben oder für eine neue Reise*,
  `https://example.test/documentation.txt`, the address, and *Link kopieren*.
  The anonymous request for the same URL contained none of it.
- **Strings in `de`, `en`, `hu`; `test/locales.test.ts` green.** All three
  added; the whole suite passes (90 files, 1452 tests).

Also checked, because the risk of an empty branch is what it does to the full
page: a journal with five trips renders the four lifetime tiles, the subtitle
and every card exactly as before, and `/<user>/me` is unchanged after the
extraction.

### One observation, not fixed

A journal whose only trips are `public` with `listed: false` has
`getTrips().length > 0` and nothing listable, so it still renders four zeroes.
That is the unlisted case of B44 rather than an empty journal, and it is left
where B44 can see it whole.

