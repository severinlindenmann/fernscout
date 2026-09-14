---
id: B1711
title: The landing page and README do not sell what Fernscout actually does
type: FEATURE
priority: high
complexity: medium
area: landing, README
found: "2026-09-14T08:43:42Z"
started: "2026-09-14T08:51:38Z"
merged: "2026-09-14T09:13:12Z"
completed: "2026-09-14T16:32:56Z"
---

# B1711 — The landing page and README do not sell what Fernscout actually does

## Why

The signed-out root explains the mechanism — an agent, a token, a folder of
files — and never mentions that a real postcard can arrive at somebody's
house, that a trip prints itself as a book, or that a WhatsApp voice note is
enough to write a day. Postcards, photobook and WhatsApp appear only as rows
in the README's capability table, next to the environment variables they need.

The category (Polarsteps, Journi) sells exactly two promises: it records
itself, and it turns into a printed book. Fernscout does both and says
neither. The one claim no competitor makes — write it by talking to WhatsApp —
is not on the page at all. The recurring complaint about the category, that
your travels live on somebody else's terms, is the thing this project answers
best and mentions last.

The README has the same shape: 248 lines, first screenshot around line 120,
and ~40 stray test PNGs in the repository root above it.

## Work

Research, four directions with mockups, and a README plan:
https://claude.ai/code/artifact/77b0901d-e870-4014-9042-dd25f2f11154

Decided with the owner on 2026-09-14:

- **Placement** — rebuild the signed-out root. No second marketing page. The
  signed-in order in `components/Landing.tsx` stays exactly as it is.
- **Direction** — hero is the WhatsApp thread ("send a voice note, get a
  travel journal"); postcards are the section directly beneath it; then the
  photobook; then your own folder, your own domain, free; then the real story
  page as proof. The agent is the *how* under each claim, never the headline.
- **README** — full rewrite of the first screen: hero image, one proof
  capture near the top, quick start inside the first 200 words, the existing
  prose kept below it unchanged. Delete the stray test PNGs in the repository
  root.
- **Assets** — everything ships on `/example` for now; the owner may replace
  the captures with a real trip later. No real address, no real photograph,
  no invented content: a `test-` journal or the demo journal only.
- **Languages** — English, German and Hungarian together, as AGENTS.md
  requires for any new UI string.

## What was built

**Valid** — `components/LandingSections.tsx:356` set one headline from
`landing.hero` with no alternative, and nothing between the hero and
`PublicJournals` named a postcard, a book or the folder. Confirmed before
changing anything.

- `LandingHero` now has two headlines. With a WhatsApp number configured it
  leads with "Send a voice note. Get a travel journal." and shows the
  exchange that produces a day; without one it renders exactly what it always
  did, because that sentence would be untrue on an instance with no number.
- `LandingPitch`, new, sits directly under the hero on the signed-out page:
  postcards, the printed book, and the folder being yours. Each print card is
  gated on its own capability, and the section returns `null` when neither is
  on — the ownership claim alone under that heading only repeats the lede and
  the colophon.
- The thread quotes a real day from the demo journal (`asia-2023`,
  `2023-01-24-night-train-north`) — its title, date, route and berth fare —
  and says so in its caption. It is drawn in this site's own tokens rather
  than as a WhatsApp skin.
- `OrDivider` in the hero now only renders when there is a first door for it
  to be an alternative to. With the helper off — every self-hosted instance —
  the word sat in front of the WhatsApp button separating it from nothing.
  Surfaced by this branch's headline, so fixed here.
- README: a drawn hero (`docs/branding/readme-hero.svg`, new), the pitch in
  one bold sentence, links and the CI badge, two screenshots, and both quick
  starts — all inside the first screen. Everything below is the prose that
  was already there; the two lifted screenshots were removed from "What it
  looks like" so they do not appear twice.

**The root `*.png` acceptance line was wrong.** `.gitignore:103` is `/*.png`,
so those captures were never in the repository and nobody arriving from
GitHub has ever seen them. Nothing to delete; the owner's local scratch files
are left alone.

## Acceptance

- The signed-out root leads with the WhatsApp claim and names postcards, the
  photobook and file ownership above the fold or in the first two screens.
  Captured at 1280 and 390.
- The signed-in root is unchanged: journals first, then public journals, then
  the agent block, then devices.
- Nothing on the page claims a capability this instance does not have —
  postcards, photobook and WhatsApp sections are absent, not broken, when the
  capability is off. Captured with the capability off as well as on.
- Every new string has a real English, German and Hungarian entry;
  `npm run i18n:keys` is clean.
- README's first screen carries an image, a one-line pitch and a quick start;
  the root `*.png` test captures are gone.
- `npm run verify` passes.
