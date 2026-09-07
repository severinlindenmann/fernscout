---
id: B657
title: The licence grants away the logo the trademark policy holds back
type: DOCS
priority: high
complexity: low
area: Licensing
found: "2026-09-07T05:46:03Z"
started: "2026-09-07T05:46:24Z"
merged: "2026-09-07T05:55:41Z"
---

# B657 — The licence grants away the logo the trademark policy holds back

## Why

`TRADEMARK.md:15` says the name and logo are "not covered by that grant".
For the name that is true — PolyForm Shield grants copyright and patent
licences only and never a trademark licence, so the name was never in scope.

For the logo it is false, and `LICENSE` is the operative document while
`TRADEMARK.md` grants and withholds nothing. Shield's copyright licence
covers "the software", and the software as shipped contains every brand
asset: eleven files under `docs/branding/`, plus `app/icon.svg` and the
verbatim inline copies of the waymark paths in `app/apple-icon.tsx` and
`app/opengraph-image.tsx`. Read on its own, the licence hands a fork a
copyright licence to reproduce and redistribute the mark.

That matters more than it looks, because the drawing is the strongest right
this project actually holds. Switzerland is first-to-file (MSchG Art. 5), so
with no registration there is no trademark right in the *name* — only UWG
Art. 3(1)(d) and ZGB Art. 29 behind it, both of which turn on priority of
use. Copyright in the *logo* attached automatically when it was drawn, needs
no registration and runs for 70 years. It is free, it is already held, and
the licence is licensing it out.

Three smaller gaps found alongside:

- **No copyright notice on any brand asset.** All ten SVGs and the PNG carry
  none, so a copy that travels away from the repository carries no claim
  with it.
- **No use of ™ anywhere.** Free, needs no registration, lawful for an
  unregistered claim, and it is what marks the name as a mark rather than a
  word. (`®` is not available and would itself be misleading under UWG.)
- **First use is recorded only in the git log.** Priority of use is the fact
  a UWG or Verkehrsgeltung claim turns on; it should be stated, not left to
  be excavated.

## Work

- `LICENSE` — a licensor's statement above the Shield text (the Shield text
  itself stays verbatim) narrowing the copyright grant *for the brand assets
  only*: they are licensed for running, modifying and redistributing
  Fernscout itself, not for use as the identity of any other project or
  product. **Not** an exclusion from "the software" — that would make the
  repository as shipped unbuildable under its own licence and break the
  self-hosting promise, which is the opposite of the intent.
- The same as a `Required Notice:` line, so it propagates with every copy.
- A copyright notice in each of the eleven brand assets.
- `Fernscout™` in `README.md`, `TRADEMARK.md` and both imprints.
- A stated first-use date in `TRADEMARK.md`: 2026-08-31, commit `8089d55d`,
  where the name appears in the first commit message.

**Not doing:** registering the mark (IGE, ~CHF 550 for three classes — a
person's decision and a spend); adding ™ to `site/config.json`, because that
file is the *operator's* and a self-hoster's instance must not inherit
somebody else's trademark claim.

## Acceptance

- `LICENSE` still contains the official Shield 1.0.0 text byte for byte.
- No brand asset is without a copyright notice.
- `TRADEMARK.md` states the first-use date and no longer claims the licence
  withholds the logo when it does not.
- `npm run verify` passes.
