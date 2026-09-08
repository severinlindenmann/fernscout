---
name: test-with-personas
description: Drive /agent, the guided web helper, as an invented non-technical persona who gets a URL and nothing else — no source, no ticket. Use when the user says "run a persona round", "test with personas", or after a change to the helper that needs proving on somebody who has never seen it.
---

# Test with personas

Nobody has a ticket for this one. `test-the-live-site` empties
`docs/tasks/testing/` — it has an acceptance line and checks whether it holds.
`test-in-a-browser` gets you signed in locally so you can look at a page.
Neither asks the question this skill exists for: **can a person who is not the
author, has never read a line of this repository, and does not want to learn
how it works, actually get a day written through `/agent`?**

That gap has bitten before, repeatedly, in the same shape: a round of persona
testing came back with a tidy report of "improvements," and the owner then
opened `/agent` himself and it did not work — his words were *"i am confused,
the /agent did you not rework it a lot? right now it does not work really"*.
A persona run that produces prose produced nothing. This skill's whole point
is to stop that from happening again.

## The rule that makes this different from writing about the product

**The subagent playing a persona gets a URL and nothing else.** Not the
component that renders the ask box, not the tool contract, not this file's
own list of known gaps below. An agent that has read `components/` (or
whatever renders the wizard this week) cannot tell you a button is
unfindable — it already knows where the button is. Hand over `/agent` (or
`https://fernscout.ch/agent`) and the persona description, and stop there.

## The personas

Use invented, named characters, not "a user". The set that keeps finding
things, because each rules out a different way of failing:

- **A 71-year-old on a phone.** Small type, unfamiliar words, no patience for
  a screen that scrolls sideways. Finds the wall.
- **A technically confident person on a desktop.** Will read the fine print,
  try the keyboard shortcut, and notice when a documented capability has no
  button. Finds where the words lie.
- **A young person who is fluent with phones but does not like typing.**
  Wants to talk to it, not type into it — this is the one that tests voice
  input and short, thumb-sized replies.
- **A Hungarian-speaking reader.** Tests the words, not the flow. The helper
  answers in the reader's own language, and machine-sounding German already
  reached production once — the owner quoted a nonsense string back at it.
  Hungarian (or whichever non-English language you pick) is the check that a
  translation is not just English with different letters.
- **Someone using a screen reader.** Never sighted, never a mouse. Finds
  what was never reachable at all — the two testing skills above cannot
  produce this finding because a subagent driving a browser tool sees the DOM,
  which is not the same as hearing it.

Run **at least three per round**, and **retest one persona from the previous
round every time**. This is not caution for its own sake: the 71-year-old's
retest is what proved a fix actually worked and *also* found that the same
failure had only moved one screen later — a new persona, meeting the flow for
the first time, would have had no way to notice the obstacle had moved rather
than gone. (`docs/plans/2026-09-07-helper-everything.md`, "How each round is
validated".)

## Setting one up

### Against the live instance

Point personas at `https://fernscout.ch/agent` directly — there is no local
build to keep in sync, and this is the surface a real stranger meets.

Every persona needs an email address to sign in with. **Always
`<name>@severin.io`** — `oldperson@severin.io`, `youngperson@severin.io`, and
so on. Never a fabricated address, and never `example.com`: the instance
actually sends mail to whatever address a persona types, so it has to be one
that exists and belongs to nobody a real message would surprise.

Reading the six-digit code the instance mails: with `keepCopy` on, every
message is also written to disk (`lib/mail/index.ts`), so an agent with SSH to
the VPS reads it without a mailbox. It lands under **the journal the mail
belongs to** — `<dataDir>/mail/<user>/` — and a signup code, which belongs to
no journal yet, lands in `<dataDir>/mail/.mail/` instead. That is a *username*,
never a mail domain, so glob both. Files are swept after two days. The `.eml`
body is base64 with CRLF line endings — grepping the raw file for six digits
finds a wrong number, not the right one, because digits also appear un-decoded
elsewhere in the envelope. Decode first:

```bash
ssh <vps> '
  d=$(sudo grep -o "^DATA_DIR=.*" /etc/fernscout/env | cut -d= -f2)
  f=$(sudo ls -t $d/mail/*/*.eml $d/mail/.mail/*.eml 2>/dev/null | head -1)
  sudo cat "$f" | grep -E "^[A-Za-z0-9+/=]{40,}" | tr -d "\r" | base64 -d \
    | grep -oE "[0-9]{6}"
'
```

`<vps>` is deliberately not written out here — this instance's own host lives
in the `vps` skill, which is gitignored per-checkout on purpose (see
`AGENTS.md`, "Skills that are not this repository's"). Use that skill's own
host, not one copied from another document. `.claude/worktrees/…` agents
still need the same read-only discipline `test-the-live-site` describes: `sudo
cat`, `ls`, `grep` are fine, restarting or editing anything on the box is not.

### Against a local checkout

Skip the mailbox entirely: set `AUTH_DEV_CODE=123456` in the dev server's own
environment and every sign-in code becomes that fixed value
(`lib/auth/index.ts:200`, and the comment above it at line 19 explains why —
it exists for exactly this, end-to-end testing with no inbox in the loop).
Follow `test-in-a-browser` for getting a dev server up with the capabilities
`/agent` needs turned on; this skill only changes who is driving it and what
they are allowed to know.

## Content a persona writes is invented — flag it as such

A persona is inventing a day nobody lived, so everything AGENTS.md says about
`test: true` applies here without exception: content it writes must carry
`test: true`, and the journal it writes into must itself be named
`test-<something>` — never a name that reads like a real person's, so that
anyone finding it later, on disk or in a backup, can tell at a glance it is
safe to delete without asking whose it was.

## Running a round

Dispatch one subagent per persona. Each one gets, and only gets:

- the URL (`/agent` on the live instance, or the local dev URL)
- the persona description — age, device, language, ability, and the one task
  they showed up to do ("write down the Tuesday we lost the tent")
- their email address on `severin.io`
- nothing about how the product is built, and nothing about what previous
  rounds found

Tell it explicitly: finish the task or report exactly where it got stuck, do
not read source, do not guess at intent from a component name it happens to
see in a network request. A persona that cannot finish is a **failed round**,
full stop — it is not a list of suggestions, and it is not "mostly works".
Report it exactly that bluntly.

## What counts as a finding

Every obstacle a persona hits becomes a `backlog/` capture, with an id from
`npm run tasks -- new` — never hand-numbered, never left as a paragraph in a
chat transcript. This is the fix for the failure mode this skill exists to
prevent: a round that ends in a polished report and no tickets is a round
that changed nothing, because nobody reads a report before opening `/agent`
themselves.

```bash
npm run tasks -- new --type ISSUE --priority high --complexity low \
    --area "helper" --title "<the problem the persona hit, not the fix>"
```

A round's report to the person who asked for it is a list of ids, one line
each: which persona, what they were trying to do, where they stopped, the id
that now tracks it. Nothing else. If a persona finished cleanly, say so in the
same list — "the 71-year-old finished the day unaided" is itself a result
worth a line, not silence.

## What a persona must never be steered around

Repeated here because a persona hitting one of these gates is not a bug —
reporting it as one wastes the ticket:

- **Publishing stays a two-step, spoken decision.** If a persona's task
  requires the day to be live and not a draft, the persona has to actually
  say so in words to the helper and see the separate publish step, the same
  as a real owner would. A persona that finds a way to skip that step has
  found a real finding — file it.
- **Deletion ends in a mailbox.** A persona asking the helper to delete a
  trip should see it accept the request and say a mail is waiting — not "done".
  If it ever says "deleted", that is the finding, not the confirmation.
- **A postcard is previewed, never sent, by the persona.** The send button is
  the owner's own page, cookie-session only; a persona playing an agent
  should never reach it.

## When you are done

Clean up whatever the personas actually wrote: delete the `test-<something>`
journals, or leave them if the owner wants to look at what a persona produced
first — ask, don't assume. Report per persona (finished / stuck-with-id) and
nothing more polished than that list. Do not move anything to
`docs/tasks/completed/` — that lane is a person's, same as everywhere else in
this repository.
