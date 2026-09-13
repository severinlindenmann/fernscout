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

