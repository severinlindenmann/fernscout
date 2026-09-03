---
id: B155
title: Nothing in the repo tells a reader that fernscout.ch will host their journal, or what it promises
type: FEATURE
priority: medium
complexity: low
area: readme, docs, hosting
found: "2026-09-03"
---

# B155 — Nothing in the repo tells a reader that fernscout.ch will host their journal, or what it promises

## Why

`README.md` has one path through it: clone, `npm install`, `npm run dev`, and
here is a VPS runbook. But there is a running instance at fernscout.ch with
`signup` switched on — `/api/health` reports
`"signup":{"enabled":true}` alongside `auth`, `mail` and `contacts` — which
means anybody can already have a journal on it without owning a server. The
repository does not mention this anywhere. A reader who wants a travel journal
and not a sysadmin hobby currently bounces.

The second half is the more important one. A free hosted instance run by one
person as a hobby project makes an implicit promise it cannot keep, and the
place to say so is the same paragraph that offers it — not a terms page nobody
reads. **No uptime guarantee, no durability guarantee, no support.** The
project's own answer to that is unusually good and should be said in the same
breath: the content is markdown and photographs in a folder, and
`npm run export -- <username>` hands the whole journal back as a zip. The
disclaimer and the escape hatch belong together.

There is also a real gap between what the README calls optional and what the
managed instance actually runs. The README lists "mail, sign-in, guests, push,
print" as the optional capabilities. On fernscout.ch today, `push`, `postcards`
and `photobook` are **off** (`/api/health`), while `reactions`, `costs`,
`mail`, `auth`, `signup` and `contacts` are on. A reader told about postcards
and photobooks who then signs up for the managed journal does not find them.
Whatever is written has to be true of the instance it is written next to.

Related to B154, the screenshots half of the same README pass.

## Work

Add a section to `README.md` — before or beside "Running it", since it is the
other way in — covering three things.

**The offer.** fernscout.ch hosts journals; the limit as the author states it
is one journal per person, free. Note how it is actually obtained: signup is
API-only (`app/api/auth/signup/request`, `…/verify`), there is no web form and
by decision 24 there will not be one, so the instruction is to hand an agent
`https://fernscout.ch/documentation.txt` — which already opens with the five
questions to ask before creating anything.

**What it does not promise.** Hobby project, one person, best effort. No
uptime, backup or retention guarantee. Immediately followed by the export and
the fact that self-hosting the same content is the documented alternative, not
a downgrade.

**What is switched on, and what each switch means.** Two separate lists,
because they answer different questions and the README currently blurs them
into one line ("mail, sign-in, guests, push, print").

*The software's switches.* `FEATURE_NAMES` in `lib/config.ts:8-18` is the
complete set — nine, and that file is "the only place it gets named". The
README should carry a table of all of them, because a self-hoster deciding what
to run has nowhere else to look: `lib/capabilities.ts` is source, and
`docs/` no longer holds the runbook it used to (B62, B9). For each: what it
enables, what it costs to turn on, and what the site does without it.

| Feature | Needs | Off means |
| --- | --- | --- |
| `reactions` | — | no reactions on days |
| `costs` | — | no cost pages or totals (`lib/photobook/source.ts:51` also drops costs from a book) |
| `push` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no web-push notifications |
| `mail` | transport-specific — `file`/`console` need nothing, `smtp` needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | nothing is sent; note `keepCopy` writes plaintext copies to disk and `/api/health` reports it as `keepingCopies` |
| `auth` | `SESSION_SECRET` + `DATABASE_URL` | no agent tokens at all — the whole write path is gone (see below) |
| `signup` | `SESSION_SECRET` + `DATABASE_URL`, and mail, checked in the route rather than in `REQUIREMENTS` | nobody can create a journal on the instance |
| `contacts` | `CONTACTS_ENCRYPTION_KEY` + `DATABASE_URL` | no guests, no invite links, no buddy write-access, no approval queue |
| `postcards` | provider-specific — `dry-run` needs nothing; `stannp`, `swisspost` need keys — + `DATABASE_URL` | no postcard ordering |
| `photobook` | provider-specific — `dry-run`, `peecho`, `gelato`, `cloudprinter`, `lulu` | no photobook ordering |

Three rules govern all nine and belong in the same section, because each one
answers a question a self-hoster will otherwise ask in an issue:

- **Off by default, and absent rather than broken.** A disabled capability's
  routes 404; they do not error.
- **Enabling one is a promise the server has to keep.** `assertCapabilities()`
  (`lib/capabilities.ts:170`) refuses to boot when a flag is on and its
  credentials are missing, with the reason. The comment says why: the
  alternative is finding out at 3am when somebody presses send.
- **Server config is a ceiling, a journal's own `config.json` opts in
  underneath it** (`resolveOne`, `lib/capabilities.ts:103`). A user can never
  switch on something the server cannot do. On a multi-journal instance this is
  the difference between "the server offers guests" and "this journal uses
  them", and `/api/health` reports the per-journal *differences* only.

**Verified, so the README can say it plainly: disabling `auth` leaves the
public site whole.** Booted at the repo's shipped defaults — `auth`,
`contacts`, `mail`, `signup` all false, no `DATABASE_URL` — every reading
surface answered 200: `/`, `/example`, `/example/trips`,
`/example/trips/asia-2023`, `.../map`, `.../gallery`, `.../costs`,
`.../day/<slug>`, `/example/search`, `/documentation.txt`, `/agent.md`,
`/sitemap.xml`. `/api/auth/request`, `/api/mcp` and `/api/v1/...` answered 404,
and the server log was clean. The mechanism is `mayReadTrip`
(`lib/tripGate.ts:27`): `isOpenToLink(trip)` returns before anything touches
the database, so a public trip never needs a session or a DB. That is the
concrete form of the README's existing claim that "no database is needed to run
a public journal", and it is worth stating as *what you lose* — writing, and
guests — rather than as a list of flags.

*The managed instance's switches.* Which of the nine fernscout.ch actually
runs, kept separate from the above. Today: `reactions`, `costs`, `mail`,
`auth`, `signup`, `contacts` on; `push`, `postcards`, `photobook` off. Read it
from `/api/health` on the day of writing rather than from this ticket, and
consider pointing the README at that URL instead of restating a list that
drifts the first time a flag changes — the same reason `AGENTS.md` refuses to
repeat the entry field list.

Not in scope: a pricing page, a signup web form, terms of service or a privacy
policy as separate documents. If the disclaimer needs to be more than a
paragraph, that is its own task.

## Acceptance

- `README.md` names fernscout.ch as a hosted option, states the one-journal-per-person
  limit, and says in plain words that it is a hobby project with no guarantee
  of uptime or data retention.
- The same section says how to actually get a journal — an agent, the
  `documentation.txt` address — rather than implying a sign-up page exists.
- All nine names in `FEATURE_NAMES` (`lib/config.ts:8-18`) appear in the README
  with what they enable and what they require, and the list is checked against
  that constant rather than written from memory.
- The README states that capabilities are off by default, that a wrongly
  configured one fails the boot, and that a journal's config narrows the
  server's and never widens it.
- The README says what a journal with `auth` off still does — the whole public
  site — rather than only what it loses.
- Any capability the README claims the managed instance offers is `enabled:true`
  in `https://fernscout.ch/api/health` on the day it is written, or the README
  points at that endpoint instead of listing them.
- `npm run export` is mentioned as the way out, in the same section as the
  disclaimer.
- The author has answered the "extra features" question above and the task file
  records which reading was built.
