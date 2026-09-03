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

**What is switched on.** A short, honest list of the capabilities the managed
instance actually runs, separated from the capabilities the software has. The
live state is readable at `/api/health` — use it rather than writing from
memory, and consider whether the README should point at that URL instead of
restating a list that will drift the first time a flag changes. Drift is the
predictable failure here: a hand-written feature list in the README and a
`features` block in `content/config.json` disagree within a month, which is the
same reason `AGENTS.md` refuses to repeat the entry field list.

Open question for the author, needed before writing: **"extra features
available"** — whether that means (a) the optional capabilities a self-hoster
can switch on, which the README half-covers today, or (b) extras offered on
the managed instance beyond the free journal, including whether postcards and
photobooks — which cost real money to print — are meant to be available there
at all, and on what terms. The two produce different paragraphs.

Not in scope: a pricing page, a signup web form, terms of service or a privacy
policy as separate documents. If the disclaimer needs to be more than a
paragraph, that is its own task.

## Acceptance

- `README.md` names fernscout.ch as a hosted option, states the one-journal-per-person
  limit, and says in plain words that it is a hobby project with no guarantee
  of uptime or data retention.
- The same section says how to actually get a journal — an agent, the
  `documentation.txt` address — rather than implying a sign-up page exists.
- Any capability the README claims the managed instance offers is `enabled:true`
  in `https://fernscout.ch/api/health` on the day it is written, or the README
  points at that endpoint instead of listing them.
- `npm run export` is mentioned as the way out, in the same section as the
  disclaimer.
- The author has answered the "extra features" question above and the task file
  records which reading was built.
