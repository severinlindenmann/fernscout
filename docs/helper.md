# Fernscout Helper

**A journal is markdown and photographs in a folder you own, and there is still
no web form, no upload widget, no CMS — and there will not be one (ROADMAP
decision 24). Writing happens through an agent.** That is a clean answer to
"who owns this content" and an unhelpful one to "I have ten days of holiday
photos on my laptop and no idea where to start" — unless the instance you are
on hosts an agent for you at `/agent`, in which case that is the shorter path.

[**Fernscout Helper**](https://github.com/severinlindenmann/fernscout-helper) is
the answer for anybody who would rather run their own: a separate,
MIT-licensed repository of tools an agent runs on your own machine, which
extract what you already have, ask for what only you know, and write it out in
this project's own content format.

It is not part of this software and it is not required to use it. Nothing it
produces depends on it afterwards — the output is `trip.md`, `costs.md` and
`entries/*.md`, which is what this repository reads whether an agent, a script or
a text editor wrote them.

## What it is for

Three jobs, and every tool in it does one of them.

| | |
| --- | --- |
| **Extract** | Get what already exists out of wherever it is stuck — a phone's photo library, a bank's CSV export |
| **Create** | Ask for what only a person knows — what happened that day, what the flights cost — and write it down without inventing the rest |
| **Format** | Turn all of it into this project's shape: one entry per day, sized galleries, costs, coordinates, `status: draft` |

## Getting it

```bash
git clone https://github.com/severinlindenmann/fernscout-helper
cd fernscout-helper
claude
```

There is nothing to install for the repository itself — the scripts are plain
Node with no dependencies. Individual tools want their own command-line
programs, and each one checks and asks before anything is installed.

**It is built and tested with Claude Code on macOS.** Claude Code reads
`.claude/skills/` without being configured, and a Mac is where the photo tools
can reach a Photos library directly. The cost tools care about neither: a bank
statement is a CSV and a journal is markdown on any operating system.

## Extracting photographs

Say *"help me export photos from iCloud on my Mac"*. What follows is five
commands the agent runs for you, and one evening you spend in a browser.

1. **The tools are checked** — `osxphotos` to read the Photos library,
   `exiftool`, and Node. Nothing is installed without asking. `exiftool` is the
   one that matters: Photos keeps location in its own database rather than in
   the files, and without it every exported picture arrives with no coordinates
   at all.
2. **You are asked four things**: the dates, what to call the trip, whether
   there is an album, and whether to take everything or only the good ones.
   Photos scores its own pictures, so "every favourite plus the best-scoring
   rest, fifteen a day" is available and is a decent first pass.
3. **The selection is counted before it is fetched.** How many photographs, how
   many gigabytes, roughly how many minutes — read back to you, because anything
   not already on the Mac comes down from iCloud.
4. **A page opens in your browser.** Every photograph, grouped by day, with a
   **Keep** button and a note field, and a bigger box per day for what happened.
   You turn off what does not belong — the screenshots, the picture somebody
   sent you — and write a few words. It saves as you type.
5. **The content folder is written.** One entry per day, galleries sized to
   2000px, your photo notes as captions, coordinates in the frontmatter — and
   **every trace of metadata stripped from the pictures themselves**, which is
   the same rule `lib/ingest` follows here and for the same reason: a phone
   writes the coordinates of somebody's front door into a file.

Then the agent writes each day from your notes and from nothing else. Days you
said nothing about get a question, not a paragraph.

## Extracting costs

Say *"import my Revolut statement"*. A consolidated statement is CSV — in the
app, *Accounts* → the three-dot menu → *Statement*.

- Transactions are read out per account currency, filtered to the trip's dates,
  and **printed for you to look at first**: by day, and by merchant with the
  biggest first. Twenty merchant names is a two-minute conversation; seventy
  payments is not.
- Transfers, exchanges and money coming in are left out — moving your own money
  between your own pots is not a trip cost — and they are kept in the working
  file and marked, never silently dropped.
- **The exchange rate is computed from what the bank actually moved**: the amount
  debited divided by the amount received, across every payment. That is the
  number `trip.md`'s `rates:` block wants, and it is the one figure nobody can
  look up afterwards.
- You sort the merchants into this project's seven categories. **A statement says
  what was paid, never what it was for** — the agent proposes, you correct, and a
  category this software does not know is refused rather than quietly turned into
  `other`.

Another bank is a different reader over the same middle: the file it produces is
generic, and the half that writes into the journal is unchanged.

## The costs a statement cannot see

Say *"what did the trip cost"*. This one is an interview, because the biggest
lines are the ones no card statement covering the trip dates will ever show:
the flights booked in March, the hotel paid on arrival, the car on somebody
else's card, the cash nobody has a receipt for.

The agent looks at what is already recorded, names what is missing — which
categories have nothing, which days have nothing, whether flights and
accommodation are absent entirely — and asks about those rather than about
everything. Advance bookings land in `costs.md`; things paid during the trip land
on the day. A budget can be set, and the costs page then draws real spending
against it.

**It will not estimate.** An amount nobody remembers is not recorded, and the
page reports an incomplete total rather than a confident wrong one. Costs
somebody typed and costs read from a statement live in the same list, and only
the imported ones are marked — so re-importing replaces those and never touches
yours.

## This instance's own import door

Everything above assumes an agent with a shell, running this tool on your own
machine against files this project reads and writes directly. A **hosted**
journal's owner has no shell on the server, and an agent driving one over the
network never does either — so since B665/B671/B677 this project has grown
its own door for the two kinds of data that are measurements rather than
editorial judgement: `POST /api/v1/<user>/import`, taking a `kind` of `gps`
or `costs` and bytes from the inbox, from multipart or from plain `text`.

It is not a replacement for this repository's interview — **costs** import
still writes nothing on its own: a statement is reported, a person agrees the
categories merchant by merchant the same way they would in a conversation
with an agent, and a second call (`.../costs/import`) writes the agreed rows.
**GPS** import is different in kind, not degree: a coordinate is a
measurement, so it is stored as read, with no agreement step at all — see
`docs/gps.md`. `importers/` (MIT-licensed, same as this whole tool) is the
registry of small parsers behind both: Google Timeline, Google Takeout, GPX
and a neutral JSON Lines format on the GPS side; a bank statement's own CSV
shape on the costs side.

There is no equivalent import kind for photographs yet. `content/<user>/inbox/media/`
(B663) is where a file can land before it belongs to a day — named by a hash
of its own bytes, so uploading the same picture twice is a no-op — but
turning a folder of camera files into entries is still either this
repository's own interview, locally, or — for an owner self-hosting with a
shell on their own checkout — `npm run ingest` against a folder of camera
files directly.

## What comes out

```
content/<you>/trips/<trip>/
  trip.md                     the trip, its dates, its rates, its budget
  costs.md                    what was spent before leaving
  entries/2026-06-23-….md     one day: prose, gallery, costs
  media/…                     pictures, resized, metadata stripped
```

Point this software's `CONTENT_DIR` at that `content/` folder and it is a site —
see [running-locally.md](running-locally.md). Or hand the files to a hosted
journal over the API, for which [`/documentation.txt`](/documentation.txt) and
the `/skill/*.md` task guides are the guide.

**Everything it writes is a draft.** `status: draft` on every entry, filtered out
of every reading path by `lib/entries.ts`. Publishing is a person's decision
here exactly as it is everywhere else in this project.

## What it does not do

It does not host, serve or render anything, it holds no account and no database,
and it sends nothing anywhere — statements and photographs stay on the machine
they were read from, and its `import/`, `export/` and `content/` folders are all
gitignored. It is a separate repository with its own release cycle: this project
does not depend on it, and it is not tested by this repository's suite.
