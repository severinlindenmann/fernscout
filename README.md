# Fernscout

*Travel mail — news from far away, arriving at home.*

A self-hostable travel journal: markdown entries with photos and video, a
winding day-by-day path, and a scroll-driven animation of the travellers moving
between stops.

Two things make it unlike the apps it resembles.

**Your content is markdown and photographs in a folder you own.** No database
is needed to run a public journal, and everything exports as the files it
already is.

**There is no editing interface, and there will not be one.** Reading happens
in a browser; writing happens through an agent holding a token, over REST or
MCP. Which means the rule everything else is built around:

> **Anything an agent creates is a draft.** A person removes one line from one
> file to publish it. There is no parameter, flag or endpoint anywhere that
> skips that step — because one invented memory, presented to somebody's family
> as fact, is not recoverable.

One instance serves many people: `content/<username>/…`, reachable at
`/<username>`. A demo journal ships in the repo and serves at `/example`, so a
fresh clone renders something real before you have written anything.

## Running it

```bash
npm install
npm run dev            # http://localhost:3000
```

That is the whole setup for a public journal. Every optional capability — mail,
sign-in, guests, push, print — is **off by default** and absent rather than
broken when disabled, so none of them needs a paid account to develop against:
mail writes `.eml` files to a folder, and every print provider has a dry-run
backend.

For a production build on your own machine, and the three things that otherwise
cost an hour, see [docs/running-locally.md](docs/running-locally.md).

## Writing with an agent

Hand an agent two things: the address of your instance's guide, and the email
the journal belongs to.

```
https://your-site.example/documentation.txt
```

It reads from there, asks for a six-digit code, and exchanges it for a token
that can write for seven days — as drafts. `/agent.md` is the full guide,
generated from the same constants the endpoints enforce, so it cannot drift
from them.

Working in a checkout rather than over the network? [AGENTS.md](AGENTS.md) and
the skills in `.claude/skills/` cover the same jobs against files on disk.

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
transportMode: "bus"          # flight | train | bus | motorbike | boat | car | walk
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

Gaps are fine — no-signal days, rest days you skip. The path and "jump to
today" use whatever dates exist. Several updates on one day render as a branch
off that day. A day with no `transportMode` simply has no travel scene before
it.

A trip's own `trip.md` carries its title, dates, who was on it, and its
visibility: `private`, `public` or `guest`. An unrecognised value reads as
`private`, never as public — a typo must not publish somebody's trip.

## Commands

| | |
| --- | --- |
| `npm run dev` · `npm run build` · `npm start` | the site |
| `npx tsc --noEmit` · `npx eslint .` · `npm test` · `npm run build` | the gate, all four before pushing |
| `npm run ingest -- --user <u> --trip <id> <folder>` | a card of photos → dated, geotagged draft days |
| `npm run rates:update` | refresh the cached ECB rates |
| `npm run export -- <username>` | the whole journal as a zip |
| `npm run trip:password -- "<password>"` | hash a password for a guest trip |

## Documentation

| | |
| --- | --- |
| [running-locally.md](docs/running-locally.md) | production build on your machine; the agent API end to end |
| [runbook.md](docs/runbook.md) | deploying to a VPS, backups, restore |
| [architecture.md](docs/architecture.md) | where things live, and why they are shaped that way |
| [ingest.md](docs/ingest.md) | photographs, EXIF, geodata |
| [currencies.md](docs/currencies.md) | how money is stored, converted and refused |
| [config-upgrades.md](docs/config-upgrades.md) | moving a config file forward a version |
| [deploy-mail.md](docs/deploy-mail.md) | mail, and the file transport that needs no SMTP |
| [providers/](docs/providers/) | MCP, and the print providers |
| [TESTING.md](docs/TESTING.md) · [qa/](docs/qa/) | the manual walkthrough, and the scenario catalogue |
| [branding/](docs/branding/) | the mark, the palette, and what not to do to them |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: all four checks pass, the
dev server boots with a capability both on and off, and nothing personal goes
anywhere outside `content/` — there is a test that fails the build over that.

## Licence

AGPL-3.0. The **name and the waymark are not covered by it** — see
[TRADEMARK.md](TRADEMARK.md) before using either outside this repository.
