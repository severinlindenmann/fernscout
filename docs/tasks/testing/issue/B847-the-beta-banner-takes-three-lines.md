---
id: B847
title: The beta banner takes three lines and a lot of height on a phone
type: ISSUE
priority: low
complexity: low
area: landing, banner
found: "2026-09-07T18:55:00Z"
merged: "2026-09-07T16:54:36Z"
---

# B847 — The beta banner takes three lines and a lot of height on a phone

## Why

The owner: *"make the maintenance banner smaller, and also shorter text — only
one line."*

Two causes, and they need fixing in two different places.

**The box is generous.** `app/page.tsx:86` draws it `px-6 py-3 text-sm
leading-6` with a `border-b-2`. That is a comfortable notice on a laptop and a
large block on a phone, sitting above everything else on the first screen a
visitor sees.

**The words are a paragraph.** The text is the operator's own, in
`site.banner` — which is not in the repository's `site/config.json` at all but
in the deployed instance's `FERNSCOUT_CONFIG` (`/var/lib/fernscout/config.json`),
because an operator's notice must survive a `git pull`. Today it reads *"Beta
– Testphase: Einige Funktionen sind noch unvollständig, und Datenverlust ist
nicht auszuschliessen."* — 103 characters, three lines at 390px.

So the code change alone cannot fix this, and neither can the text alone.

## Work

- **The box**: smaller type and less vertical space — `py-2`, `text-xs`, a
  tighter leading, and a single-weight bottom border. It is a standing notice
  rather than an alert; it should be legible and out of the way.
- **The words**: shorten all three languages to one line at 390px, keeping
  both facts the notice exists to carry — that the software is unfinished and
  that data can be lost. That second half is the one with consequences; do not
  drop it to save characters.
- Swiss German spelling: `ss`, never `ß` — the existing text uses
  "auszuschliessen".
- The text lives on the server. Changing it is an operations step after the
  deploy, not part of the diff.

## Acceptance

- The banner is one line at 390px in all three languages.
- Its height is materially less than today's — state the measured before and
  after.
- It still says the software is in beta and that data can be lost.
- The shipped `site/config.json` still carries no banner, so a self-hoster
  inherits nobody else's notice.

## Done — the code half

`app/page.tsx`: `px-6 py-3 text-sm leading-6` and a `border-b-2` become
`px-4 py-1.5 text-xs leading-5` and a single-weight border.

Measured at 390px with the proposed one-line text in place (the banner was set
locally for the measurement and reverted before commit — the shipped
`site/config.json` still carries none, so a self-hoster inherits nobody's
notice):

| | height | lines |
| --- | --- | --- |
| before | ~98px | 3 |
| after | **33px** | 1 |

One line in all three languages.

## The words — an operations step, not part of this diff

The text lives in the deployed instance's `FERNSCOUT_CONFIG`. To be applied to
`/var/lib/fernscout/config.json`, keeping both facts the notice exists to
carry — unfinished software, and data that can be lost:

| | |
| --- | --- |
| `text` | Beta — features are missing, and data can be lost. |
| `de` | Beta — Funktionen fehlen, Daten können verloren gehen. |
| `hu` | Béta — hiányzó funkciók, az adatok elveszhetnek. |

Swiss `ss` throughout; no `ß`.
