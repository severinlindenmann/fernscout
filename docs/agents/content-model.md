# Fernscout, for agents

A self-hostable travel journal. **The content is JSON documents and
photographs in a folder the author owns.** It was markdown with YAML
frontmatter until B1598; the prose still lives in a `content` field and is
still written by a person, but a day and a trip are each one JSON file now,
serialised by `lib/api/v2/documents.ts` and by nothing else. There is no CMS, and there will not be one (ROADMAP
decision 24): no form that composes a new day out of fields, no upload widget
with its own idea of what a day is. **An agent is the only thing that writes a
day; a person may correct one they already have** — `components/EditDay.tsx`
(B980) is that correction, reached from the published day itself, and it
writes no field the day did not already carry and cannot invent a new one.
Writing happens through an agent — and since B681/B682, a person with no agent
of their own can reach one anyway, through a guided web helper at `/agent`
that writes through the same API this file describes. Reading happens in a
browser and, now, so does describing a day out loud to the helper; nothing
about what a browser is allowed to *do* on the owner's behalf without a model
in front of it has changed. This file exists for the agent on either side of
that: the one you are, and the one the helper runs.

Two ways in, and they are the same content behind two doors:

| You are | Use |
| --- | --- |
| Working **in this repository**, with the files on disk | the skills in `.claude/skills/`, and this file |
| Working **against a running site**, over the network | `/documentation.txt`, the `/skill/<task>.md` guides (B311), and `/api/v2/…` (REST, generated at `/api/v2/openapi.json`) |

## The one rule

**The agent is the editor.** It writes, it publishes, it corrects. There is no
form and no CMS to fall back on — the web helper at `/agent` is a face on an
agent, not an exception to this rule, since a model is what turns what a
person describes into a day and the wizard never lets a person set a field
directly the way a CMS would. So if no agent, human-driven or the helper's
own, will do a thing on the owner's behalf, the thing cannot be done at all —
which is why the rule is stated as a capability and not as a restraint.

**What an agent writes arrives as a draft.** A day is one JSON document
(`lib/api/v2/documents.ts`) and its `status` field accepts only `"draft"` on
write, and every reading path filters a draft out in `lib/entries.ts`. It is
the default so that a person can read a day back before it is on the site — a
courtesy to them, not a gate against you. `PUT /api/v2/<user>/trips/<trip>/days/<slug>`
creates it, has no way to set any other status and no publish-on-create, for
exactly that reason: writing and publishing are two calls so there is a moment
in between. The web helper at `/agent` writes through this same call and
arrives at the same draft; it has no shortcut around it.

**Publishing is the second call, and it is yours to make when asked:**
`POST /api/v2/<user>/trips/<trip>/days/<slug>/publish`. Owner only — a
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

**Weather has two true routes, and neither of them is your memory.** Since
B325 a day may carry `weather: true`, and the *server* looks it up — from a
public archive, at the coordinates that day already carries, credited to the
archive on the page. That does not soften the sentence above; it is what makes
it survivable, because until there was a measurement, guessing was the only
way to answer at all. The lookup happens **in the write that asks for it** —
the v2 day `PUT` and `PATCH` service `weather: true` before they answer, so
the reading is in the response the caller reads (B1713). It never overwrites a
reading already there, and it never invents one: a day the archive cannot
answer for keeps a bare `weather: true`, and sending `weather: true` again is
how a caller asks a second time. There is no sweep — a nightly job used to be
the only thing that serviced the field, which meant a day written through the
API had no weather until the next morning and nothing said so.

**The second route is `weatherData`, and an agent may use it.** A reading that
came from somewhere real — a person's own instrument, a station they run, a
weather service they pay for, an export from a device that was on the trip —
goes in `weatherData`, and this is a supported thing for an agent to send, not
a grudging exception. It is what lets somebody use their own tools to produce
their own data rather than this service's: the instance is not the only thing
allowed to know what the weather was, it is only the thing that must be able
to tell a measurement from a story.

So the field is accepted on exactly one condition — **it says where it came
from** — and the server checks the shape of that claim rather than taking your
word for its tidiness (`checkWeatherData`, `lib/validate/entry.ts`):

- `source` is required and non-empty. A number with no source is
  indistinguishable from one you made up.
- `recordedAt` is required and must be a real ISO instant.
- At least one measurement, and every measurement inside a plausible range —
  `tempMax: 900` is refused.
- No key the field does not define.
- **`open-meteo` is refused outright**, because that name means *this server*
  looked it up, and an agent able to claim it could erase the distinction with
  one string. A day whose weather the server fetched carries that source in
  its own file, so a client forwarding a journal must skip those rather than
  send them back (B1578).

**What is forbidden is unchanged, and it is the only thing that was ever
forbidden: inventing the reading.** A temperature, a condition or a wet
afternoon from your own belief about what that Tuesday was probably like. Your
confidence is not a source, and neither is a plausible-sounding instrument you
made up to satisfy the check — the server can validate that a source was
*named*, never that it was *real*, so that half is instruction and rests on
you. **Ask for the lookup, or pass on a reading somebody actually took. Never
compose one.**

The same line governs the two fields beside it. `timezone` and `visibility` on
a day are likewise sent when the file or the person supplies them, checked for
shape by the server — an IANA zone name, and `guest`/`private`/`null`, where
there is deliberately no `public` because a label narrows what the trip
already allows and can never widen it — and never guessed at on somebody's
behalf.

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
  legal/<code>.md             this instance's imprint (optional — no file, no
                              page and no footer link)
```

**The currency reference rates are not here, and are in no checkout** (B1084).
`<DATA_DIR>/rates/ecb.json` is a *measurement with a date on it*, so it sits
with the other instance state rather than with the source: a rate that arrives
by `git pull` only moves when somebody deploys, and the live instance was
serving a twelve-day-old table before this changed. A deployed instance
refreshes it nightly off the back of the backup timer
(`scripts/backup.sh` step 0 → `scripts/rates-refresh.mts`), which also means
**nothing fetches or keeps a table on an instance with `costs` switched off**.
A fresh clone has none at all and offers the base currency only, which is a
visible absence rather than a wrong number.

An instance may still override `locales/` and `legal/` by putting its own
beside its journals under `CONTENT_DIR`; that is where they lived before B510,
so an instance that has not migrated keeps working. A pre-B1084 rates file in
either old place is still read, until the first refresh writes the new one.

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
        trip.json             the whole trip as one document: metadata, intro
                              prose, and the `costs`, `plan`, `rates` and
                              `translations` sections that used to be their
                              own files
        entries/
          YYYY-MM-DD-slug.json  one update. Several per day is normal. The
                              file name is the day's id, date prefix and all.
                              (`costs.md` and `plan.md` are gone — both are
                              sections inside `trip.json` since B1606)
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

**A photograph you upload is kept, untouched, as the print master — send the
largest file you have, not the size the site displays.** `POST
.../trips/<trip>/media` derives a resized copy the browser is served and
keeps what you sent, whole, for a photobook to print from; a copy of the
document sent to a print run does not get another chance at the pixels a
smaller upload discarded (B1533). A full-page plate at 300 dpi on A4 wants
roughly **2500×3500 px** — well past the 2000px the served copy is capped
to — so aim for at least that when the source has it, and higher up to
`/api/health`'s `media.imageMaxEdge` ceiling is better still, not merely
tolerated. **There is no way to improve a photograph already on a day by
re-sending a larger version of it**: the upload route's own duplicate check
compares bytes, not names, so a bigger export of the same picture is not
recognised as "the same photograph, better" and lands as a second, separate
item rather than replacing the first. Swapping in a better file means
deleting the original with `DELETE .../media` first — there is no in-place
upgrade, which makes it cheaper to send the largest file from the start than
to discover this after a trip is already published.

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

**`gps` and `contacts` still go through `POST /api/v1/<user>/import`** — B671
deleted the CLI B665 shipped with. A hosted journal's owner has no shell on the
server and an agent never has one, so a capability reachable only by `npm run`
was unreachable by both. The route takes a `kind` and an optional `format`,
and reads bytes from the inbox, from multipart or from `text`. `gps` is
stored as it is read — a coordinate is a measurement, and there is nothing
about it to decide; `POST /api/v1/<user>/trips/<trip>/track` is the separate
decision that draws one trip's line, and neither call ever returns a
position.

**`costs` moved to `/api/v2` in B1624, and the difference is the rule this
project is built on.** A statement covers the trip and the fortnight either
side of it, and what each line was *for* is an editorial decision, so the
route writes **nothing** by itself: stage the export through
`POST /api/v2/<user>/media` (`intent.kind: "bank_export"`), read it back as a
report — merchants, payments, the rate each foreign currency actually cost —
with `GET /api/v2/<user>/statements/{src}`, agree the categories with the
person merchant by merchant, and only then does
`POST /api/v2/<user>/trips/<trip>/costs/apply` write the agreed rows onto the
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
lists live where the writer is actually reading them: `/skill/add-a-day.md` for
an entry and for the trip document, and the Zod schemas in
`lib/api/v2/schemas/` for what each route will accept — those schemas are the
contract, and `/api/v2/openapi.json` is generated from them rather than
maintained beside them. A reference kept in two
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

