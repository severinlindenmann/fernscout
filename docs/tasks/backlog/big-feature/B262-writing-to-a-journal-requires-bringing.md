---
id: B262
title: Writing to a journal requires bringing your own agent, so an owner without one cannot write at all
type: FEATURE
priority: medium
complexity: high
area: web, auth, media, editing
found: "2026-09-04T11:16:59Z"
---

# B262 — Writing to a journal requires bringing your own agent, so an owner without one cannot write at all

## This contradicts decision 24, deliberately

Decision 24 in `docs/ROADMAP.md` says **"the frontend has no editing UI, ever"**,
and `AGENTS.md` repeats it as "no web form, no upload widget, no CMS — and there
will not be one". This capture asks for exactly that thing. It is filed rather
than argued away because the author asked for it, but **promoting it out of
`backlog/` is also a decision to amend decision 24 and the paragraph in
`AGENTS.md` that cites it** — the way decisions 12 and 19 carry their amendments
in the table. Do not start the work on the strength of this file alone.

The asked-for shape: a `/agent` route where a person signs in or creates an
account, and then manages their journal from the browser — writing entries,
uploading photos, editing what is there.

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

Every write path assumes the owner has an agent of their own. `/agent.md` tells
one how to authenticate; `/api/v1/…` and `/api/mcp` are what it calls; the ten
skills in `.claude/skills/` are for an agent sitting in this repository. Nothing
in the product writes a day for somebody who has no Claude subscription, no MCP
client and no checkout — for them the journal is readable and permanently empty.

The account half of that is already partly built. `POST /api/auth/signup` issues
a code, `SessionKind` in `lib/auth/index.ts:29` already has a third value
`"signup"` beside `guest` and `agent`, and a journal can be created without one
existing first. What is missing is anything to *do* after signing in: there is no
page, and no session kind a browser can hold that is allowed to write.

That last point is the real problem, and it is not a forms problem. Decision 24
is a security position as much as an editorial one: agent tokens arrive in
`Authorization: Bearer` and nowhere else, guest sessions arrive in a cookie and
nowhere else, `resolveSession()` refuses to treat one as the other, and the
reason given is that reading the site on your phone must not put a credential
that can rewrite it in your pocket. A browser that can write needs a cookie
session that can write. Inventing one weakens the property the current split
buys — so whatever is built here has to say what replaces it (a shorter-lived
owner session? re-authentication before a write? a separate cookie that the
read paths never see?), and that answer belongs in a plan in `docs/plans/`
before any route is written.

Two smaller things a reader would otherwise trip over:

- **`/agent` collides with `/agent.md`** in a way that will confuse both people
  and agents — one is the guide that says browsers cannot write, the other would
  be the browser that writes. Whatever this is called, `/agent.md` has to stop
  claiming what is no longer true.
- **The draft rule and the publish gate are content rules, not agent rules.** A
  web editor must arrive at `status: draft` too, and publishing must stay a
  second, separate act — B28, B223 and B224 are the history of getting that
  wrong. It must not become "Save" meaning "live".

## Work

Not decided here. A plan first (`docs/plans/`), because the session question
above has to be answered before the UI is designed, and this task points at it.

The pieces the plan has to cover, so the size is visible:

- **The decision.** Amend decision 24 in `docs/ROADMAP.md` and the "one rule"
  section of `AGENTS.md`, in the amendment style the table already uses. Neither
  is optional: an agent reading the current text will remove this feature as a
  mistake.
- **A writing browser session.** What kind it is, how long it lasts, what it
  cannot do, and how `resolveSession()` keeps it separate from both existing
  kinds. Owner only to begin with; trip people and buddies (B33) are a later
  question, not a silent inclusion.
- **Sign in and sign up.** Reuse `POST /api/auth/request` / `/verify` and
  `/api/auth/signup` rather than a second code path.
- **The editor itself.** Entries and trip metadata, on top of the existing
  `/api/v1/…` handlers rather than beside them — one write path, or the two
  disagree about validation within a month.
- **Uploads.** The browser side of `app/api/v1/[user]/trips/[trip]/media`, and
  the `media` block in `content/config.json` — per-file size, per-day count, the
  per-journal byte quota — enforced and *shown*, since a rejected 12 MB photo is
  the first thing a person will hit (B229 is related).
- **Off by default.** This is an optional capability like every other, so
  `lib/capabilities.ts` decides and `/api/health` explains why it is off. A
  self-hoster who agrees with decision 24 as written keeps a site with no editor
  in it, and it must be absent rather than a dead button (§1.1).

Explicitly **not** in scope: a public multi-tenant signup funnel, and anything
that lets a browser session hold or mint an agent token.

## Acceptance

- `docs/ROADMAP.md` decision 24 and the `AGENTS.md` rule both say what is now
  true, with the reasoning, and no document still promises there will never be
  an editing UI.
- With the capability off: no `/agent` route, nothing in the nav, and
  `/api/health` says why. With it on: a person who has never seen the folder can
  sign in, write a day, upload a photo to it, see it as a draft, and publish it
  as a separate act.
- A test asserts a browser write session cannot be used as a `Bearer` token and
  an agent token cannot be used as the write cookie.
- A test asserts a day created through the web editor arrives with
  `status: draft`.
- Over-quota and over-size uploads are refused with a message that names the
  limit, not a 500.
