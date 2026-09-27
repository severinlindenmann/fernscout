# Documentation

Prose about the software: how it is built, how to run it, how to deploy it.
`AGENTS.md` at the repository root is the short contract for an agent working
in a checkout; this folder is the long form for a person.

| | |
| --- | --- |
| [running-locally.md](running-locally.md) | production build on your machine; the agent API end to end |
| [runbook.md](runbook.md) | deploying to a VPS, backups, the nightly timer |
| [capabilities.md](capabilities.md) | every optional capability, what it needs, and what switching it off means |
| [glossary.md](glossary.md) | one word per concept — the terms the studio, the API and these docs use, in English, German and Hungarian |
| [disaster-recovery.md](disaster-recovery.md) | the machine is gone: what a snapshot holds, and how the journals come back |
| [architecture.md](architecture.md) | where things live, and why they are shaped that way |
| [ingest.md](ingest.md) | photographs, EXIF, geodata |
| [gps.md](gps.md) | where somebody actually went: a private position store, and the line a trip owns |
| [guides/](guides/) | the reader-facing guide on where a traveller's GPS goes (`gps`), served live at `/docs/guide/gps` in every maintained locale |
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

The **paths** these documents mention are checked, but only partly:
`test/docs-links.test.ts` is a Vitest test, not part of the build. It checks
markdown-link syntax inside `docs/`, a backtick-quoted path in a top-level
`docs/*.md` file, and a `docs/…` citation in `lib/`, `app/`, `components/`,
`scripts/`, `test/`, `proxy.ts`, `instrumentation.ts` and `next.config.ts` —
but a backtick path *inside* `docs/testing/` or `docs/guides/` is still not
checked. The **claims** are not checked either way; check them against the
code before relying on one.

`ROADMAP.md` is half history: the decision log at the top is cited by number
from the code ("ROADMAP decision 24"), but a decision can be superseded or
reversed by a later one in the same log — read forward to the end before
trusting an early one. The backlog below the log is out of date.

Hosted-only features (photobooks, postcards, WhatsApp, buying credits) are
marked "hosted edition only" wherever they come up in this folder. Their own
walkthroughs and testing flows live in the private repository behind
fernscout.ch, not here.
