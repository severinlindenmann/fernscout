# Documentation

Prose about the software — how it is built, how to run it, how to deploy it.
`AGENTS.md` at the repository root and the skills in `.claude/skills/` are the
maintained guidance for an agent; this folder is the long form for a person.

| | |
| --- | --- |
| [running-locally.md](running-locally.md) | production build on your machine; the agent API end to end |
| [runbook.md](runbook.md) | deploying to a VPS, backups, restore |
| [architecture.md](architecture.md) | where things live, and why they are shaped that way |
| [ingest.md](ingest.md) | photographs, EXIF, geodata |
| [currencies.md](currencies.md) | how money is stored, converted and refused |
| [config-upgrades.md](config-upgrades.md) | moving a config file forward a version |
| [deploy-mail.md](deploy-mail.md) | mail, and the file transport that needs no SMTP |
| [providers/](providers/) | the print providers |
| [TESTING.md](TESTING.md) · [qa/](qa/) | the manual walkthrough, and the scenario catalogue |
| [ROADMAP.md](ROADMAP.md) | the decision log |
| [branding/](branding/) | the mark, the palette, and what not to do to them |
| [tasks/](tasks/) | everything to build and everything found broken |
| [plans/](plans/) | the record of intent, written before the work |

## How much to trust this

**Most of this folder was written by an agent during the build and has not been
read line by line by a person.** On 2026-09-01 that was the reason the whole
folder was moved to `docs/archiv/`; on 2026-09-04 it was moved back, because a
directory called *archive* answers the wrong question. "Nobody has reviewed
this" is a fact about provenance. *Archive* is read as a fact about currency —
historical, superseded, safe to ignore — and none of these files are that. The
runbook holds the live restore procedure; `config-upgrades.md` is the only
place `configVersion` is explained. Thirty-odd citations in `lib/`, `scripts/`,
`test/` and `.claude/skills/` never stopped pointing here, and the handful that
were repointed into `archiv/` ended up telling an operator that the backup
procedure was archived. See B23.

So the warning stays, without the misleading container:

**Treat it as useful, not as authority.** It may describe intentions that were
never built, decisions that were later reversed, or commands that have since
changed shape. If you rely on something here, verify it against the code first,
and fix the document while you are there. The code is the authority.

### What was actually checked

On 2026-09-01, every `lib/ app/ scripts/ deploy/ content/ test/` path these
documents mention was resolved against the repository — about 117 references.
All of them resolve. The handful that looked stale were false positives:
`/var/lib/fernscout` matched as `lib/fernscout`, and `content/dev.db` and
`content/example/mail/` are gitignored files that exist only once you have run
the thing.

So the **paths** are accurate. Nobody has checked every **claim** — whether the
explanations are still true, whether the trade-offs described are the ones that
shipped. `architecture.md` is the strongest of them: 40 path references, all
resolving, and its account of the module layout, `proxy.ts`, the baked world
map and the paged reading model was spot-checked against the code and held.

Two files are known to be half stale, and are kept for the half that is not:

- **`ROADMAP.md`** — the decision log at the top is durable and is cited by
  number from code and from `AGENTS.md` ("ROADMAP decision 24"). The *open
  backlog* below it is superseded by `tasks/`; read it as history, and capture
  anything you still want into `docs/tasks/backlog/`.
- **`TESTING.md` and `qa/`** — the walkthrough and the scenario catalogue.
  Accurate as far as anyone has walked them, which is not recently.

## Plans are not documentation

`plans/` holds one file per work package, W01 through W38, plus the dated plan
the `superpowers` skill wrote for W37. **They are the plans as they were
written, before the work, and they are deliberately not updated to match what
shipped** — a command or a path in one may not be the form that exists today.
They are kept because code comments cite them for the reasoning behind a
decision (`grep -rn "docs/plans" lib test`), and a citation that leads nowhere
becomes folklore.

Do not correct a plan, and do not move one out. When a plan has an unbuilt
remainder, open a task pointing at it. Anything you want to be *true* goes in
one of the files above, or in a task.
