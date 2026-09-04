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
| Working **against a running site**, over the network | `/agent.md` (the guide) and `/api/v1/…` (REST) |

## The one rule

**The agent is the editor.** It writes, it publishes, it corrects. There is no
web form and no CMS to fall back on, so if an agent will not do a thing on the
owner's behalf, the thing cannot be done at all — which is why the rule is
stated as a capability and not as a restraint.

**What an agent writes arrives as a draft.** `status: draft` in the
frontmatter, and every reading path filters it out in `lib/entries.ts`. It is
the default so that a person can read a day back before it is on the site — a
courtesy to them, not a gate against you. `POST .../days` has no `status`
argument and no publish-on-create, for exactly that reason: writing and
publishing are two calls so there is a moment in between.

**Publishing is the second call, and it is yours to make when asked:**
`POST /api/v1/<user>/trips/<trip>/days/<slug>/publish`. Owner only — a
trip-scoped token writes days into its trip and cannot put them on the site,
because being on the bus is not the same as deciding what the
journal says. B28 is why it exists: the person deciding is often somebody who
has never seen the folder, and telling them to delete a line from a file was
advice with nowhere to go.

Nothing in the code can tell whether the person actually asked, so that part is
instruction and not a guarantee: **ask, in words, and wait for an answer.** "It
looks finished" is not consent, and neither is silence.

The one thing that is never an agent's to decide is what happened. One invented
memory presented to somebody's family as fact is not recoverable. So: write
what you were told. No weather nobody mentioned, no meals nobody ate, no
feelings nobody expressed. An empty field beats a plausible fiction.

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
  .mail/                      mail that belongs to no journal yet — a signup
                              code is addressed to somebody who does not own a
                              name. Gitignored, and plaintext while it sits
                              there, so clear it with the per-user folders.
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
`listed:` is the separate question of whether it is advertised at all, and it
only ever narrows: `listed: false` keeps a public trip out of the sitemap, the
feed and the switcher, while `listed: true` on a trip no visibility advertises
is refused and logged rather than obeyed (B51).

The line between the two closed values is what a person gets wrong at the
moment they create a trip: **`guest` means the people I let into this journal;
`private` means only the people who were there.** A guest is a guest of the
journal and never of one trip — approving somebody opens every `guest` trip in
it, at once and for as long as the approval lasts. A trip that must be held
back from people who are otherwise let in is `private`, and that is the only
mechanism; there is deliberately no narrower one.

**A closed trip does not name itself.** The sign-in gate an uninvited reader
meets carries the journal's title and nothing of the trip — not in the heading,
not in the browser tab. Trip ids are chosen by hand and guessable, so whatever
the gate says is readable by anyone who tries `alps-2024`; somebody you did
invite learns which trip it is from the invitation, which is where that
belongs. B117.

**`people:` is who took it** — up to ten, each a name and an email. Everyone
listed may write to the whole trip, and may hold an agent token scoped to it
and to nothing else in the journal. It is also who the trip is credited to.

Since B33 the file is no longer the only way onto a trip: a **buddy link** the
owner issues, and then approves somebody through, adds a row that `peopleOf()`
merges with this block. Write access is therefore the file *plus* those rows;
the byline is still the file alone, because credit is the owner's editorial
statement about whose trip it was and is rendered from disk. Hand-written
`people:` is unchanged and is never contradicted by a row.

A **journal** has a `visibility` too, in its own `config.json`, and it is a
different question: `public` or `guest`, meaning only whether this instance
advertises the journal — on `/documentation.txt`, on the landing page, in
`sitemap.xml`. A `guest` journal is unlisted, not locked; who may read a
*journey* is still the trip's own gate. Absent means `public`, which is what
every journal written before W38 is.

It used to be called `private` (B306), and that word is exactly the trap: the
trip level already has a `private` that means something narrower — only the
people who were there — and reusing it one level up, for "not advertised",
is how an owner answers a journal-visibility question with the trip's word
and an agent has to explain why that was wrong. `guest` reads correctly for
what the value actually does now, too: it is this journal's own answer for a
new trip's default (see `add-a-trip` and `lib/tripWrite.ts`), so a `guest`
journal's trips start out `guest` unless a create call says otherwise, and a
`public` journal's start out `public`. `"private"` still parses wherever this
is read from a file or a request — nothing rewrites a journal nobody has
touched since before the rename — but nothing writes it back out; ask for
`public` or `guest`.

## Working in this repository

- **Local dev is SQLite, production is Postgres**, and nothing outside
  `lib/db/` knows which.
- **No feature needs a paid account to develop or test.** Mail writes `.eml`
  files under `content/<user>/mail/` — or `content/.mail/` when it belongs to
  no journal yet, which is signup codes — OTP codes are printed, and every
  print provider has a `dry-run` backend that writes files. Every path
  `lib/mail` can write to is under `contentRoot()`; nothing lands next to the
  code (B111).
- **Every optional capability is off by default** and must be *absent* rather
  than broken when disabled. `lib/capabilities.ts` decides, and `/api/health`
  explains why something is off.
- **Secrets never enter `content/config.json`** — environment only.
- **Nothing personal in code.** `test/depersonalised.test.ts` fails the build if
  a real name or trip id appears outside `content/`.

### Verifying a change

```bash
npm run verify         # build → tsc → eslint → vitest, stopping at the first failure
npm run verify -- --quick   # the same without the build; see below for when that is honest
```

**One command, and it is the whole gate.** It was four typed by hand, in an
order that matters, and running them separately is how the order gets lost. The
dev server must still boot with a capability both on and off; nothing automates
that.

**While you are iterating, run the one test file** — `npx vitest run
test/thing.test.ts` — and keep `verify` for the end. The full suite is fifty
seconds and the build seventy, and a change is usually wrong in one file at a
time.

**Why the build goes first, since the script no longer makes you think about
it.** Next generates the typed-route definitions in `.next/types` during a
build, and `PageProps`, `LayoutProps` and `RouteContext` resolve against them.
On a checkout where no build has run since a route appeared — a fresh worktree,
or `main` right after a merge that added routes — `npx tsc --noEmit` reports
dozens of errors in files you never opened, and the honest readings available
to you are "the merge is broken" or "the documentation is wrong". Neither is
true; the types have not been generated yet. `.github/workflows/ci.yml` builds
before it typechecks for the same reason. B100.

**`--quick` skips the build, and is honest in exactly one situation:** you have
already built in this checkout and have not added, moved or deleted a route
since. Editing a component's body does not invalidate `.next/types`; adding
`app/foo/page.tsx` does. It refuses outright when nothing has been built here,
rather than handing you the confusing failure above. When in doubt leave it
off — seventy seconds is cheaper than an afternoon spent misreading `tsc`.

**A fifth command, and it is not one of the four.** `npm run unused` (knip)
answers the question the other four do not — *is anything here for nothing* —
and it is CI's job rather than yours, because the answer changes rarely and the
day it changes is a day you were not looking. It fails on a file nothing
reaches, a dependency nothing imports, or an import of something undeclared.
Unused *exports* it prints without failing; there are about a hundred and
thirty and they are B235's.
Run it when you delete a module or drop a dependency. `knip.jsonc` carries the
entry points, which are the whole configuration — nearly nothing here is
imported by name. B24.

## Where the work happens

**The main checkout stays on `main`, and stays clean.** Do not branch it, do
not switch it, do not leave changes sitting in it. Everything else follows
from that:

| In the main checkout | Anywhere else |
| --- | --- |
| Task files — capture, lane moves, editing a task's own markdown. **Commit them freely, as often as you like; no ceremony, no branch.** | Every other change. Code, tests, docs, skills, config, content. |

Anything that is not a task file is built in a **worktree on its own branch**
and merged back:

```bash
git worktree add .claude/worktrees/<branch> -b <branch>
# … build it there, verify it there …
git merge --no-ff <branch>          # from the main checkout
git worktree remove .claude/worktrees/<branch>
git branch -d <branch>
```

This repository is set up to run several agents at once, which is the whole
reason for the rule. Two of them editing one checkout is not a merge conflict —
it is one of them silently building on the other's half-finished work, or a
`git merge` refusing to start because somebody else's uncommitted change is in
the way. Both have happened here.

Task files are the exception because they are how parallel sessions *see* each
other: a lane move that only exists on your branch is invisible until you
merge, by which time it has stopped being useful. That is also why they are
committed straight to `main` rather than held back — an uncommitted task file
in the main checkout blocks the next agent's merge.

**On this machine a hook enforces the first half of that**, and B248 is the
record of why prose was not enough: an agent that had read the sentence and
then edited `lib/entries.ts` here succeeded, and the next session's `git merge`
was what found out. A `PreToolUse` hook on `Edit|Write|NotebookEdit` now
refuses a write in the shared checkout unless the target is under
`docs/tasks/`, is gitignored, or is inside `.claude/worktrees/` — and the
refusal carries the worktree recipe rather than only saying no.

**It is not in the repository, and a fresh clone does not have it.** It lives
in `.claude/settings.json` and `.claude/hooks/main-checkout-guard.mjs`, both
gitignored, because a repository that requires somebody's harness
configuration to be workable is a different promise from the one this file
makes. Installing it elsewhere is a `PreToolUse` entry matching
`Edit|Write|NotebookEdit` and a script implementing those three allowances.

**It matches tool names, so `Bash` walks past it** — a heredoc, `sed -i` or a
short script writes here with nothing said, and those are the calls these
sessions make most. B310 is open on that. Read the guard as the thing that
catches the honest accident, not as a lock: the rule above is still the rule,
and it is still yours to keep.

Four things that follow, and are easy to get wrong:

- **One git command per shell call, when your session is worktree-isolated.**
  The harness checks that a command cannot escape the worktree, and it refuses
  what it cannot verify rather than guessing — `cd <worktree> && git log … &&
  git diff …` comes back as *"too complex to verify that it stays inside the
  worktree"*, and so does anything that `cd`s to the shared checkout. Forty-
  eight commands of that shape were written across ten sessions on 2026-09-03
  and 04; twelve were refused, each one a wasted turn. Chaining reads with
  `&&` is a habit worth keeping everywhere else and dropping here: run
  `git log --oneline main..HEAD`, then run `git diff --stat`, and let the merge
  into the shared checkout be its own call from the shared checkout.
- **A worktree has no `node_modules`.** `npx tsc`, `eslint` and `vitest`
  resolve upward and appear to work; `npm run build` does not. Run `npm ci` in
  the worktree before trusting a green run.
- **`.claude/worktrees/` already holds other sessions' work.** Never work in
  one you did not create, and never assume `main` is ahead of them — an id or
  a change captured in a sibling worktree has not reached `main` yet.
- **Check the shared checkout is on `main` before merging into it**, with
  `git rev-parse --abbrev-ref HEAD`. Nothing about a detached HEAD announces
  itself: `git commit`, `git merge` and `npm run tasks` all keep working, the
  commits are real and reachable from `HEAD`, and they are on no branch. It has
  happened once, with eighteen commits from four sessions on it, and the next
  `git checkout main` would have rewound past all of them into a per-checkout
  reflog nobody reads. The recovery is

  ```bash
  git branch -f main HEAD && git checkout main
  ```

  and it is safe **only** when `git merge-base --is-ancestor main HEAD` holds.
  If it does not, the branch has diverged and that is a person's decision.
  `npm run tasks` now says all of this by itself, from any checkout, about
  every checkout — including that this one is halfway through a merge. B201.

**A dispatched subagent cannot use `EnterWorktree`** — the tool's guard is
about the session's own working directory, and a subagent inherits its
parent's. It works with absolute paths instead, and the parent creates the
worktree and hands over the path. Both halves are written out in
`work-on-a-task` step 2. B144.

## Tasks

Everything to build and everything found broken is a markdown file in
`docs/tasks/`. **The folder it sits in is its status** — there is no `status:`
field, because a status kept in two places disagrees with itself within a
month.

```
backlog/ ──person──▶ open/ ──take──▶ in-development/ ──merge──▶ testing/ ──person──▶ completed/
```

```bash
npm run tasks                       # what is in each lane, and who is on what
npm run tasks -- new --type ISSUE --priority high --complexity low \
    --area "…" --title "…"          # always lands in backlog/
npm run tasks -- move B01 testing
npm run tasks -- claim B01          # say you are on it, without moving it
npm run tasks -- tidy               # re-file into the category folders
```

**The two lanes that accumulate are filed into category folders.** `backlog/`
and `testing/` hold their tasks one level down — `security/`, `issue/`,
`big-feature/`, `small-feature/`, `chore/`, `ops/`, `docs-and-skills/`,
`superseded/` — because a flat directory of a hundred and twenty is one nobody
reads to the bottom of. The other three lanes stay flat: they are transient,
and three more decisions per lane move would buy nothing.

**You never choose the folder.** It is derived from `type` and `complexity`,
the same way the status is derived from the lane and for the same reason — a
fact kept in two places disagrees with itself within a month. `new` and `move`
file the task themselves, `npm run tasks -- tidy` re-renders the whole tree
from the frontmatter, and `test/task-ids.test.ts` fails when a file is not
where its frontmatter puts it. Correcting a `type:` and running `tidy` is how
a task changes category; moving the file by hand is how the two drift apart.

Two of the six types exist for work that is not code, and getting them right
is what keeps the folders worth having:

| `type:` | For |
| --- | --- |
| `SECURITY` `ISSUE` `CHORE` | as before |
| `FEATURE` | `complexity: high` files under `big-feature/`, anything else under `small-feature/` |
| `OPS` | an engagement against the **running** instance — enable a capability and drive it, run the restore drill, attack the live surface. The deliverable is findings and other tasks, not a diff |
| `DOCS` | the deliverable is words somebody reads — `AGENTS.md`, a skill, the agent guide, a doc comment, the demo content that teaches the model |

`superseded:` is the one thing that overrides the type. It carries what
overtook the task — an id, or what was found — and files it under
`superseded/`, which is how a task is closed without being deleted and without
claiming a person verified it. Ids are forever, so an overtaken task keeps its
file and its number and stops appearing among live work.

**A task in flight says which agent is on it.** Moving into `in-development/`
writes your session into `session:`, and taking a task another session holds is
refused rather than warned about. Every other arrival drops the hold —
`testing/` included, because the agent that merged is not the one that
verifies. That is what `claim` is for: a ticket being verified has to stay in
`testing/`, so there is no lane move to hang the claim on. The lane stamps
(`found:`, `started:`, `merged:`, `completed:`) are whole UTC instants, since
a task can cross three lanes in an afternoon here.

**Anything you notice goes into `backlog/`, always.** A second problem found
while building is a new capture referenced by id, never scope quietly absorbed
into the task you are on.

**Two lanes are a person's, and an agent moves a task into them only when told
to, in that turn, for that id.** `open/` is the way in: it is the reviewed
queue that makes "find yourself something useful" a safe instruction, so
promoting your own capture and then starting it skips the only review step in
the loop. `completed/` is the way out: a task is done when a person has seen it
working, not when its tests pass. **An agent stops at `testing/`** and says
what to look at.

If `open/` is empty and you were asked to pick something up: say so, show what
is in `backlog/`, and stop.

The id is the only way tasks refer to each other, so it means one thing
forever: task files are moved, never deleted. Reference other tasks **by id in
prose** — `see B01` — never by relative path, because files move between lanes
and a path link breaks when one does.

**Always take an id from `npm run tasks -- new`, including from a worktree.**
Never read `docs/tasks/` and add one. `nextId()` asks every checkout rather
than the one you are standing in (B99) and then reserves the number in the
shared git directory, so two sessions in the same second cannot both be given
it (B143). Choosing by hand is how four agents branched from one commit all
called their capture B130, and a duplicate is permanent: two files claiming one
id have different filenames, merge cleanly, and render as two happy rows.
`test/task-ids.test.ts` fails on a duplicate, on a file whose name and
frontmatter disagree, and on a reference to an id that does not exist.

Never hand-edit the tables in `INDEX.md`; they are generated between the
markers by `npm run tasks`. **They are generated in the main checkout only** —
run from a linked worktree, the script says so and leaves the file alone,
because a worktree's lanes are the snapshot from when its branch was cut and
the regenerated block both reinstates stale rows and conflicts with every other
branch in flight. `npm run tasks -- index` on `main` after merging is what puts
it right.

A task's **title is the problem, not the fix** — "X-Forwarded-For is taken on
trust" survives being wrong about the remedy, "Add header_up to the Caddyfile"
decides the solution before anyone has looked. Its body is **Why** (with
`file:line`, and what it costs), **Work** (including what you are *not* doing)
and **Acceptance** (a command, a behaviour, a test that fails now). Update the
file as you learn: a Work section describing something nobody built is worse
than none.

`manage-tasks` and `work-on-a-task` in `.claude/skills/` are the two skills
that carry all of this in full.

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
| `manage-tasks` | Capture something, and move it between lanes |
| `work-on-a-task` | Take one approved task, build it in a worktree, merge it |
| `test-the-live-site` | Empty `testing/` against the deployed instance, one subagent per ticket |

### Skills that are not this repository's

Installed plugins add skills alongside these, and four of them change how work
here is done rather than merely being available:

| Skill | When it applies |
| --- | --- |
| `ponytail` | Any change. The laziest thing that actually works — question whether the task needs to exist, reach for the standard library before a dependency, one line before fifty. This codebase is written to be read, so the smallest diff that answers the ticket is the right one |
| `claude-security` | Before merging anything that touches auth, tokens, grants, visibility or an API route. Run it and read the findings; each one is a `backlog/` capture or an argument for why it is not |
| `chrome-devtools` | A page is wrong and `curl` says nothing. Console errors with source-mapped traces, real network timings, and an a11y pass — the questions Playwright can drive but not answer |
| `hookify` | A rule in this file that agents keep breaking. Turn it into a hook and the harness enforces it instead of the prose asking nicely |

`security-guidance` needs no invoking: it warns on the edit and reviews the
diff when a session stops. Treat what it says as a capture, not a blocker.

**The code graph is a tool rather than a skill, and it needs a binary.**
`typescript-lsp` answers go-to-definition, find-references and the call
hierarchy over the whole checkout, which is the question `grep` cannot reach:
`findReferences` on `tripRef()` returns 89 uses across 31 files where grep
finds 61, the difference being every import site. The plugin ships no server of
its own, so without

```bash
npm install -g typescript-language-server typescript
```

every call fails with `ENOENT` and the tool looks broken rather than
unconfigured. It was installed and unusable here for a week before anybody
tried it.

**Ask it twice.** The first call after a cold start answers before it has
finished indexing, and it answers with no hedge: `tripRef()` came back as *2
references in 1 file*, then as 89 across 31 a moment later. That is the
dangerous shape of wrong — an unused-looking symbol invites exactly the
refactor its 89 callers cannot survive. Call again, or check the first answer
against `grep`, before concluding anything from a small number.

**None of this is in the repository.** Plugins are installed per user and
`.claude/settings.json` is gitignored, so a fresh clone has the ten skills
above and nothing else. An eleventh may be on disk and is deliberately not in
that table: `.claude/skills/vps/` is this instance's own deploy — it knows a
host, a directory and a domain — and is gitignored for that reason. Where it
exists it is the answer to "deploy", and `deploy` is the procedure for somebody
else's server. That is deliberate — the repository must not require
somebody else's plugin list to be workable — but it means a recommendation
resting on one of these has to name it. Install with:

```bash
claude plugin install <name>@claude-plugins-official
```

Prose about the software — how it is built, how to run it, how to deploy it —
is in `docs/`, indexed from `docs/README.md` and from the README. This file is
only what applies to every task.

Most of `docs/` was written by an agent during the build and has never been
read line by line by a person, which `docs/README.md` says at length. **Treat
it as useful, not as authority**: verify against the code before you rely on
it, and fix the document while you are there. `docs/plans/` is the exception in
the other direction — those are intent as written *before* the work, kept as
the record and never corrected, so do not update one to match what shipped.

## The network doors

| | |
| --- | --- |
| `GET /documentation.txt` | what this instance is, and who is on it |
| `GET /<user>/documentation.txt` | one journal's own summary |
| `GET /agent.md` | the full guide: authenticate, read, write |
| `GET /<user>/day/<slug>.md` | a day's markdown source |
| `POST /api/auth/request` + `/verify` | a six-digit code → a 7-day agent token |
| `POST /api/v1/<user>/handover` | owner only: a 20-minute credential to paste into an agent |
| `POST /api/auth/handover` | an agent spends that credential for its own 7-day token |
| `GET /api/v1/<user>/status` | where an agent stands: drafts waiting, trips, capabilities |
| `/api/v1/<user>/…` | REST: trips, days, drafts |
| `/api/v1/<user>/invites` | issue, list and revoke the two invite links — see below |
| `/<user>/invite/guest/<token>` | where a guest link lands |
| `/<user>/invite/buddy/<token>` | where a buddy link lands |
| `DELETE /api/v1/<user>` and `…/trips/<trip>` | ask to delete — see below |

Agent tokens arrive in `Authorization: Bearer` and nowhere else; guest sessions
arrive in a cookie and nowhere else. The two are not interchangeable, and
`resolveSession()` enforces it — it compares a row's `kind` against what the
caller asked for, which is also what makes a *new* kind refused everywhere by
default. That is decision 24: reading the site on your phone must not put a
credential that can rewrite it in your pocket.

**One thing crosses that line, deliberately, in one direction only.** Since
B283 the owner's own page — a cookie session — can mint a **`handover`
credential**: twenty minutes, scope `exchange:token`, refused on every route
except `POST /api/auth/handover`, which spends it for an agent token the agent
then holds itself. The browser still cannot read or write with it, and the page
never sees the seven-day token. It exists so an owner can paste a whole prompt
into an agent instead of reading a six-digit code down a phone. The code flow
is unchanged and still works. Why twenty minutes rather than printing the
seven-day token: a guest cookie lasts a **year** (`SESSION_TTL_MS`), so the
cookie — not the token — would have been the ceiling, and a week-long
credential would have sat in a clipboard, a screenshot and a scrollback.

**Two links let other people in, and only one of them is safe to forward.**
`POST /api/v1/<user>/invites` (owner only) makes either a **guest** link — leads to reading the journal's `guest` trips — or a
**buddy** link, which names a trip and leads to **write access** to it. Say
which you are handing over: a guest link belongs in a family group chat and a
buddy link does not. Neither grants anything on its own. Whoever opens one
proves their own address and lands in the owner's approval queue, and
`approveContact` is still the only thing in the codebase that creates a grant —
so report a link as an invitation to *ask*, never as "they now have access".
The token is in the response once and stored only hashed. `lib/contacts/invites.ts`.

**Deleting is the one thing an agent cannot finish.** `DELETE` on a journal or
a trip removes nothing and answers `202`: the server mails the address in that
journal's `config.json` a single-use link to a page with a button, and only the
button deletes. `lib/agentConfirm.ts` is not used for it and must not be — that
code is deliberately not single-use and it goes *to the agent*, so an agent
could satisfy its own confirmation. Here the second step happens in a mailbox.
An agent that reports a `202` as "deleted" has said something false; say a mail
is waiting, and stop. `lib/deletions.ts`, and B38 for the reasoning.
