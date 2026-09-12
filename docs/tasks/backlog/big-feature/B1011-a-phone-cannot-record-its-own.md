---
id: B1011
title: A phone cannot record its own position, and there is no app in the store
type: FEATURE
priority: low
complexity: high
area: ios, gps, pwa
found: "2026-09-08T18:39:43Z"
---

# B1011 — A phone cannot record its own position, and there is no app in the store

## Why

Two things, and the first is why the second is worth paying for.

**A phone cannot record its own position.** `gps/` exists so a trip's map can
show the road actually driven, and every route *into* it goes through
`importers/gps/` — Google Timeline, Google Takeout, GPX, JSON Lines. All four
are somebody else's export. So the owner's own track is only as good as whatever
third party was logging them, and a person who has turned Google's history off
has no way to draw a line at all. A browser cannot close this: iOS Safari gives
a web page no background geolocation, and the tab is suspended the moment the
screen locks. `POST /api/v1/<user>/import` already takes `kind: gps` and would
accept the rows unchanged — what is missing is something on the phone that
produces them.

**There is no app in the store.** Fernscout is already a PWA — `app/manifest.ts`,
`public/sw.js`, an offline page, and B447/B477/B625 got the iOS home-screen
install right — so reading, and the `/agent` helper, work on a phone today. That
is genuinely most of it, which is why this is `low`: nothing is broken. What the
home-screen install cannot do is background location, camera capture straight
into the inbox, or push.

The cost of leaving it alone is that trip tracks stay dependent on Google, and
the journal is invisible to anybody who looks for software in the place people
look for software.

**What it costs to do.** Apple Developer Program is USD 99/year, ongoing;
everything else in the toolchain is free and a Mac is already here. The
commission only applies to purchases made *inside* the app, which is a
constraint on the design rather than a bill — see the non-goal below.

## Work

Not decided, and deliberately left open — but the shape that looks likeliest is
a **Capacitor wrapper** around the deployed site rather than native screens.
Fernscout is a server-rendered Next.js app with the whole product in it; a
second UI is a second thing to keep true, and this file's own rule about a
reference kept in two places applies to screens as well.

That makes the native part small and specific:

- A background location plugin writing fixes, thinned the way `lib/gps/store.ts`
  already thins them (one per 5 min or 250 m), posting to
  `POST /api/v1/<user>/import` with `kind: gps`. The store, the exclusion zones
  and `npm run gps -- enrich` are unchanged — the app is one more importer, on a
  phone.
- **Research question before choosing that plugin:** Capacitor Background Runner
  accepts a repeating interval in minutes, so it could take a best-effort
  snapshot about once an hour. It is not a permanent timer: iOS chooses when it
  runs (or may not), and Android battery optimisation can delay it. That may be
  a deliberately low-power optional mode, but it cannot meet the acceptance
  criterion for a reliable locked-screen walk recording. Compare it with a
  native, user-started location service that wakes on movement, and record the
  permission, battery, App Store and Play Store consequences before deciding.
- Authentication: the app holds a session the way a browser does. Worth deciding
  early whether it is a cookie in the webview or the handover credential
  (`POST /api/v1/<user>/handover`) — an agent token in a phone is a bearer token
  in somebody's pocket, which decision 24 exists to prevent.

**Expect guideline 4.2 (minimum functionality) to reject a plain wrapper.**
A shell around a site Safari already renders is the most common rejection there
is, and background location is the answer to it — it is also the feature that
makes the app worth installing, so the two problems have one solution. Camera
capture into the inbox and push notifications are the obvious next reasons and
are *not* in scope here.

A location app draws extra review scrutiny: an explicit `NSLocationAlwaysAnd
WhenInUseUsageDescription`, a privacy policy the listing links to, and a
privacy-nutrition-label answer that says the position never leaves the owner's
own instance. `docs/gps.md` is most of that text already.

**Not doing, explicitly:**

- **No in-app purchases.** Credits are bought on the web (B792, Stripe) and the
  app must not offer, mention or link a way to buy them, or Apple's 15–30% and
  its whole IAP apparatus attach to the instance's only revenue. This is a
  design constraint, not an oversight.
- No native screens, no second design system, no offline authoring beyond what
  `public/sw.js` already does.
- No Android. Capacitor would give it nearly free and it is still a separate
  decision, a separate store and a separate listing.
- Nothing that reads `gps/` back out. The rule in AGENTS.md is unchanged and the
  app is a writer: no route returns a position, and the app must not become the
  first thing that does.

## Acceptance

- The app on the owner's own phone, from TestFlight, records a walk with the
  screen locked, and those fixes arrive in `content/<user>/gps/YYYY-MM.jsonl`
  through the import route.
- `npm run gps -- enrich` then draws that day's track on a trip, with the
  owner's exclusion zones honoured, from data no third party ever held.
- `test/gps-store.test.ts` still passes — nothing under `app/` reaches the store.
- The app is accepted into the App Store, which is the part no test can assert
  and the reason this is `high` complexity rather than a week.

Enrolment is a prerequisite and a person's: USD 99/year, individual rather than
organization unless somebody wants the D-U-N-S detour.
