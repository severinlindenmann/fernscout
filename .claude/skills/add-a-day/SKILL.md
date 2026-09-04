---
name: add-a-day
description: Write one day of a Fernscout trip as a draft entry — from notes, a transcript, or a conversation. Use when the user says "write up today", "add a day", "add an entry", "turn these notes into a post", or hands over a voice-memo transcript. Always produces status:draft, and does not publish.
---

# Add a day

One day of a trip becomes one markdown file in
`content/<user>/trips/<trip-id>/entries/YYYY-MM-DD-slug.md`. That file **is** the
content — there is no database row to keep in step and no editor to open.

## The one rule

Everything you write here carries `status: draft`. Every reading path filters
drafts out (`lib/entries.ts`), so nothing you write is on the site until a
person deletes that line. Do not delete it yourself, do not offer to, and do
not ask for permission to — it is not yours to remove.

**Write only what you were told.** No weather nobody mentioned, no meals nobody
ate, no feelings nobody expressed. If you do not know where a photograph was
taken, leave `location` empty and say so. A blank field is a question the author
can answer in four seconds; an invented one is a lie they may never notice.

## Steps

### 1. Find the trip

```bash
ls content/*/trips/
sed -n '1,20p' content/<user>/trips/<trip-id>/trip.md
```

The `status: current` trip is usually the one meant. If more than one user has
trips, ask which journal — never guess between two people.

### 2. Read a neighbouring entry first

```bash
ls content/<user>/trips/<trip-id>/entries/ | tail -5
cat content/<user>/trips/<trip-id>/entries/<the-most-recent>.md
```

You are matching a voice, a language and a length. Read one before writing one.
If the journal is in German, write in German.

### 3. Check whether photographs are already in

If the day has photos on a card or in a folder, **stop and use the
`ingest-photos` skill instead** — it writes the entry for you with EXIF time,
coordinates and a sized gallery, and you then edit the prose. Coming here first
means writing frontmatter by hand that a command would have got right.

### 4. Write the file

Filename: `YYYY-MM-DD-<slug>.md`, slug lowercase with dashes, derived from the
title. Several updates in one day is normal — give them the same `date` and
different `time`.

```markdown
---
title: "Lanterns of Hoi An"
date: "2026-08-26"
time: "16:45"                 # optional; orders several updates within a day
location: "Hoi An"
country: "Vietnam"
lat: 15.8801                  # optional
lng: 108.338
transportMode: "bus"          # optional: flight|train|bus|motorbike|boat|car|walk
transportFrom: "Da Lat"
transportTo: "Hoi An"
tags: ["vietnam"]
costs:
  - { label: "Dinner", amount: 180000, category: "food", currency: "VND" }
status: draft
---

The prose, in plain markdown.
```

- `countryCode` is looked up from `country`; only set it if the lookup is wrong.
- Gallery items use **trip-relative** paths (`/media/<trip-id>/…`). The username
  is added at read time — never write it into frontmatter.
- A cost with no `currency` is read as the site's `baseCurrency`. A currency
  that this trip has no entry for in `trip.md`'s `rates:` block shows as
  unconverted rather than being counted wrong.

### 5. Verify it is a draft, and invisible

```bash
grep -c '^status: draft$' content/<user>/trips/<trip-id>/entries/<file>.md
npx vitest run test/entries.test.ts
```

Then tell the author, in one line: what you wrote, where the file is, and that
it is waiting for them. Offer to read it back.

**Do not offer to publish it, and this door is deliberately stricter than the
other one.** Over the network an agent publishes when asked — that is the rule
in `AGENTS.md`, and ROADMAP decision 28 — because the person deciding there
often has no folder and no editor, so refusing would leave them with no route
at all. Here they have both: you are in their checkout, they can see the file,
and deleting one line is a thing they can do in five seconds and undo just as
fast. Where the person has the shorter route, leave it to them.

If they ask you to publish it, do it — delete the `status: draft` line and say
so. What you must not do is *propose* it.

## Doing this against a running site instead

If you are not in the repository, the same operation is one call:

```
POST /api/v1/<user>/trips/<trip-id>/days     (REST — see /agent.md)
tools/call create_day                        (MCP  — see docs/providers/mcp.md)
```

Both refuse to overwrite an existing entry for the same date and title: a
`409` means you are retrying, not that you need a different title.
