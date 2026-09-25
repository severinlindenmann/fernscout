# Documentation

Prose about the software: how it is built, how to run it, how to deploy it.
`AGENTS.md` at the repository root is the short contract for an agent working
in a checkout; this folder is the long form for a person.

| | |
| --- | --- |
| [running-locally.md](running-locally.md) | production build on your machine; the agent API end to end |
| [runbook.md](runbook.md) | deploying to a VPS, backups, the nightly timer |
| [capabilities.md](capabilities.md) | every optional capability, what it needs, and what switching it off means |
| [disaster-recovery.md](disaster-recovery.md) | the machine is gone: what a snapshot holds, and how the journals come back |
| [architecture.md](architecture.md) | where things live, and why they are shaped that way |
| [ingest.md](ingest.md) | photographs, EXIF, geodata |
| [gps.md](gps.md) | where somebody actually went: a private position store, and the line a trip owns |
| [statements.md](statements.md) | what a trip cost: reading a bank statement, and why it takes two calls |
| [helper.md](helper.md) | Fernscout Helper, agent tools that make content for a journal |
| [currencies.md](currencies.md) | how money is stored, converted and refused |
| [config-upgrades.md](config-upgrades.md) | moving a config file forward a version |
| [deploy-mail.md](deploy-mail.md) | mail, and the file transport that needs no SMTP |
| [TESTING.md](TESTING.md) | the manual walkthrough |
| [ROADMAP.md](ROADMAP.md) | the decision log, cited by number from the code |
| [testing/](testing/) | the coverage matrix: which flows exercise which capability |
| [branding/](branding/) | the mark, the palette, and what not to do to them |
| [screenshots/](screenshots/) | how the pictures in the root `README.md` were made, and the size ceiling they are kept under |

## How much to trust this

**Much of this folder was written with an agent during the build, and not
every line has been read by a person.** Treat it as useful, not as authority.
It may describe intentions that were never built, decisions that were later
reversed, or commands that have since changed shape. If you rely on something
here, check it against the code first, and fix the document while you are
there. The code is the authority.

The **paths** these documents mention are checked: `test/docs-links.test.ts`
fails the build when a cited file does not exist. The **claims** are not
checked the same way. `architecture.md` is the strongest of them; its account
of the module layout, `proxy.ts`, the built-in world map and the paged reading
model has been spot-checked against the code.

`ROADMAP.md` is half history: the decision log at the top is durable and cited
by number from the code ("ROADMAP decision 24"); the backlog below it is out of
date. `TESTING.md` is accurate as far as anyone has walked it, which is not
recently.

Hosted-only features (photobooks, postcards, WhatsApp, buying credits) are not
documented here; they live, with their documentation, in the private
repository behind fernscout.ch.
