![Fernscout — travel mail: news from far away, arriving at home](docs/branding/readme-hero.svg)

# Fernscout

**An open-source travel journal you host yourself.** Talk through your day
with an AI agent, your own or the helper built into Fernscout, and it writes
the day up: the place, the route, the photographs, what it cost. Your family
and friends read it in a browser. Everything stays JSON and photographs in a
folder you own.

[See a real journal](https://fernscout.ch/example) ·
[Run your own](#run-it) ·
[Docs](docs/)

[![CI](https://github.com/severinlindenmann/fernscout/actions/workflows/ci.yml/badge.svg)](https://github.com/severinlindenmann/fernscout/actions/workflows/ci.yml)
[![Licence: Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)
[![Node 24](https://img.shields.io/badge/node-24-brightgreen)](.nvmrc)

## What it looks like

Every picture is the demo journal, on a production build.

| | |
| --- | --- |
| [![A trip's story page: the winding day-by-day path, the day card, the route map](docs/screenshots/trip-story.jpg)](https://fernscout.ch/example) | [![One day's entry: the prose, three photographs, the reaction row](docs/screenshots/day-entry.jpg)](https://fernscout.ch/example) |
| The story page. The rail on the left *is* the trip, one stop per day. | One day: prose, photographs, what it cost, and readers' reactions. |
| [![The trip map: every stop joined by the route travelled](docs/screenshots/trip-map.jpg)](https://fernscout.ch/example) | [![The gallery: every photograph from the trip, filterable by place](docs/screenshots/gallery.jpg)](https://fernscout.ch/example) |
| Every stop on one map. The base map is built in: no tile server, no API key. | The gallery, filterable by place, with a slideshow. |

## Run it

You need Node 24 (the exact version is in `.nvmrc`). A public journal needs no
database, no keys and no accounts:

```bash
git clone https://github.com/severinlindenmann/fernscout.git
cd fernscout
npm install
npm run dev            # then open http://localhost:3000/example
```

`/example` is a demo journal that ships in the repository. Your own journal
lives in `content/<username>/` and appears at `/<username>`. One instance can
host many people.

**No agent yet?** A day is one JSON file, so you can start by hand: copy an
entry from `content/example/trips/*/entries/`, change it, and reload. Or turn a
folder of photos into dated, geotagged draft days:

```bash
npm run ingest -- --user <you> --trip <trip-id> ./photos
```

To run it for real, see [docs/running-locally.md](docs/running-locally.md) for
a production build and [docs/runbook.md](docs/runbook.md) for a server with
backups.

## How it works

- **An agent writes, a browser reads.** There is no CMS. Days arrive over a REST
  API from an agent holding a token: your own assistant, or the built-in helper
  with your own model key. In the browser you read, and you can correct a day in
  place.
- **Every day starts as a draft.** Nothing goes public until you publish it.
- **Nothing is invented.** An agent writes what it was told and leaves a field
  empty rather than guessing. One made-up memory, shown to somebody's family as
  fact, can't be taken back.
- **Your files, your folder.** A day is one JSON file and a photograph is a
  file. `npm run export -- <username>` hands a whole journal back as a zip.
- **Closed by default.** Every optional capability is off until you switch it
  on, and switched off it is absent, not broken.
- **No paid account needed to develop.** Mail writes `.eml` files to a folder,
  and every provider has a dry-run mode.

Not a blog you type into and not an app that keeps your photos: the journal is
written from what you tell it, and it stays in files you can take anywhere.

## What a day looks like

One JSON file per day, in
`content/<username>/trips/<trip-id>/entries/YYYY-MM-DD-slug.json`:

```json
{
  "title": "Lanterns of Hoi An",
  "date": "2026-08-26",
  "time": "16:45",
  "timezone": "Asia/Ho_Chi_Minh",
  "location": "Hoi An",
  "country": "Vietnam",
  "countryCode": "VN",
  "coordinates": { "lat": 15.8801, "lng": 108.338 },
  "content": "The diary text, in plain markdown.\n\nBlank lines and all.",
  "transportMode": "bus",
  "transportFrom": "Da Lat",
  "transportTo": "Hoi An",
  "media": [
    { "src": "/media/<trip-id>/hoi-an/01.jpg", "type": "image", "width": 1200, "height": 800 }
  ],
  "costs": [
    { "label": "Dinner", "amount": 180000, "category": "food", "currency": "VND" }
  ],
  "status": "draft"
}
```

Only `"status": "published"` puts a day on the site; anything else reads as a
draft. A file that isn't valid JSON is skipped and logged, and the rest of the
trip still shows. A trip's `trip.json` holds its title, dates, travellers,
budget, planned route, exchange rates and visibility: `private`, `public` or
`guest`. An unknown visibility reads as `private`, so a typo can't publish
somebody's trip.

## What's in the box

| | |
| --- | --- |
| **Trips and days** | a story page per trip, one entry per day, and trips that are private, public or for guests only |
| **Maps** | every stop on one route map, with the base map built into the app |
| **Photographs** | galleries, a slideshow, and EXIF import that turns a card of photos into draft days |
| **Costs** | what the trip cost, per day and in total, in any currency, converted with ECB rates |
| **Readers** | reactions, guests and invite links, and new-day mail and web push, with no app to install |
| **Helper** | a writing helper, dictation and photo descriptions, with your own Anthropic and Deepgram keys |
| **Location** | importers for Google Timeline and GPX, and route recording from the iPhone app in `ios/` |
| **API** | a versioned REST API with a generated OpenAPI document, and agent guides at `/documentation.txt` |

> **fernscout.ch, the hosted edition.** Don't want to run a server?
> [fernscout.ch](https://fernscout.ch) runs this code for you, free, one journal
> per person, and adds a few things that need one operator behind them:
> **printed photobooks**, **real postcards** to your readers' addresses,
> **WhatsApp** (a guided helper for people without an agent, and new-day
> messages), and **credits** to pay for what costs money to send. Those live in
> a separate private repository. fernscout.ch is a hobby project run by one
> person, with no uptime or support guarantee, and your journal stays plain
> files you can export and move to your own instance at any time.

## Self-hosting

Every optional capability, from reactions and mail to the helper and dictation,
is off by default. Switching one on is a promise: if its credentials are
missing, the server refuses to boot and says why. A journal can switch a
capability off for itself, never on. With writing switched off entirely, every
public page, the search, the feed and the sitemap still work.

[docs/capabilities.md](docs/capabilities.md) lists every capability, what it
needs and what switching it off means.

## Commands

| | |
| --- | --- |
| `npm run dev` · `npm run build` · `npm start` | the site |
| `npm run verify` | build, `tsc`, `eslint`, tests and knip, stopping at the first failure |
| `npm run ingest -- --user <u> --trip <id> <folder>` | a folder of photos into dated, geotagged draft days |
| `npm run rates:update` | refresh the cached ECB exchange rates |
| `npm run export -- <username>` | a whole journal as a zip |

## Documentation

[docs/](docs/) is the index. A running instance also serves an owner guide at
`/docs`, the API reference at `/docs/api`, and the agent guide at
`/documentation.txt`, generated from the same constants the API enforces.

| | |
| --- | --- |
| [running-locally.md](docs/running-locally.md) | a production build on your machine, and the agent API end to end |
| [runbook.md](docs/runbook.md) | deploying to a server, backups, restore |
| [capabilities.md](docs/capabilities.md) | every optional capability and what it needs |
| [architecture.md](docs/architecture.md) | where things live, and why |
| [ingest.md](docs/ingest.md) | photographs, EXIF and geodata |
| [gps.md](docs/gps.md) | location history, and how little of it is ever shown |
| [currencies.md](docs/currencies.md) | how money is stored, converted and refused |
| [deploy-mail.md](docs/deploy-mail.md) | mail |
| [branding/](docs/branding/) | the mark, the palette, and what not to do to them |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm run verify` passes, the
dev server boots with a capability both on and off, and nothing personal goes
anywhere outside `content/`. A test fails the build over that.

## Licence

[Apache License 2.0](LICENSE): use it, self-host it, modify it, fork it,
including to run your own service. [NOTICE](NOTICE) lists the bundled map and
place-name data and their licences. `importers/` is MIT, so adding your own
device's location export doesn't mean reading anything else first;
`importers/README.md` is the contract.

The name and logo are not included. "Fernscout", the waymark and the wordmark
stay outside the Apache grant: [BRAND-LICENSE](BRAND-LICENSE) lists the files
and [TRADEMARK.md](TRADEMARK.md) explains the policy. Your own instance may show
them, because an instance has to draw itself. A public fork under another name
replaces them.
