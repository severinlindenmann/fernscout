<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fernscout, for agents

A self-hostable travel journal. **The content is markdown and photographs in a
folder the author owns.** There is no CMS, and there will not be one (ROADMAP
decision 24): no form that maps fields onto frontmatter, no upload widget with
its own idea of what a day is. Writing happens through an agent — and since
B681/B682, a person with no agent of their own can reach one anyway, through a
guided web helper at `/agent` that writes through the same API this file
describes. Reading happens in a browser and, now, so does describing a day out
loud to the helper; nothing about what a browser is allowed to *do* on the
owner's behalf without a model in front of it has changed. This file exists for
the agent on either side of that: the one you are, and the one the helper
runs.

Two ways in, and they are the same content behind two doors:

| You are | Use |
| --- | --- |
| Working **in this repository**, with the files on disk | the skills in `.claude/skills/`, and this file |
| Working **against a running site**, over the network | `/agent.md` (the guide) and `/api/v1/…` (REST) |

## The one rule

**The agent is the editor.** It writes, it publishes, it corrects. There is no
form and no CMS to fall back on — the web helper at `/agent` is a face on an
agent, not an exception to this rule, since a model is what turns what a
person describes into a day and the wizard never lets a person set a field
directly the way a CMS would. So if no agent, human-driven or the helper's
own, will do a thing on the owner's behalf, the thing cannot be done at all —
which is why the rule is stated as a capability and not as a restraint.

**What an agent writes arrives as a draft.** `status: draft` in the
frontmatter, and every reading path filters it out in `lib/entries.ts`. It is
the default so that a person can read a day back before it is on the site — a
courtesy to them, not a gate against you. `POST .../days` has no `status`
argument and no publish-on-create, for exactly that reason: writing and
publishing are two calls so there is a moment in between. The web helper at
`/agent` writes through this same call and arrives at the same draft; it has
no shortcut around it.

**Publishing is the second call, and it is yours to make when asked:**
`POST /api/v1/<user>/trips/<trip>/days/<slug>/publish`. Owner only — a
trip-scoped token writes days into its trip and cannot put them on the site,
because being on the bus is not the same as deciding what the
journal says. B28 is why it exists: the person deciding is often somebody who
has never seen the folder, and telling them to delete a line from a file was
advice with nowhere to go. The helper is not exempt: it makes this same call,
as a separate, labelled tap in its own flow, and never on create.

Nothing in the code can tell whether the person actually asked, so that part is
instruction and not a guarantee: **ask, in words, and wait for an answer.** "It
looks finished" is not consent, and neither is silence.

The one thing that is never an agent's to decide is what happened. One invented
memory presented to somebody's family as fact is not recoverable. So: write
what you were told. No weather nobody mentioned, no meals nobody ate, no
feelings nobody expressed. An empty field beats a plausible fiction.

**Part of that rule is now machinery, and you should know it is there.** A
71-year-old was told *"Der Text ist gespeichert."* Every mechanical guard had
held; no write had happened; the sentence was simply untrue. She had no way to
know, and the words on the screen are all a person has.

So `lib/helper/model.ts` holds a **net**: after the model has answered, the
server compares what it *said* against what the turn actually *did* — it holds
both halves, and nothing else does. Each check is the same four parts: a
matcher for the kind of claim, a condition on what the turn did, one retry
telling the model what it got wrong, and a plain sentence in the person's own
language when the retry fails too. What is checked and why is written beside
each one; there is no list here, because a list in two places disagrees with
itself within a month.

Three things about it are worth carrying into any change:

- **A claim is checked against the turn, never against the phrasing.** Whether
  a sentence is true depends on what was proposed, what was read and what was
  written — all of which the server knows. Matching text alone is how a guard
  becomes a list of verb phrases that is always missing its next entry.
- **A guard that fires on an honest turn is a bug**, and as serious as one that
  misses. Being told *"I would rather not give you a figure"* when you asked a
  fair question is its own way of making the software useless.
- **Adding a tool may mean adding a check.** A tool that lets the model assert
  something new about somebody's journal has made a new kind of claim
  possible.

And the finding that produced all of it, since it will save somebody a week:
**rewording the prompt did not fix any of these, and a code guard fixed all of
them.** B829 is the first record of it and every ticket since has agreed. The
prompt is also the scarcer resource — four separate fixes ran into its token
ceiling, and each time the answer was a guard rather than more words.

**Weather has one true route, and it is not your memory.** Since B325 a day
may carry `weather: true`, and the *server* looks it up — from a public
archive, at the coordinates that day already carries, credited to the archive
on the page. That does not soften the sentence above; it is what makes it
survivable, because until there was a measurement, guessing was the only way
to answer at all. What stays forbidden is the whole of it: an agent writing a
temperature, a condition or a wet afternoon from its own belief. A reading a
person handed you goes in `weatherData` and must name its source, and
`open-meteo` is refused there, because that name means this server measured
it. **Ask for the lookup; never supply the answer.** `npm run weather:update`
fills in every day that asked and has none yet, never overwrites one already
there, and leaves a day the archive cannot answer for the next run rather than
filling it with something plausible.

**`test: true`** is the exception, and the only one. A day or a trip carrying it
is content nobody lived, written to prove the pipeline works: the page says so
in a banner, and it is kept out of the feed, the search index and the sitemap.
Use it when you were asked to invent something. Writing "this is a test" into
the prose instead is a convention, not a guarantee — the next reader has no way
to know whether you bothered.

**A whole journal made for testing is named for it**, since `test:` is a field
on content and a journal has none: create it as `test-<something>` and never
under a name that reads like a person's. The directory name is the one label
that survives an export, a backup and an `ls`, and it is what lets anybody —
or any later agent — delete the thing without stopping to find out whose it
is.

## The content model

Everything a person owns lives under `content/<username>/`. Nothing user-owned
is written anywhere else — and since B510, nothing *else* is written under
`content/` either. The instance's own four files are in `site/`, in the
checkout, where a `git pull` is the whole update:

```
site/
  config.json                 server config — site name, URL, default user,
                              reserved usernames, an optional `banner` across
                              the landing page (`enabled` + `text`, plus an
                              optional `translations` map of locale to text —
                              the operator's own words in whatever languages
                              they wrote them, `text` for every other reader),
                              capability switches, and the
                              `media` block: how large uploads may be, how many
                              per day, the per-journal storage ceiling
                              (`perUserBytes`, 5 GB unless said otherwise — it
                              counts the whole of `content/<user>/`, and an
                              owner buys past it 5 GB at a time with credits;
                              lib/storageQuota.ts, B661), and
                              how many printed photobook orders stay on disk
                              (docs/providers/photobook.md, B483).
                              A user's own config.json may narrow these, never
                              widen them. A deployed instance overrides this
                              file with FERNSCOUT_CONFIG, because its config is
                              the operator's and must survive a `git pull`.
  locales/<code>.json         the UI's own strings, per language
  rates/ecb.json              shared currency reference rates
  legal/<code>.md             this instance's imprint (optional — no file, no
                              page and no footer link)
```

An instance may still override `locales/`, `rates/` and `legal/` by putting
its own beside its journals under `CONTENT_DIR`; that is where all four lived
before B510, so an instance that has not migrated keeps working.

```
content/
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
        track.json            the ground actually covered on this trip, derived
                              from `gps/` below and clipped to it — B665
        .ingest.json          what ingest has already imported (do not edit)
    inbox/                    files that belong to no day yet — B663.
      media/ files/           `media/` is destined for a gallery, `files/` is
      photobook/ postcards/   documents nothing reads yet. Each file is named
                              by a hash of its own bytes, with its facts in a
                              `<name>.meta.json` sidecar beside it. Nothing
                              here is reachable by URL. See lib/inbox.ts.
    gps/                      the owner's own position history — B665.
      YYYY-MM.jsonl           `[epochSeconds, lat, lon]`, thinned to one fix
                              per 5 min or 250 m. Read by no route and in no
                              export. See below.
      exclude.json            places that are never drawn
    postcards/ photobooks/    generated output (gitignored)
```

**`gps/` is the most sensitive folder in this repository, and it is the one an
agent must never read out.** It is a person's whole location history — every
address they sleep at, every place they work, everywhere they have been ill —
and it is there so that a trip's map can show the road actually driven rather
than a straight line between two days.

The shape is two files on purpose. `lib/gps/store.ts` holds the history and is
reachable from nothing under `app/`: no route, no page, no API returns a
position, and `test/gps-store.test.ts` asserts the import graph. What the site
draws is `trips/<trip>/track.json` — derived by `npm run gps -- enrich`,
clipped to the trip's dates, with the owner's private zones cut out and gaps
left as gaps. **Deleting `gps/` outright leaves every trip rendering exactly as
before.** Do not add a route that reads the store, do not put a coordinate from
it into a day, and do not copy one into a conversation. `docs/gps.md` is the
whole of it.

Getting history *in* is `importers/`, which is **MIT-licensed** while the rest
of this repository is not: small parsers — Google Timeline, Google Takeout,
GPX, and a neutral JSON Lines format for anybody's own tool — each turning one
export into plain rows and knowing nothing about journals. The folder is its
own registry, so adding a format is dropping a file in.

**The kind of data is the subfolder, and each kind's `schema.ts` is its whole
contract.** `importers/gps/schema.ts` names the row (`Fix`) and exports the
function that checks somebody's importer against it; `importers/costs/` does
the same for a bank statement (`Payment`, B677). A `Payment` and a `Fix` have
nothing to say to each other, which is why they are folders rather than files
beside one another. `importers/schema.ts` holds the only thing they
share, `Importer<Row>`, and there is deliberately no plugin interface beneath
it. Each kind also has an `index.ts` listing its importers, because a bundler
cannot trace a directory scan and an unlisted importer is missing from a
production build; a test walks the folder and names the line to add.
`importers/README.md` is the guide.

**The door is `POST /api/v1/<user>/import`, and there is no other one** — B671
deleted the CLI B665 shipped with. A hosted journal's owner has no shell on the
server and an agent never has one, so a capability reachable only by `npm run`
was unreachable by both. The route takes a `kind` and an optional `format`,
and reads bytes from the inbox, from multipart or from `text`.

**The two kinds end differently, and the difference is the rule this project
is built on.** `gps` is stored as it is read — a coordinate is a measurement,
and there is nothing about it to decide; `POST /api/v1/<user>/trips/<trip>/track`
is the separate decision that draws one trip's line, and neither call ever
returns a position. `costs` writes **nothing**: a statement covers the trip and
the fortnight either side of it, and what each line was *for* is an editorial
decision. It reports, a person agrees the categories merchant by merchant, and
`POST /api/v1/<user>/trips/<trip>/costs/import` writes the agreed rows onto the
days. An agent that picked the categories itself would be deciding what
happened.

Sent mail is not in this tree. Since B636 it lives under the data dir
instead — `<dataDir>/mail/<username>/` (and `<dataDir>/mail/.mail/` for a
signup code, which belongs to no journal yet) — because it is transient,
plaintext, and swept after two days (`lib/mail/index.ts`), not something the
owner's own backup or export should ever carry. `scripts/backup.sh` stages
`DATA_DIR` and then drops that one subdirectory before it pushes.

A trip is addressed as a **ref**: `<username>/<trip-id>`. Trip ids are unique
within a user, not across the instance, so nothing addresses a trip by id alone.
`lib/trips.ts` has `tripRef()` and `parseTripRef()`; use them rather than string
concatenation, because a username is a directory name and therefore a security
boundary.

### The shape of an entry and a trip

Not repeated here. Writing content is the network door's job, so the field
lists live where the writer is actually reading them: `/agent.md` for an entry,
`trip.md`, `costs.md` and `plan.md`, and the request schemas in
`lib/api/openapi.ts` for what each route will accept. A reference kept in two
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
is refused and logged rather than obeyed (B51). A closed trip has a third key
of its own, `teaser: true`, which advertises the *existence* of a trip nobody
may read — a locked card on `/<user>/trips` with its title and dates and
nothing else. It grants nothing, and it is refused on a public trip, where
`listed` is the key that decides (B587).

The line between the two closed values is what a person gets wrong at the
moment they create a trip: **`guest` means the people I let into this journal;
`private` means only the people who were there.** A guest is a guest of the
journal and never of one trip — approving somebody opens every `guest` trip in
it, at once and for as long as the approval lasts. A trip that must be held
back from people who are otherwise let in is `private`, and for a *trip* that
is still the only mechanism.

**One photograph is the exception, and it is the only one** (B596). A gallery
item may carry `visibility: guest` or `visibility: private`, meaning the same
two populations the trip's own values mean, and it **narrows and never widens**
— the effective requirement is the stricter of the two, so a `guest`
photograph inside a `private` trip stays private. There is no `public` value,
because a label that could widen would be a way past the trip's gate rather
than a way behind it. Absent is the normal case and means everyone the trip
lets in.

Two halves make it real, and half of it is worse than none: `visible()` in
`lib/entries.ts` strips the item from every reading path — the closed default
in `ReadOptions.reader` is what makes a path nobody updated fail safe — and
`app/[user]/media/[...path]/route.ts` refuses the file, because a picture kept
out of the gallery and left at a guessable URL is not held back at all.
`lib/photos.ts` is the whole vocabulary; `readFor` in `lib/tripGate.ts` is the
only thing that should be deciding a reader's level.

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
new trip's default (see `lib/tripWrite.ts`), so a `guest`
journal's trips start out `guest` unless a create call says otherwise, and a
`public` journal's start out `public`. `"private"` still parses wherever this
is read from a file or a request — nothing rewrites a journal nobody has
touched since before the rename — but nothing writes it back out; ask for
`public` or `guest`.

## Working in this repository

- **Local dev is SQLite, production is Postgres**, and nothing outside
  `lib/db/` knows which.
- **No feature needs a paid account to develop or test.** Mail writes `.eml`
  files under `<dataDir>/mail/<user>/` — or `<dataDir>/mail/.mail/` when it
  belongs to no journal yet, which is signup codes — OTP codes are printed,
  and every print provider has a `dry-run` backend that writes files. Every
  path `lib/mail` can write to is under `dataDir()`; nothing lands next to the
  code (B111), and nothing lands under `contentRoot()` either, so it is never
  in a backup or an export (B636).
- **Every optional capability is off by default** and must be *absent* rather
  than broken when disabled. `lib/capabilities.ts` decides, and `/api/health`
  explains why something is off.
- **Secrets never enter `site/config.json`** — environment only.
- **The browser never asks the question.** No `window.confirm`, no `alert`, no
  `prompt`: they render in the operating system's own type, in a box whose
  title bar names the domain, over a page that has gone to some trouble to
  look like somebody's travel journal — and each shows exactly one string, so
  none of them can say what is about to be deleted, what a thing will cost, or
  offer a second choice beside the first. A confirmation is
  `components/ConfirmPanel.tsx`: a panel in the flow, with a button that says
  what it *does* rather than "OK". B633 decided this and wrote it down; B661
  and B664 each reached for `confirm()` again within the fortnight, so B668
  made it `test/no-browser-dialogs.test.ts` as well.
- **Nothing personal in code.** `test/depersonalised.test.ts` fails the build if
  a real name or trip id appears in `lib/`, `app/`, `components/`, `scripts/`
  or `public/`. `content/` and `site/` are where those names belong — an
  imprint is nothing but real names.

### Verifying a change

```bash
npm run verify         # build → tsc → eslint → vitest → knip, stopping at the first failure
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

**`npm run unused` (knip) is the last step, and used to be nobody's.** It
answers the question the other four do not — *is anything here for nothing* —
and it used to run in CI alone, on the theory that the answer changes rarely.
It changes on an ordinary edit more often than that theory allowed: removing
the last caller of an exported symbol is enough, and CI's own `unused` job
failing on a change that had already passed a clean `verify` locally is exactly
this file coming back to say so twice. `verify` now runs it every time, last,
because it is fast — under two seconds, no network — and failing here is a
diff away rather than a CI round-trip away. It fails on a file nothing
reaches, a dependency nothing imports, an import of something undeclared, or
an `export` nothing outside its own file uses; fix the last of those by
dropping the `export` keyword rather than deleting the code. Unused *exported
members* (of an enum, say) it still only prints. `knip.jsonc` carries the
entry points, which are the whole configuration — nearly nothing here is
imported by name. B24.

### A new string in the UI is three files and a script

`t("nav.gallery")` resolves against `site/locales/en.json`, `de.json` and
`hu.json`, and a key added to one of them is a broken build in two ways at
once. `test/locales.test.ts` asserts that **every maintained locale covers
every key English has**, so English alone fails; and `lib/i18n.ts` carries a
`TranslationKey` union that must hold *exactly* the shipped English keys, so
a hand-written union fails too. Regenerate it rather than typing it:

```bash
npm run i18n:keys      # rewrites the union in lib/i18n.ts from site/locales/en.json
```

Write real German and real Hungarian. Nothing checks that a translation means
anything — the tests only check that a key is present and, for a sample, that
it differs from the English — so a plausible-looking machine translation ships
and is read by somebody whose language it is. If you cannot write the language,
say so and leave the ticket short of done; that is the same rule as inventing a
day, one level down.

### Changing a route means changing the contract

**`/openapi.json` and `/agent.md` are the product, for everybody who is not
standing in this checkout.** There is no CMS (decision 24), so an agent
over the network — whether it is somebody's own, or the model behind the web
helper at `/agent` — has the document and nothing else — no source to read,
no colleague to ask. A field the code accepts and the document does not
describe is a field nobody outside will ever use; a field the document promises
and the code drops is worse, because the caller is told it worked.

So, whenever you touch anything under `app/api/`:

- **A new route, or a new verb on one, goes into `lib/api/openapi.ts`.** Every
  `/api/v1/**` and `/api/auth/**` operation must be there, with at least one
  refusal documented beside the success.
- **A new field on a request body goes into its schema**, with the type and,
  if it has one, the `enum`.
- **An enum is imported, never typed out.** `TRANSPORT_MODES`,
  `COST_CATEGORIES`, `FEATURE_NAMES`, `TRACKS`, `VISIBILITIES`, `ACCENTS`,
  `STATUSES`, `FIGURE_FIELDS`, the media formats — the document imports the
  constant the validator uses. Export the constant if it is private; a second
  list beside the first is a list that will disagree with it.
- **A field the API takes is a field it has to show.** If a write accepts it,
  some documented `GET` has to read it back, or an agent cannot check its own
  work — and "it was accepted" is not the same claim as "it is there".
- **A limit belongs where a caller can read it before they hit it.**
  `/api/health` carries the upload formats and sizes for that reason.

`npm run verify` enforces the mechanical half. `test/openapi-contract.test.ts`
fails on an undocumented route+verb, an enum that has drifted from its source,
an operation with no refusal, and a `required` naming a field that is not in
`properties`. `test/api-route-schemas.test.ts` fails on a route that reads a
body without publishing a schema.

**What the tests cannot check is whether the words are true**, and that is the
half that has been wrong most often: `Cost.category` said "free text" and is a
closed list; "published days in a trip" returns drafts too; the module comment
said "there are five endpoints" while describing thirty. The
`keep-the-contract` skill is the procedure for the parts a test cannot reach —
including driving a real journal onto a running instance, which is how B540
found two fields that were accepted, answered `201`, and thrown away.

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
cp -Rc node_modules .claude/worktrees/<branch>/node_modules   # see below
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

**A hook matches tool names, though, and `Bash` is not one of them** — a
heredoc, `sed -i` or a short script wrote here with nothing said, and those are
the calls these sessions make most. B310 closed that, and the shape of the fix
is worth knowing because the obvious one is wrong: parsing a command line for
write shapes is a list that is always missing its next entry — `tee`, `>>`,
`install`, an npm task — and every entry it does have is a false positive
waiting to happen (`grep foo > /dev/null`). So a second hook asks git
*afterwards* instead. `PostToolUse` on `Bash`, one `git status --porcelain`:
if the shared checkout is dirty in a way the rule does not allow, it names the
files and hands over the recipe for moving them into a worktree. That reads
real state rather than guessing at text, and catches every mechanism at once
including the ones nobody has thought of.

It detects rather than prevents, and that is the honest trade — detection that
never misses beats prevention that usually does. So read both guards as the
thing that catches the honest accident, not as a lock: the rule above is still
the rule, and it is still yours to keep.

**Neither is in the repository, and a fresh clone has no guard at all.** They
live in `.claude/settings.json`, `.claude/hooks/main-checkout-guard.mjs` and
`.claude/hooks/main-checkout-bash-guard.mjs`, all gitignored, because a
repository that requires somebody's harness configuration to be workable is a
different promise from the one this file makes. Installing them elsewhere is a
`PreToolUse` entry matching `Edit|Write|NotebookEdit` with a script
implementing those three allowances, and a `PostToolUse` entry matching `Bash`
with one that ignores `docs/tasks/`, ignores what git ignores, and stays quiet
while a merge or rebase is in progress.

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
  resolve upward and appear to work; `npm run build` does not. Clone the main
  checkout's with `cp -Rc` — copy-on-write on APFS, so it is about eight
  seconds and no real disk — rather than `npm ci`, which is minutes and was run
  sixty-five times in one week here. **Not a symlink**: `npm run build` then
  dies in Turbopack with *"Symlink [project]/node_modules is invalid, it points
  out of the filesystem root"*, and `verify` fails at step one for a reason
  that has nothing to do with the change. On a filesystem without `cp -Rc`,
  `npm ci` is still the answer.
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
is not a checkout's job: it happens over the network, and `/agent.md` is the
guide for it.

| Skill | For |
| --- | --- |
| `apply-the-brand` | The mark, the palette, and what not to do to them |
| `check-a-drawing` | Look at something this software draws, at `/docs/branding` — the animation, the figures, a day card, a print margin |
| `deploy` | Ship it to the VPS, and know it is healthy |
| `keep-the-contract` | Check that `/openapi.json` and `/agent.md` still tell the truth after a change to a route |
| `manage-tasks` | Capture something, and move it between lanes |
| `triage-a-backlog` | Read a whole lane of `docs/tasks/` and hand back one page a person decides from |
| `report-a-run` | Account for a finished batch of tickets on one page — what shipped, what was already fixed, what a person can see, what still needs their eyes |
| `work-on-a-task` | Take one approved task, build it in a worktree, merge it |
| `test-the-live-site` | Empty `testing/` against the deployed instance, one subagent per ticket |
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
`.claude/settings.json` is gitignored, so a fresh clone has the seven skills
above and nothing else. An eighth may be on disk and is deliberately not in
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
| `GET /api/v1/<user>/travellers/presets` | the vocabulary the walking figures are described in, and twelve starting points |
| `GET /api/v1/<user>/travellers/preview` | that description as a picture, so a person can see themselves before it is written |
| `POST /api/auth/request` + `/verify` | a six-digit code → a 7-day agent token |
| `POST /api/auth/identity/request` + `/verify` | a six-digit code → a year-long **identity** cookie: proves an address to the whole instance and authorises nothing |
| `POST /api/v1/<user>/handover` | owner only: a 20-minute credential to paste into an agent |
| `POST /api/auth/handover` | an agent spends that credential for its own 7-day token |
| `GET /api/v1/<user>/status` | where an agent stands: drafts waiting, trips, capabilities |
| `/api/v1/<user>/…` | REST: trips, days, drafts |
| `/api/v1/<user>/invites` | issue, list and revoke the two invite links — see below |
| `/api/v1/<user>/postcards` | propose printed postcards — see below |
| `/<user>/postcards/<id>` | where a person looks at them and sends them |
| `/<user>/invite/guest/<token>` | where a guest link lands |
| `/<user>/invite/buddy/<token>` | where a buddy link lands |
| `DELETE /api/v1/<user>` and `…/trips/<trip>` | ask to delete — see below |
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

**Buying credits is Stripe, and the key is the only switch** — B792. `POST
/api/v1/<user>/credits/purchase` (owner only, and an owner's agent token counts)
files a pending transaction and answers with an absolute `paymentUrl`; the
person opens it, and `.../payments/<id>/pay` sends them to a hosted checkout
page for TWINT, a wallet or a card. Nothing an agent holds can pay, and nothing
it holds can grant: `POST /api/webhooks/stripe` is what grants, from Stripe's
own signature over the raw body and a once-only claim on the row
(`claimProviderPayment`). That webhook is one of the three files `GRANT_ALLOWED`
in `test/credits.test.ts` names, beside the operator approval route and the
one-off grant a new journal gets at signup — and that list is the whole of it.

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
`POST /api/v1/<user>/invites` (owner only) makes either a **guest** link — leads to reading the journal's `guest` trips — or a
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
and the same shape as deleting, for a different reason. `POST
/api/v1/<user>/postcards` writes a proposal and answers with a URL; it charges
nothing and prints nothing. The owner opens that page, sees the photograph, the
message on the back, who each card is going to, the cost and their balance, and
presses one button. That button is the only thing in the codebase that spends
credits at a printer.

Addresses never reach an agent. `GET …/postcards/recipients` answers with a
name, a town and a country, and cards are addressed by `contactId` — so a card
can only ever go to somebody who asked this journal for one, and never to an
address that arrived in a conversation. The send route is outside `/api/v1/`,
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
