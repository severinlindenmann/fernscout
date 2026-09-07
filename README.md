# Fernscout™

*Travel mail — news from far away, arriving at home.*

A travel journal your agent writes for you. Markdown entries with photos and
video, a winding day-by-day path, and a scroll-driven animation of the
travellers moving between stops.

**There is no editing interface, and there will not be one.** Reading happens
in a browser; writing happens through an agent holding a token, over REST.
Everything an agent writes arrives as a draft, so you can read a day back
before it goes up.

## Use it hosted: [fernscout.ch](https://fernscout.ch)

Sign up with your email — no password, no install — and hand your agent one
address:

```
https://fernscout.ch/documentation.txt
```

It reads from there, asks you for a six-digit code, and starts writing. The
hosted instance runs the optional capabilities a self-hosted one has to
configure:

| | |
| --- | --- |
| **WhatsApp** | tell your readers a new day is up, on the app they already have |
| **Email** | the same, by mail |
| **Phone notifications** | web push to a phone or desktop, no app to install |
| **Postcards** | pick a photo, write a back, order real printed cards to real addresses |
| **Photobook** | a whole trip laid out as a print-ready PDF |

Sending anything physical or paid stops at a preview page with a button: an
agent proposes, you press. Addresses never reach an agent — cards are
addressed to people who asked your journal for one.

WhatsApp's template needs an image header, so the day's first photograph is
uploaded to Meta's servers before the message goes — for every trip,
including a `private` one. Mail differs here: it inlines the photograph so a
closed trip's picture never leaves the gate.

**What this does not promise.** fernscout.ch is a hobby project run by one
person, free, one journal per person. There is no uptime guarantee, no
durability guarantee and no support — best effort, and nothing more is
implied by it being offered. Your content is still markdown and photographs in
a folder, whoever hosts it: `npm run export -- <username>` hands the whole
journal back as a zip at any time, so self-hosting the same content later is
the documented way out, not a downgrade.

## Or self-host it

```bash
npm install
npm run dev            # http://localhost:3000
```

That is the whole setup for a public journal. **Your content is markdown and
photographs in a folder you own** — no database needed, and everything exports
as the files it already is. One instance serves many people:
`content/<username>/…`, reachable at `/<username>`. A demo journal ships in the
repo and serves at `/example`.

### Capabilities

Every optional capability is **off by default** and absent rather than broken
when disabled — a disabled capability's routes 404, they do not error — so
none needs a paid account to develop against: mail writes `.eml` files to a
folder, and every print provider has a `dry-run` backend that writes files
instead of printing anything. `FEATURE_NAMES` in
[`lib/config.ts`](lib/config.ts) is the complete, current list; this table is
checked against it:

| Feature | Needs | Off means |
| --- | --- | --- |
| `reactions` | — | no reactions on days |
| `costs` | — | no cost pages or totals |
| `push` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no web-push notifications |
| `mail` | transport-specific — `file`/`console` need nothing, `smtp` needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | nothing is sent |
| `whatsapp` | backend-specific — `dry-run` needs nothing, `cloud` needs `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | no WhatsApp announcements |
| `auth` | `SESSION_SECRET` + a database | no agent tokens at all — the whole write path is gone |
| `signup` | `SESSION_SECRET` + a database, and mail | nobody can create a journal on the instance |
| `contacts` | `CONTACTS_ENCRYPTION_KEY` + a database | no guests, no invite links, no buddy write-access, no approval queue |
| `postcards` | provider-specific — `dry-run` needs nothing, others need a key — + a database | no postcard ordering |
| `photobook` | provider-specific — `dry-run` needs nothing, others need a key — + a database | no photobook ordering |
| `logging` | — (operator-only, not a journal's choice) | no request logging |
| `credits` | a database (operator-only) | sending is never charged |
| `addressLookup` | provider-specific — the default (`photon`) needs nothing | no address suggestions in a contact form |
| `weather` | — | a day's `weather: true` is never looked up |
| `analytics` | a database | no visits page |

Three rules govern all of them: **enabling one is a promise the server has to
keep** — a flag on with its credentials missing refuses to boot, with the
reason, rather than half-working; **a journal's own `config.json` can narrow
the server's capabilities and never widen them** — a journal can never switch
on something the server itself cannot do; and **`auth` off still leaves the
whole public site working** — every reading page, the search index, the feed,
the sitemap — because a public trip's gate never touches a database or a
session. What you lose with `auth` off is writing, and guests.

For a production build, see [docs/running-locally.md](docs/running-locally.md);
for a VPS, see [docs/runbook.md](docs/runbook.md). What fernscout.ch itself
runs today is not repeated here, since a list here would drift the first time
a flag changes — read it live from
[fernscout.ch/api/health](https://fernscout.ch/api/health).

## What it looks like

Every picture below is the demo journal, on a production build. Nothing in it
belongs to a real person.

![A trip's story page: the winding day-by-day path down the left, the day card, and the route map beneath it](docs/screenshots/trip-story.jpg)

The story page. The rail on the left *is* the trip — one stop per day, with
what it cost. Scrolling it walks the travellers from stop to stop.

![One day's entry: the prose, three photographs, and the reaction row](docs/screenshots/day-entry.jpg)

One day: markdown prose, its gallery, the day's spend, and the reactions
readers leave. This is one file in `entries/`, rendered.

![The trip map: eighteen stops joined by the route travelled](docs/screenshots/trip-map.jpg)

Every stop on one map, drawn from the `lat` and `lng` in each entry's
frontmatter. The base map is baked into the build — no tile server, no API key.

![The gallery: every photograph from the trip in a grid, filterable by place](docs/screenshots/gallery.jpg)

The gallery, filterable by place, with a slideshow behind the button.

## What a day looks like

One markdown file per update, in
`content/<username>/trips/<trip-id>/entries/`, named `YYYY-MM-DD-slug.md`.
Frontmatter is plain YAML, Obsidian-compatible:

```markdown
---
title: "Lanterns of Hoi An"
date: "2026-08-26"
time: "16:45"                 # orders several updates within one day
location: "Hoi An"
country: "Vietnam"
lat: 15.8801
lng: 108.338
transportMode: "bus"          # flight | train | bus | motorbike | bicycle | boat | car | taxi | walk
transportFrom: "Da Lat"
transportTo: "Hoi An"
gallery:
  - src: "/media/<trip-id>/hoi-an/01.jpg"   # trip-relative; the username is added at read time
    type: "image"
    width: 1200
    height: 800
costs:
  - { label: "Dinner", amount: 180000, category: "food", currency: "VND" }
status: draft                 # present ⇒ not on the site
---

The diary text, in plain markdown.
```

Gaps are fine. A trip's own `trip.md` carries its title, dates, who was on it,
and its visibility: `private`, `public` or `guest`. An unrecognised value reads
as `private`, never as public — a typo must not publish somebody's trip.

The one thing that stays out of an agent's hands is invention. One made-up
memory, presented to somebody's family as fact, is not recoverable — so an
agent writes what it was told and leaves a field empty rather than guessing,
and content nobody lived is marked `test: true` and says so on the page.

## Commands

| | |
| --- | --- |
| `npm run dev` · `npm run build` · `npm start` | the site |
| `npm run verify` | the gate before pushing — build, `tsc`, `eslint`, tests, stopping at the first failure |
| `npm run ingest -- --user <u> --trip <id> <folder>` | a card of photos → dated, geotagged draft days |
| `npm run rates:update` | refresh the cached ECB rates |
| `npm run export -- <username>` | the whole journal as a zip |

## Documentation

Indexed at [docs/](docs/), which also says how far to trust it. A running
instance serves an owner-facing guide at `/docs`, the API reference at
`/docs/api`, and the full agent guide at `/agent.md` — generated from the same
constants the endpoints enforce, so they cannot drift.

| | |
| --- | --- |
| [running-locally.md](docs/running-locally.md) | production build on your machine; the agent API end to end |
| [runbook.md](docs/runbook.md) | deploying to a VPS, backups, restore |
| [architecture.md](docs/architecture.md) | where things live, and why they are shaped that way |
| [ingest.md](docs/ingest.md) | photographs, EXIF, geodata |
| [currencies.md](docs/currencies.md) | how money is stored, converted and refused |
| [deploy-mail.md](docs/deploy-mail.md) · [providers/](docs/providers/) | mail, and the print providers |
| [TESTING.md](docs/TESTING.md) · [qa/](docs/qa/) | the manual walkthrough, and the scenario catalogue |
| [branding/](docs/branding/) | the mark, the palette, and what not to do to them |
| [ROADMAP.md](docs/ROADMAP.md) | the decision log — cited by number from the code |
| [tasks/](docs/tasks/) · [plans/](docs/plans/) | everything still to do, and the record of intent |

Working in a checkout rather than over the network? [AGENTS.md](AGENTS.md) and
the skills in `.claude/skills/` cover the same jobs against files on disk.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: all four checks pass, the
dev server boots with a capability both on and off, and nothing personal goes
anywhere outside `content/` — there is a test that fails the build over that.

## Licence

[PolyForm Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0).
The source is public and free to use: run it, self-host it, change it,
redistribute it, for as long as you like, at no cost. The one restriction is
that you may not use it to provide a product that competes with Fernscout.

This is **source-available, not open source** — the non-compete clause is a
restriction the Open Source Definition does not allow, so the term does not
apply here and this project does not use it.

**`importers/` is MIT**, and is the one part of this repository that is. It
holds the parsers that read a location export — Google Timeline, GPX, and a
neutral format for anybody's own tool — and they are worth sharing on their own
terms: adding support for your own device should not mean reading a non-compete
clause first. The IMPORTERS section at the top of `LICENSE` is the operative
text, and `importers/README.md` is what one has to implement — one file per
format, grouped by the kind of data, with `<kind>/schema.ts` as the contract
and a check to run against your own.

The **name is outside that grant entirely** — Shield licenses copyright and
patents, never a trademark. The **waymark and wordmark are inside it and
narrowed**: they ship with the code so an instance can draw itself, and they
are not licensed as the identity of anything else. The BRAND ASSETS section at
the top of `LICENSE` is the operative text; [TRADEMARK.md](TRADEMARK.md) is
the policy behind it, and the document to read before using either.
