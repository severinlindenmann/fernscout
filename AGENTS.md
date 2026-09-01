<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fernscout, for agents

A self-hostable travel journal. **The content is markdown and photographs in a
folder the author owns.** There is no editing interface — no web form, no upload
widget, no CMS — and there will not be one (ROADMAP decision 24). Reading happens
in a browser; writing happens through an agent, which is why this file exists.

Two ways in, and they are the same content behind two doors:

| You are | Use |
| --- | --- |
| Working **in this repository**, with the files on disk | the skills in `.claude/skills/`, and this file |
| Working **against a running site**, over the network | `/agent.md` (the guide), `/api/v1/…` (REST) and `/api/mcp` (MCP) |

## The one rule

**Anything an agent creates is a draft.** `status: draft` in the frontmatter,
and every reading path filters it out in `lib/entries.ts`. There is no
parameter, argument or flag on anything that *writes* which skips the step —
not in the REST API, not in MCP, not in the skills below.

Publishing is a **separate, deliberate call** the person asks for:
`POST /api/v1/<user>/trips/<trip>/days/<slug>/publish`, or `publish_day` over
MCP. Owner only — a trip-scoped token writes days and cannot put them on the
site — and refused once, with a code bound to that one day.

Be exact about what that guarantees, because it is less than it looks. An agent
holds both calls; the confirmation makes publishing a distinct act it has to
mean, not proof that a human consented. The guarantee is structural — writing
can never publish — and the rest is instruction: **ask, in words, and wait for
an answer.** B28 records why it exists at all: the person the rule reserves this
for is often somebody who has never seen the folder, and telling them to edit a
file was advice with nowhere to go.

One invented memory presented to somebody's family as fact is not recoverable.
So: write what you were told. No weather nobody mentioned, no meals nobody ate,
no feelings nobody expressed. An empty field beats a plausible fiction.

**`test: true`** is the exception, and the only one. A day or a trip carrying it
is content nobody lived, written to prove the pipeline works: the page says so
in a banner, and it is kept out of the feed, the search index and the sitemap.
Use it when you were asked to invent something. Writing "this is a test" into
the prose instead is a convention, not a guarantee — the next reader has no way
to know whether you bothered.

## The content model

Everything a person owns lives under `content/<username>/`. Nothing user-owned
is written anywhere else.

```
content/
  config.json                 server config — site name, URL, default user,
                              reserved usernames, capability switches, and the
                              `media` block: how large uploads may be, how many
                              per day, and an optional per-journal byte quota.
                              A user's own config.json may narrow these, never
                              widen them.
  rates/ecb.json              shared currency reference rates
  .deleted/<username>.json    a journal that was deleted. Keeps the name
                              reserved and makes its old URLs answer 410.
                              Gitignored; an operator frees the name by
                              deleting the file. See lib/tombstones.ts.
  <username>/
    config.json               who this person is: title, tagline, owner,
                              locales, baseCurrency, per-user features
    trips/
      <trip-id>/
        trip.md               the trip's metadata (frontmatter) + intro prose
        entries/
          YYYY-MM-DD-slug.md  one update. Several per day is normal.
        costs.md              budget + preparation costs (optional)
        plan.md               planned route (`route:` of `location:` stops),
                              for an upcoming trip (optional)
        media/                derivatives served to the browser
        .ingest.json          what ingest has already imported (do not edit)
    postcards/ photobooks/ mail/    generated output (gitignored)
```

A trip is addressed as a **ref**: `<username>/<trip-id>`. Trip ids are unique
within a user, not across the instance, so nothing addresses a trip by id alone.
`lib/trips.ts` has `tripRef()` and `parseTripRef()`; use them rather than string
concatenation, because a username is a directory name and therefore a security
boundary.

### The shape of an entry and a trip

Not repeated here. The two skills that write them carry the field lists in the
place you will actually be reading them — `add-a-day` for an entry,
`add-a-trip` for `trip.md`, `costs.md` and `plan.md`. A reference kept in two
files is a reference that disagrees with itself within a month, and this one
already had: the visibility vocabulary changed in W27 and only one copy
followed.

Two things about a trip are worth knowing before you open either.

**`visibility` says who is let in** — `private` (the people on the trip, and
the owner), `public` (everyone), or `guest` (everyone the owner has let into
the *journal*, and the people on the trip). An unrecognised value reads as
`private`, never as `public`: a typo must not publish somebody's trip.
`listed:` is the separate question of whether it is advertised at all.

The line between the two closed values is what a person gets wrong at the
moment they create a trip: **`guest` means the people I let into this journal;
`private` means only the people who were there.** A guest is a guest of the
journal and never of one trip — approving somebody opens every `guest` trip in
it, at once and for as long as the approval lasts. A trip that must be held
back from people who are otherwise let in is `private`, and that is the only
mechanism; there is deliberately no narrower one.

**`people:` is who took it** — up to ten, each a name and an email. Everyone
listed may write to the whole trip, and may hold an agent token scoped to it
and to nothing else in the journal. It is also who the trip is credited to.

A **journal** has a `visibility` too, in its own `config.json`, and it is a
different question: `public` or `private`, meaning only whether this instance
advertises the journal — on `/documentation.txt`, on the landing page, in
`sitemap.xml`. A private journal is unlisted, not locked; who may read a
*journey* is still the trip's own gate. Absent means `public`, which is what
every journal written before W38 is.

## Working in this repository

- **Local dev is SQLite, production is Postgres**, and nothing outside
  `lib/db/` knows which.
- **No feature needs a paid account to develop or test.** Mail writes `.eml`
  files under `content/<user>/mail/`, OTP codes are printed, and every print
  provider has a `dry-run` backend that writes files.
- **Every optional capability is off by default** and must be *absent* rather
  than broken when disabled. `lib/capabilities.ts` decides, and `/api/health`
  explains why something is off.
- **Secrets never enter `content/config.json`** — environment only.
- **Nothing personal in code.** `test/depersonalised.test.ts` fails the build if
  a real name or trip id appears outside `content/`.

### Verifying a change

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

All four, every time. The dev server must boot with a capability both on and
off.

## Skills

`.claude/skills/` holds the tasks the author actually performs. Each is a
`SKILL.md` you can follow start to finish:

| Skill | For |
| --- | --- |
| `add-a-day` | Write one day's entry, as a draft |
| `add-a-trip` | Scaffold a new trip folder |
| `ingest-photos` | A folder of camera files → dated, geotagged entries |
| `generate-photobook` | A trip → a print-ready PDF |
| `send-postcards` | A photo + a message → print-ready postcards |
| `apply-the-brand` | The mark, the palette, and what not to do to them |
| `deploy` | Ship it to the VPS, and know it is healthy |

Prose about the software — how it is built, how to run it, how to deploy it —
is in `docs/`, indexed from the README. This file is only what applies to
every task.

## The network doors

| | |
| --- | --- |
| `GET /documentation.txt` | what this instance is, and who is on it |
| `GET /<user>/documentation.txt` | one journal's own summary |
| `GET /agent.md` | the full guide: authenticate, read, write |
| `GET /<user>/day/<slug>.md` | a day's markdown source |
| `POST /api/auth/request` + `/verify` | a six-digit code → a 7-day agent token |
| `/api/v1/<user>/…` | REST: trips, days, drafts |
| `DELETE /api/v1/<user>` and `…/trips/<trip>` | ask to delete — see below |
| `POST /api/mcp` | MCP over Streamable HTTP — see `docs/providers/mcp.md` |

Agent tokens arrive in `Authorization: Bearer` and nowhere else; guest sessions
arrive in a cookie and nowhere else. The two are not interchangeable, and
`resolveSession()` enforces it. That is decision 24: reading the site on your
phone must not put a credential that can rewrite it in your pocket.

**Deleting is the one thing an agent cannot finish.** `DELETE` on a journal or
a trip removes nothing and answers `202`: the server mails the address in that
journal's `config.json` a single-use link to a page with a button, and only the
button deletes. `lib/agentConfirm.ts` is not used for it and must not be — that
code is deliberately not single-use and it goes *to the agent*, so an agent
could satisfy its own confirmation. Here the second step happens in a mailbox.
An agent that reports a `202` as "deleted" has said something false; say a mail
is waiting, and stop. `lib/deletions.ts`, and B38 for the reasoning.
