<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fernscout, for agents

Read this file in full before working. It is the short, universal contract for
every task in this repository. Detailed material is linked by topic below and
is loaded only when the task reaches that topic. After context compaction,
recover this file, the active task and the selected skill rather than starting
over.

Repository skills live in `.claude/skills/<name>/SKILL.md`; `.agents/skills/`
links to the same tracked source. When a request matches a skill, read its
whole `SKILL.md` before acting and follow any directly required references.
Tool names in a skill describe capabilities, not a required vendor.

Fernscout is a self-hostable travel journal. A person's content is JSON
documents and photographs in a folder they own. There is no CMS: an agent is
the editor, including the model behind `/agent`. Read the scoped references
when the task needs their detail:

| When the task concerns | Read |
| --- | --- |
| trips, days, photographs, weather, visibility, people, costs, imports or GPS | [Content model and editorial safety](docs/agents/content-model.md) |
| local development, tests, localisation, API schemas or contracts | [Repository verification](docs/agents/repository-verification.md) |
| branches, worktrees, task lanes, holds or task ids | [Worktrees and tasks](docs/agents/worktrees-and-tasks.md) |
| repository skills, visual workbenches or optional plugins/tools | [Skills and tools](docs/agents/skills-and-tools.md) |
| authentication, invites, credits, printing, deletion or the network API | [Network and authorisation](docs/agents/network-and-auth.md) |

## Rules that are always in scope

### Tell the truth about content and actions

Write only what the person or a real source supplied. Never invent weather,
places, meals, feelings, measurements, people or memories. An empty field is
better than plausible fiction. A source label you invented is still fiction.

New days are drafts. Publishing is a separate owner-only call, and it requires
the person's explicit consent in words. Ask and wait. “It looks finished” and
silence are not permission. Never say an action succeeded because it was
proposed, queued or attempted: report what the turn actually did.

`test: true` is the only exception for invented content. A whole test journal
is named `test-<something>` so the label survives exports and backups.

GPS history under `content/<user>/gps/` is the most sensitive data in the
repository. Never expose it, copy a coordinate from it into content, or add a
route that reads it. The public map uses only a derived, clipped
`trips/<trip>/track.json`.

A photograph upload keeps the original as its print master. Do not replace or
discard originals while working on served derivatives.

### Preserve authority boundaries

Agent bearer tokens reach `/api/**`, not rendered owner pages. Owner pages use
browser cookies. An identity cookie proves an email address and grants nothing
by itself. Use the established resolution functions; never make credentials
interchangeable for convenience.

An invite link creates a request, not access. A postcard or photobook API call
creates a proposal, not a paid print. A delete API call creates a confirmation
email and removes nothing. Report those states exactly and never claim the
second, human-only step happened.

Secrets are environment-only and never enter `site/config.json`, source,
fixtures, task files or logs. Nothing personal belongs in application code;
`test/depersonalised.test.ts` enforces the source directories.

Anything touching authentication, tokens, grants, visibility or an API route
needs the repository's security review path before merge. A finding that
already existed is a new backlog ticket; a defect introduced by the branch is
fixed on the branch.

### Keep implementation portable and closed by default

Local development is SQLite and production is Postgres. Nothing outside
`lib/db/` chooses the dialect. Every optional capability is off by default and
must be absent, not broken, when disabled; `lib/capabilities.ts` decides and
`/api/health` explains.

No feature requires a paid provider account to develop or test. Use the
repository's dry-run, simulated provider and local mail paths.

Do not use `window.confirm`, `alert` or `prompt`. Confirmations use
`components/ConfirmPanel.tsx` with an action-specific button.

Prefer the smallest implementation that satisfies the task. Do not introduce
a dependency, abstraction, platform or vendor requirement without measured
need. A fresh clone must remain workable without one operator's plugins or
local configuration.

## Verification contract

The final local gate is one command:

```bash
npm run verify
```

It runs build, TypeScript, ESLint, Vitest and knip in that order and stops at
the first failure. The order matters, which is why it is one command.

**Two things it does not do**, and both have cost somebody a day:

- **It says nothing about what a person sees.** A green suite proves the
  mechanism works on the case you built for it — the one case that cannot
  surprise you. A visible change is finished when it has been seen on content
  that existed *before* your branch. B42 shipped a reader's own clock beside a
  day's local time, verified it on the two demo days the same change had
  edited, and passed; every day already written showed nothing, because
  nothing filled the new field in. B1090. `work-on-a-task` step 5,
  `test-in-a-browser` and `check-a-drawing` carry the procedure.
- **It takes about five minutes**, so it refuses to start unattended rather
  than let a short tool timeout kill it mid-suite. Pass `VERIFY_WILL_WAIT=1`
  together with `timeout: 900000`, and wait for it in that turn. Never
  background it and stop: your turn ends, nothing can wake you, and the run
  finishes into a file nobody reads. Nine agents did that in a single day with
  the timeout instruction already in their briefs, which is why the guard is
  code and this is one paragraph.

Run a single relevant test file while iterating, for example:

```bash
npx vitest run test/thing.test.ts
npm run check:changed -- path/to/changed-file.ts
```

`check:changed` combines Vitest's dependency graph with declared source-scan
keepers, prints why each check was selected, and broadens to the full suite
when neither source has evidence.

`npm run verify -- --quick` reuses the last build only when its stamp proves
the route graph, Next config/version and generated `.next/types` are unchanged.
When they are stale or missing it explains why and builds automatically before
typechecking.

A visible change is not verified by the suite. Drive a real browser against
content that existed before the branch at desktop and phone width, inspect the
screenshot and the captured JSON, and check console and request failures. Do
not verify only on a fixture authored for the change. Use `test-in-a-browser`;
for an SVG, animation, card or print layout use `check-a-drawing`.

Keep every existing keeper unless the ticket explicitly changes its contract.
Do not weaken assertions, add retries to hide flakes, or exchange coverage for
a faster number. A focused changed-file check accelerates iteration only; it
never replaces the pre-merge gate.

### UI strings

A new UI string needs real English, German and Hungarian entries in
`site/locales/`. Run `npm run i18n:keys` after changing English. If you cannot
write a language, say so and leave the task short of done rather than inventing
a translation.

### API routes and contracts

Anything under `app/api/` must keep the public contract truthful. `/api/v2/**`
contracts come from the Zod schemas in `lib/api/v2/schemas/` and generate
`/api/v2/openapi.json`; surviving v1/auth operations are maintained in
`lib/api/openapi.ts`. Import enum constants from their validator source rather
than copying lists. Every accepted field must be readable back, and limits must
be discoverable before a caller hits them. Run the `keep-the-contract` skill
after an API change.

## Where work happens

The shared checkout stays on `main` and clean. Task files are the sole
exception: capture, lane moves and edits to a task's own Markdown are committed
directly on `main` so concurrent sessions can see them. Every other file—code,
tests, docs, skills, config and content—is changed in a dedicated branch and
worktree under `.claude/worktrees/`.

Before a merge, confirm the shared checkout says `main` and has no unrelated
changes:

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Never work in or remove a worktree you did not create. A new worktree has no
dependencies. From inside it run:

```bash
npm run worktree:bootstrap
```

It checks the exact `.nvmrc` version, clones `node_modules` copy-on-write from
`main` on APFS (or runs `npm ci --prefer-offline` elsewhere), and stamps the
lockfile it matches. Do not symlink `node_modules`. If the lockfile moved,
rerun with `-- --refresh`; it replaces only that worktree's dependency clone.

In a worktree-isolated harness, issue one git command per shell call. Complex
chained commands may be refused because their working directory cannot be
proved. Two builds in the same checkout contend on Next's build lock; builds
in separate worktrees do not.

A dispatched subagent cannot enter or manage a worktree. The parent creates
it, supplies its absolute path and dependencies, and later merges. The
subagent uses that absolute working directory for every tool call and never
merges, checks out, pushes or removes the worktree.

## Task workflow

The folder is the status:

```text
backlog/ ──person──▶ open/ ──take──▶ in-development/ ──merge──▶ testing/ ──person──▶ completed/
```

`open/` and `completed/` are human gates. An agent moves into either only when
the person explicitly says so in that turn for that task. Anything newly
noticed goes to `backlog/`; do not quietly absorb it into the current task.
Agents stop at `testing/`, where a person verifies the result.

Use the task command instead of reading the whole 1,600-ticket index:

```bash
npm run tasks                              # counts plus active work
npm run tasks -- list --lane open          # one lane
npm run tasks -- show B01                  # one complete task
npm run tasks -- search "words"            # capped matching list
npm run tasks -- list --all                # exhaustive, only when needed
npm run agent:context -- B01               # concise code/test/doc/skill/check map
npm run tasks -- new --type ISSUE --priority high --complexity low \
  --area "…" --title "Problem, not solution"
npm run tasks -- move B01 in-development
npm run tasks -- move B01 testing
```

Never choose an id or move a task file by hand. `tasks new` allocates across
all worktrees and reserves the id; `tasks move` stamps and files it. Backlog is
categorised from `type` and `complexity`; run `npm run tasks -- tidy` after
changing either. Never hand-edit generated tables in `docs/tasks/INDEX.md`.

Take work only from `open/`. Revalidate the complete ticket and named code
before moving it to `in-development/`, then record `valid`, `already fixed`,
`superseded by <id>` or `premise is wrong` in the ticket. A `wontDo` decision
belongs to a person. Update the task as implementation changes what is known.

Follow `manage-tasks` for capture and lane rules and `work-on-a-task` for the
full isolated build/merge procedure.

## Skill router

Use only the matching skill and its required references:

| Skill | Use it for |
| --- | --- |
| `manage-tasks` | Capture, inspect and move task files |
| `work-on-a-task` | Build one approved task in an isolated worktree |
| `triage-a-backlog` | Review a whole backlog lane |
| `plan-a-run` / `run-a-batch` / `report-a-run` | Prepare, execute and report an approved batch |
| `test-in-a-browser` | Verify a page locally at desktop and phone widths |
| `check-a-drawing` | Inspect SVG, animation, card and print visuals |
| `test-a-feature` | Exercise capability/persona flows locally |
| `test-the-live-site` | Verify tickets against the deployed instance |
| `test-with-personas` | Independent guided-helper persona testing |
| `keep-the-contract` | Audit API schemas, docs and read-back behavior |
| `get-a-credential` | Obtain the correct local/live test identity |
| `apply-the-brand` | Brand colors, logo, wordmark and related UI |
| `github` | GitHub Actions, pull requests and issues |
| `deploy` | Ship to the VPS and verify health |

**Two fields override the type**, and both are ways of closing a task without
deleting it and without claiming a person verified it. Ids are forever, so a
closed task keeps its file and its number and stops appearing among live work.

`superseded:` carries what overtook the task — an id, or what was found — and
files it under `superseded/`.

`wontDo:` carries why a person decided it should not be built at all: the
behaviour is wanted as it is, the cost is not worth it, or the premise was
wrong. It files under `wont-do/`.

The distinction is worth keeping because the two invite opposite follow-ups. A
superseded ticket points at the work that replaced it, and the next agent may
usefully go and read that. A wont-do ticket points at nothing, and is meant
**not** to be reopened by the next agent hunting for something useful — which
is exactly what happens if "we decided against this" is filed as though the
work were still owed. `superseded` wins when both are set: "already done
elsewhere" is a fact about the code, "not worth doing" is a judgement about it,
and the fact is the more useful thing to show.

`wontDo` is a person's word, not an agent's. Set it when you have been told to;
capturing your own opinion that a ticket is not worth building is a `backlog/`
note, not a closure.

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

`.claude/skills/` holds the tasks of *building* this software. Each is a
`SKILL.md` you can follow start to finish. Writing content — a day, a trip,
photographs, a photobook, postcards, a traveller's likeness — is not here and
is not a checkout's job: it happens over the network, and `/documentation.txt`
and the `/skill/<task>.md` guides it indexes are the guide for it.

| Skill | For |
| --- | --- |
| `apply-the-brand` | The mark, the palette, and what not to do to them |
| `check-a-drawing` | Look at something this software draws, at `/docs/branding` — the animation, the figures, a day card, a print margin |
| `deploy` | Ship it to the VPS, and know it is healthy |
| `github` | Read a CI run's logs and work out why it is red; issues and pull requests. Needs `gh`, and a person to have run `gh auth login` |
| `get-a-credential` | Get signed in — an agent token, an owner's cookie, the operator's `/admin`, a throwaway test journal — locally or live |
| `keep-the-contract` | Check that `/openapi.json` and the `/skill/*.md` guides still tell the truth after a change to a route |
| `manage-tasks` | Capture something, and move it between lanes |
| `triage-a-backlog` | Read a whole lane of `docs/tasks/` and hand back one page a person decides from |
| `plan-a-run` | Ask every decision a batch of approved tickets needs — is it still valid, which of two stances, what is still open — before any of it is built |
| `report-a-run` | Account for a finished batch of tickets on one page — what shipped, what was already fixed, what a person can see, what still needs their eyes |
| `work-on-a-task` | Take one approved task, build it in a worktree, merge it |
| `run-a-batch` | Carry an answered brief through build, merge, deploy and live check without stopping to ask |
| `test-the-live-site` | Empty `testing/` against the deployed instance, one subagent per ticket |
| `test-a-feature` | Find the persona flows for a capability and drive them locally with simulated providers |
| `test-in-a-browser` | Drive a local checkout in a real browser: sign in as an owner, switch a capability on, check a page at 390px |
| `test-with-personas` | Drive `/agent` as somebody who has never seen it — a subagent per persona, handed a URL and nothing else |

### The workbenches

**A drawing is the one output no test can check.** Code for an aeroplane whose
wings rake the wrong way typechecks, lints and passes every assertion, and is
wrong; somebody has to look. `/docs/branding` is where you look — four benches
that each take one drawn thing out of the product and hold it still:

| | |
| --- | --- |
| `/docs/branding/animation` | the travel scene: vehicles, surfaces, skylines, and a slider that holds any moment of the leg |
| `/docs/branding/travellers` | every value of every axis a person is described along, side by side |
| `/docs/branding/day` | a day card in the states a reader cannot reach — draft, half-published, marked as test |
| `/docs/branding/print` | bleed, trim, safe area and gutter, from the constants the renderers use |

They render the **real** components with the real props, so a fault that shows
there is a fault on the site and one that does not is not. Nothing on them
needs a journal, a database, a session or a capability — they sit above all of
it, which makes them the fastest pages here to open, live or local.

The benches are also how a report becomes actionable: *which section shows it*
is *which file it is in*. Say "the plane in `Vehicle.tsx` has its wings
backwards", never "the travel scene looks wrong". `check-a-drawing` is the
procedure, including the four traps — a stale dev server on a taken port,
`originX` on SVG being a fraction of the bounding box, an `<svg>` with only a
viewBox taking its intrinsic size, and `x: "120%"` being a percentage of the
element rather than the frame — each of which cost a round of screenshots
before it was written down.

Not indexed, English only, and deliberately not among the `/docs` cards: the
list is `BRANDING_BENCHES` in `lib/docs.ts`, and adding a bench is a component,
a page and a row.

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
`.claude/settings.json` is gitignored, so a fresh clone has the repository skills
listed above, without those plugins. An additional skill may be on disk and
is deliberately not in that table: `.claude/skills/vps/` is this instance's
own deploy — it knows a host, a directory and a domain — and is gitignored for that reason. Where it
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
| `GET /skill/<task>.md` | one task's own guide — `new-account`, `add-journal`, `add-a-trip`, `add-a-day`, `ingest-photos`, `invite-someone`, `costs`, `send-postcards`, `make-a-photobook` (B311) |
| `GET /agent.md` | retired (B311): a 301 to `/documentation.txt`, kept so an old link or a pasted prompt still lands somewhere true |
| `GET /<user>/day/<slug>.md` | a day's markdown source |
| `GET /api/v2/<user>/figures/presets` | the vocabulary the walking figures are described in, and twelve starting points |
| `GET /api/v2/<user>/figures/preview` | that description as a picture, so a person can see themselves before it is written |
| `POST /api/auth/codes` with `for: "read"` or `"write"`, then `POST /api/auth/codes/redeem` | a six-digit code → a 7-day agent token. One door, parameterised by `for`, replacing the old `/api/auth/request` + `/verify` (B1600) |
| `POST /api/auth/codes` with `for: "identity"`, then `POST /api/auth/codes/redeem` | a six-digit code → a year-long **identity** cookie: proves an address to the whole instance and authorises nothing |
| `POST /api/auth/<user>/handover` | owner only: a 20-minute credential to paste into an agent |
| `POST /api/auth/handover` | an agent spends that credential for its own 7-day token |
| `GET /api/v2/<user>/status` | where an agent stands: drafts waiting, trips, capabilities |
| `/api/v2/<user>/…` | REST: trips, days, drafts |
| `/api/v2/<user>/invites` | issue, list and revoke the two invite links — see below |
| `/api/v2/<user>/postcards/orders/{id}` | propose printed postcards — see below |
| `/<user>/postcards/<id>` | where a person looks at them and sends them |
| `/<user>/invite/guest/<token>` | where a guest link lands |
| `/<user>/invite/buddy/<token>` | where a buddy link lands |
| `DELETE /api/v2/<user>` and `…/trips/<trip>` | ask to delete — see below |
| `/admin` | what the instance costs to run — operator only, see below |

**One address can sit above all of this, and it is not in any config file.**
`FERNSCOUT_ADMIN_EMAIL` in the environment names the instance's operator, and
`isOwner` answers yes for them on every journal — reading, publishing, the
contacts page, credits, the lot. Unset is the default and every instance that
does not set it behaves as though `lib/admin.ts` were not there. It is
deliberately not a role, a rank or a row in a table: one address, read from the
environment on each call, so it is an operations decision rather than something
a journal's own file can widen. B480.

**That address has one page of its own, and it is the only thing on this
instance that is about the instance** — `/admin`, B746. What a month of model
calls, speech, print orders and sends actually cost, priced from a `costs`
block in `site/config.json` that the operator edits without a deploy, plus
every journal's balance and its ledger. It reads a **cookie** and never a
bearer token, and it asks `resolveIdentity` rather than `resolveAccess`,
because the question is instance-wide and one journal's own session must not
answer it. With `FERNSCOUT_ADMIN_EMAIL` unset it is a 404 for everybody, which
is how every other instance behaves.

The numbers behind it come from a `usage` table (`lib/usage.ts`) that records
tokens and audio seconds — units, never money, so a period can be re-costed
when a price changes — and `recordUsage` **never throws**: a person has already
spent a credit and been given their day by the time it runs, and losing the day
to an accounting insert would be trading the product for the bookkeeping.

**Its "add credits" button does not add credits**, and that is the same shape as
deleting. `lib/credits.ts`'s property 1 stands unchanged — nothing a *caller*
can reach over HTTP raises a balance — so the button files a zero-franc
transaction and mails the operator the single-use approval link an ordinary
purchase mints. Report it as a mail waiting, never as credits added.

**Buying credits is Stripe, and the key is the only switch** — B792. `PUT
/api/v2/<user>/purchases/<id>` (owner only, and an owner's agent token counts,
client-chosen id so a retry never mints a second row) files a pending
transaction and answers with an absolute `paymentUrl`; the person opens it,
and `/api/web/<user>/purchases/<id>/pay` sends them to a hosted checkout
page for TWINT, a wallet or a card. Nothing an agent holds can pay, and nothing
it holds can grant: `POST /api/webhooks/stripe` is what grants, from Stripe's
own signature over the raw body and a once-only claim on the row
(`claimProviderPayment`). That webhook is one of the **four** files
`GRANT_ALLOWED` in `test/credits.test.ts` names, beside the operator approval
route, the one-off grant a new journal gets at signup, and the same one-off
grant reached through WhatsApp onboarding — and that list is the whole of it.
**Read the constant rather than this sentence**: it said three for the whole of
the time the list held four (B1363 added the fourth), which is what a count
written down in two places does.

`sk_test_…` is Stripe's sandbox and `sk_live_…` is real money — there is
deliberately no `sandbox: true` beside the key, because a flag beside a
credential is a flag that can disagree with it. `/api/health` prints the mode
it read. With no `STRIPE_SECRET_KEY`, purchases fall back to the operator
approving a mail by hand (B425), which is what keeps this developable with no
Stripe account. `lib/stripe.ts`.

Agent tokens arrive in `Authorization: Bearer` and nowhere else; guest sessions
arrive in a cookie and nowhere else. The two are not interchangeable, and
`resolveSession()` enforces it — it compares a row's `kind` against what the
caller asked for, which is also what makes a *new* kind refused everywhere by
default. That is decision 24: reading the site on your phone must not put a
credential that can rewrite it in your pocket.

**The converse holds too: an agent token reaches `/api/…` and never a
rendered page.** The owner's own pages — `/<user>/contacts` and `/<user>/me`
among them — authenticate from a cookie session only, with no `request`
argument for `isOwner` to read a bearer token from. A token that drives every
write on a trip renders none of these pages; an agent that wants to *see* one
needs a browser session, obtained the way a person gets one. This is also why
a ticket's acceptance line about what a *page shows* cannot be closed by an
agent over the API — write it against the browser explicitly, or against the
API state that drives the render.

**A third browser credential says who you are and opens nothing.** Since B410
an `fs_identity` cookie is bound to an address and to no journal — the
`NO_JOURNAL` (`"*"`) sentinel in `owner_id`, which `USERNAME_RE` can never
collide with. It lasts a year, and it is handed out by the identity code flow
*and* by every ordinary journal sign-in, because proving an address for one
journal proves the address. It authorises nothing by itself: every gate asks
`resolveSession` for `"guest"` or `"agent"` and an `identity` row is refused to
all of them. `resolveAccess()` in `lib/auth/handshake.ts` is the one place that
turns it into an answer about a particular journal, and the answer is **an
address, not a permission** — `journalReader` still asks `hasReadGrant`,
`isOwner` still reads `owner.email`, `isPersonOnWith` still reads `people:`, on
every request. So a year-old identity opens exactly what its holder is entitled
to today, and revoking it (`/api/auth/logout`, or the device list) ends it
outright with nothing downstream left holding access.

Read a journal's access through `resolveAccess(username)` rather than reading
`fs_session` yourself: a reader may hold either credential, and a gate that
looks only at the cookie silently refuses everyone who arrived by identity.

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
`PUT /api/v2/<user>/invites/<id>` (owner only, client-chosen id — an invite
has no update once created) makes either a **guest** link — leads to reading the journal's `guest` trips — or a
**buddy** link, which names a trip and leads to **write access** to it. Say
which you are handing over: a guest link belongs in a family group chat and a
buddy link does not. Neither grants anything on its own. Whoever opens one
proves their own address and lands in the owner's approval queue, and
`approveContact` is still the only thing in the codebase that creates a grant —
so report a link as an invitation to *ask*, never as "they now have access".
The token is in the response once, in that API call. Its hash is stored
always, and — since B280 — a reversible copy beside it where the instance has
a contacts encryption key, so the owner's own `/<user>/contacts` page can show
a lost link again; without that key it is hash-only and a lost link can only
be reissued. `lib/contacts/invites.ts`.

**Posting a real postcard is the other thing an agent cannot finish** — B434,
and the same shape as deleting, for a different reason. `PUT
/api/v2/<user>/postcards/orders/<id>` writes a proposal and answers with a URL; it charges
nothing and prints nothing. The owner opens that page, sees the photograph, the
message on the back, who each card is going to, the cost and their balance, and
presses one button. That button is the only thing in the codebase that spends
credits at a printer.

Addresses never reach an agent. `GET …/postcards/recipients` answers with a
name, a town and a country, and cards are addressed by `contactId` — so a card
can only ever go to somebody who asked this journal for one, and never to an
address that arrived in a conversation. The send route is outside `/api/v2/`,
takes the owner's cookie only, and refuses a bearer token outright;
`test/postcard-orders.test.ts` fails if anything under `app/api` ever imports
`sendOrder`. **Hand over the URL and say a preview is waiting. Do not say the
cards have been sent.** `lib/postcard/orders.ts` and `lib/postcard/send.ts`.

**Deleting is the one thing an agent cannot finish.** `DELETE` on a journal or
a trip removes nothing and answers `202`: the server mails the address in that
journal's `config.json` a single-use link to a page with a button, and only the
button deletes. `lib/agentConfirm.ts` is not used for it and must not be — that
code is deliberately not single-use and it goes *to the agent*, so an agent
could satisfy its own confirmation. Here the second step happens in a mailbox.
An agent that reports a `202` as "deleted" has said something false; say a mail
is waiting, and stop. `lib/deletions.ts`, and B38 for the reasoning.

Since B1321 the owner has a shorter road for a *trip* — a Delete link on the
trip's own page, behind their browser cookie only
(`app/[user]/trips/[trip]/delete/route.ts`, the same door-shape as the
postcard send), with the inventory named before the second press. That changes
nothing for you: the route refuses any `Authorization` header outright, so an
agent's path is still the mail, and a whole journal still ends in the mailbox
for everybody.
