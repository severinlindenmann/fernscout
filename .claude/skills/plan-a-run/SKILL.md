---
name: plan-a-run
description: Ask, up front and all at once, every decision a batch of approved tickets will need — validity, options as throwaway mockups, and open questions with a recommended default — and turn the answers into a brief a build can read with no person in the loop. Use when the user says "plan a run", "plan-a-run B1091 B1092 B1057", "get a batch ready to build", or hands over several ticket ids at once and asks what building them would take.
---

# Plan a run

`run-a-batch` builds a batch of tickets end to end and does not speak to a
person again once it starts (B1100). That is only safe because every decision
the build could hit was made before it started, in one sitting, by a person
looking at one page. This skill is that sitting.

It is `triage-a-backlog`'s sibling and the wrong end of the same problem:
triage sorts tickets nobody has started and hands back a decision list; this
one takes tickets already approved into `open/`, looks at the actual code
each one touches, and hands back a **brief a machine can execute**. Read
`triage-a-backlog` first — the decision-bar, the artifact palette, and the
"copy to clipboard, paste it back" mechanics are the same machinery, reused
by reference rather than restated here.

## The one rule

**Every question the run could ask is asked here, or it is not asked.**
`run-a-batch` has no channel back to a person once it starts — a question
that arrives mid-build is parked with its evidence and shows up as a row in
the final report, not as a prompt somebody was supposed to be watching for.
So a question this skill could have asked and did not is a build that stalls
silently four hours in, which is worse than a build that never started. When
in doubt, ask it now with a recommended default, so answering is a tap rather
than typing.

The corollary the retrospective evidence backs (B1099's Why): the spec and
plan gates are what catch a defect before code exists, and skipping straight
to the diff is how a reviewer who knew the task but not the plan passed work
that built infrastructure nothing ever integrated. This skill *is* the gate.
Nothing here is a shortcut worth taking.

## Input and output

**Input**: a list of ticket ids, all sitting in `docs/tasks/open/` (or the
user names a lane and this skill reads what is in it — but never `backlog/`;
promoting a ticket into `open/` is a person's call and this skill does not do
it, same as `triage-a-backlog`).

**Output**: one Artifact, and — once the person answers it — one file:
`.claude/runs/<run-id>/brief.json`, plus a per-ticket directory
`.claude/runs/<run-id>/<ticket-id>/` holding that ticket's before-captures and
every mockup HTML file the artifact offered. `run-id` is a short date-and-slug
you choose once, e.g. `2026-09-09-costs-batch` — pick it before step 1 so
every path below is stable.

```bash
mkdir -p .claude/runs/<run-id>
```

`.claude/runs/` needs no `.gitignore` entry — `.claude/*` is already ignored
except `.claude/skills/`, so a run directory is local state by construction,
same as a worktree.

## Step 1 — scope it

List the ids given, or the lane named. Read every task file **in full** before
dispatching anything — you need each ticket's Why, Work and Acceptance to
brief the subagents in step 2, and a subagent hand-fed only an id re-reads a
file you already have open.

**A note arriving with an id is input to that ticket's question set, not a
decision already made.** `triage-a-backlog`'s decision bar carries a note per
ticket ("promote, but only the read side", "same work as B1054") and the
paste-ready `plan-a-run B1091 B1092 …` line a person hands you is often
followed by exactly this: lines of prose under the ids, one per ticket that
carried a note. Read it before step 2 and hand it to that ticket's subagent
alongside the file — it is the person telling you what they were thinking when
they chose, and it can narrow validity, rule out an option before it is drawn,
or answer a question the ticket itself never poses. It is still not a
`## Decided` section (see step 2): a triage note is what somebody thought
skimming a title, not a verified answer, so a subagent still checks it against
the code rather than taking it as given.

Say the count before you start, same as `triage-a-backlog`.

## Step 2 — one subagent per ticket, on Sonnet, dispatched together

One ticket, one subagent, all launched in a single message so they run
concurrently — a batch this size (a handful to a dozen tickets, per B1100's
concurrency cap) does not need `triage-a-backlog`'s batches-of-eight; give
each ticket its own attention, because this step reads code, not just prose.

Give every subagent the ticket's full file contents and this exact brief:

```
You are preparing ticket <id> — "<title>" — to be built unattended, later,
by an agent that will see only a JSON brief and never this conversation.
Read the ticket in full (given below) and then the code it names. Do not
write any code and do not move the task file.

Answer, in order:

1. VALIDITY — one of four, each grounded in a file:line you actually read:
   - "valid": the problem still exists; say where.
   - "already fixed": say by what change, file:line that shows it.
   - "superseded by <id>": name the ticket that overtook it.
   - "premise is wrong": say why, in one sentence a person can act on.
   A ticket that is not "valid" is DROPPED — do not do steps 2-5 for it.
   A ticket that **is** "valid" but whose own Work section names a
   prerequisite that does not exist yet and sits unpromoted in `backlog/` —
   a route nothing has built, a store nothing has created — is BLOCKED, not
   dropped and not listed: dropping it says the ticket is wrong, and listing
   it hands a group subagent a ticket it cannot build, which either invents
   an ad-hoc version of the missing prerequisite or burns its three verify
   cycles and parks (B1115's Why is the recorded case, B1058 against B1057
   and B1064). Name the blocking id(s) and say, for each, whether promoting
   it into this same run is realistic.

2. CONFLICT CHECK — is this ticket held by another session
   (`npm run tasks` shows the holder), is it actually sitting in the lane
   you were told, and does a sibling worktree under .claude/worktrees/
   already touch the files this ticket would touch (`git status` /
   `git diff --stat` in each). Report what you found; a real conflict also
   drops the ticket.

3. BEFORE-STATE — if a person would see this ticket's fix (a page, a card,
   an email, a printed layout), capture it now with B1097's script:
     node .claude/skills/test-in-a-browser/check-page.mjs <url> \
       .claude/runs/<run-id>/<id> --widths 1280,390 --slug before
   against a local dev server or the live site, whichever the ticket's own
   evidence points at. `--slug before` is not optional: it is what names the
   files `before-1280.png`, `before-390.png` and `before.json`, which is what
   `report-a-run` looks for and what `run-a-batch`'s `--slug after` sits
   beside. Without it the script names them after the URL and the report finds
   nothing. If it is a bug rather than a visual, reproduce it and
   quote the actual wrong output — a stack trace, a wrong API response, a
   failing command. If neither applies (a pure refactor, a doc fix), say so
   explicitly. Never guess at what a before-state would show.

4. OPTIONS — only where the ticket leaves a real choice. Two or three, and
   each one is a *different stance* on the question — a different mechanism,
   a different default, a different scope — never the same approach with
   different pixel values. Draw each as throwaway HTML+CSS (or inline SVG),
   saved to .claude/runs/<run-id>/<id>/option-<a|b|c>.html, and give each a
   one-sentence reason a person could pick it for. A ticket with only one
   defensible approach gets zero options and a sentence saying why there is
   only one — that is a valid answer, not a gap.

5. QUESTIONS — anything else that needs a person's word, each with a
   recommended default and the reasoning for it, so answering is a tap.

Return ONLY a JSON object matching the brief schema below (ask for it if not
given). Do not invent facts the code does not show.
```

Paste the schema from "The brief" below into each dispatch so subagents write
directly into brief-shaped JSON — that is less for you to transcribe in step
4, and it is what keeps the artifact's numbers matching the file it produces.

## Step 3 — group by shared files, once, here

After every subagent reports, look at the files each ticket named (from its
Work section and from what the conflict check actually touched) and cluster
tickets that share a file into one group. This is the **only** place the
grouping is computed — `run-a-batch` reads it back from the brief rather than
recomputing it, the same reasoning AGENTS.md gives for every other fact kept
in one place: a grouping computed twice can disagree with itself, and by the
time that shows up it is two worktrees fighting over one file (B880, B881,
B883, B896 are what that looks like downstream). A ticket touching nothing
another ticket touches is a group of one.

## Step 4 — the artifact

Load `artifact-design` first. Reuse `triage-a-backlog`'s decision-bar
machinery and this repository's palette (`app/globals.css`, via
`apply-the-brand`) rather than reinventing either: cream ground, navy ink,
waymark yellow accent, green for go, coral for stop. **Its step 5 also carries
the `min-width: 0` rule** — take that too, because this page carries more of
what breaks without it than the triage page does: a quoted `<pre>` per ticket,
an evidence line naming a file and a line, a screenshot, and an `iframe` per
mockup. It shipped overflowing on 2026-09-09.

Per ticket, in this order:

1. Id, title, and the **validity verdict** with its grounding file:line —
   this is the first thing a person reads, because a dropped ticket needs no
   further attention.
2. The **before-state** — the captured screenshot(s) inline, or the quoted
   wrong output, or the explicit "no before-state" flag. Never omit this row;
   an absent capture is itself a fact the person should see.
3. **Options**, rendered as the mockups side by side (an `<iframe srcdoc>` or
   inlined markup — never a link the artifact sandbox cannot fetch), each with
   its one-sentence stance and a selectable control. No option is
   pre-selected, same rule as `triage-a-backlog`'s verdicts.
4. **Questions**, each with its recommended default pre-filled and editable.

A **dropped-tickets** section up top, separate from the per-ticket list,
naming every ticket that step 2 marked not-valid and why — these do not get
options or questions.

A **blocked-tickets** section beside it, one row per ticket step 2 marked
blocked, naming its blocker(s) by id and whether each is promotable. Each row
carries exactly one question — *promote the blockers into this run, or park
this ticket* — because that changes the size of the run and is a person's
call, not a default to silently accept. These do not get options either;
there is nothing to build yet.

The sticky decision bar at the bottom: a running count of options chosen and
questions answered, and one control, **build the brief**, enabled once every
still-live ticket has an option selected and every question has an answer.
Pre-fill each question with its recommended default and each option row with
nothing selected — a default is worth reading before it counts as an answer,
but an option is a real fork and must not be silently picked for somebody. So
"answered" means the recommended default is sitting in the field, edited or
not; "chosen" means a person tapped an option.

**Build the brief** assembles the JSON below into a `readonly` textarea,
selected, and attempts `navigator.clipboard.writeText` — report honestly which
succeeded, exactly as `triage-a-backlog` does.

## The brief

`.claude/runs/<run-id>/brief.json`. Everything a second agent needs to know
what to build is in this one file — B1099's acceptance line is that a second
agent handed only this file can say what it is meant to build, so nothing here
may say "see the artifact" or "see the ticket" for a decision; it says what was
decided.

```json
{
  "runId": "2026-09-09-costs-batch",
  "createdAt": "2026-09-09T18:40:00Z",
  "source": ["B1091", "B1092", "B1057"],
  "dropped": [
    {
      "id": "B1057",
      "verdict": "already fixed",
      "reason": "lib/entries.ts:88 already filters status:draft on every reader; the bug this ticket describes cannot reproduce.",
      "evidence": "lib/entries.ts:88"
    }
  ],
  "blocked": [
    {
      "id": "B1058",
      "reason": "no app/api/webhooks/whatsapp route exists and no binding store exists; owner.tel is an unproven send-destination",
      "blockedBy": [
        { "id": "B1057", "title": "the webhook", "promotable": true },
        { "id": "B1064", "title": "the proven-number registry", "promotable": true }
      ]
    }
  ],
  "groups": [
    {
      "name": "group-a",
      "tickets": ["B1091", "B1092"],
      "sharedFiles": ["lib/costs.ts", "app/[user]/trips/[trip]/costs/page.tsx"]
    }
  ],
  "tickets": [
    {
      "id": "B1091",
      "title": "Budget is gated per journal, and nobody can address a photobook",
      "group": "group-a",
      "validity": {
        "verdict": "valid",
        "evidence": "lib/costs.ts:214 reads the flag from site config only, never content/<user>/config.json"
      },
      "before": {
        "captured": true,
        "kind": "screenshot",
        "widths": [1280, 390],
        "path": ".claude/runs/2026-09-09-costs-batch/B1091/costs-1280.png",
        "notes": "Budget panel visible on a journal that turned the capability off; live at https://fernscout.ch/test-alps/trips/alps/costs"
      },
      "options": [
        {
          "id": "A",
          "stance": "Per-journal flag narrows the site flag, same rule as every other capability in lib/capabilities.ts",
          "mockup": ".claude/runs/2026-09-09-costs-batch/B1091/option-a.html"
        },
        {
          "id": "B",
          "stance": "Drop the per-journal override entirely; budget is instance-wide only",
          "mockup": ".claude/runs/2026-09-09-costs-batch/B1091/option-b.html"
        }
      ],
      "chosen": {
        "optionId": "A",
        "mockupHtml": ".claude/runs/2026-09-09-costs-batch/B1091/option-a.html",
        "reason": "Consistent with every other capability; B chosen would be a new exception nothing else in the codebase has."
      },
      "questions": [
        {
          "question": "Should an owner see why budget is off, the way /api/health explains a disabled capability?",
          "default": "yes — one sentence, same pattern as every other capability",
          "answer": "yes — one sentence, same pattern as every other capability"
        }
      ]
    },
    {
      "id": "B1092",
      "title": "Nobody can address a photobook",
      "group": "group-a",
      "validity": {
        "verdict": "valid",
        "evidence": "lib/photobook/orders.ts has no address field on the order type"
      },
      "before": {
        "captured": false,
        "kind": "none",
        "notes": "Nothing to screenshot — the field does not exist yet. Reproduced instead: POST .../photobooks with an address field is silently dropped, confirmed against app/api/v1/[user]/photobooks/route.ts:41."
      },
      "options": [],
      "optionsNote": "Only one defensible shape — the address fields photobook.md already documents for a trip; nothing else in the schema suggests an alternative.",
      "chosen": null,
      "questions": []
    },
    {
      "id": "B103",
      "title": "Auth request rate-limit budget is untested against a real client",
      "type": "OPS",
      "group": null,
      "validity": {
        "verdict": "valid",
        "evidence": "app/api/auth/request/route.ts:22 shares one per-IP bucket with everything else touching POST /api/auth/request"
      },
      "shape": {
        "kind": "engagement",
        "target": "live",
        "concurrencySafe": false,
        "needs": [
          "a provisioned test journal",
          "the remaining POST /api/auth/request rate-limit allowance for this IP"
        ],
        "mustNot": [
          "run at the same time as any other ticket touching auth/request or auth/verify"
        ]
      },
      "chosen": null,
      "questions": []
    }
  ]
}
```

`chosen` is `null` for a ticket with no options (there was nothing to choose
between, or the ticket is an engagement with nothing to choose either) —
`run-a-batch` builds straight from the ticket's Work section in that case. A
ticket with options and no `chosen` is a brief that was never finished — do
not hand one of those to `run-a-batch`.

**`shape` is present only on a `type: OPS` ticket**, and is the block
`run-a-batch` reads instead of re-deriving concurrency and resources for
itself — both real planners in the first run of this pipeline (B103, B101)
returned exactly this without being asked twice, which is why it belongs in
the schema rather than in a second prompt. `target` is `"live"` or `"local"`:
`run-a-batch`'s rule is that an engagement may run alongside a build group
only when its target is a different instance from whatever the builds are
merging into. `needs` names the shared resource the orchestrator, not the
group subagent, must hand out — a provisioned test journal, an address whose
mail is readable, SSH read access, a rate-limit allowance — because the whole
point of a per-IP limit is that concurrent agents cannot each assume the
whole of it. `mustNot` is what the engagement must never do, stated as
plainly as `needs`.

An engagement can also come back with nothing left to build at all — B1147
is the recorded case: the fault it was chasing had stopped reproducing, and
the actual remaining step turned out to be a login to Gelato's own account
portal, which is nobody's code to write. Where a planner finds this, say so
under `validity` as `"superseded by <what was found>"` the same as any other
non-buildable ticket, and note in the reasoning that the remaining step is a
person's, and what it is — that sentence is what lets the person decide
whether to go do it themselves, rather than the ticket silently vanishing.

## Step 5 — hand it over

Give the artifact URL. Say the count: how many tickets, how many dropped, how
many blocked, how many groups. Do not build anything, do not move a task
file, and do not promote anything into `open/` — this skill ends at the
person's answer, and `run-a-batch` is what consumes `brief.json`.

## Red flags — stop

- Asking a question in a follow-up message instead of putting it on the
  artifact — there will be no follow-up once `run-a-batch` starts.
- Two options that differ only in a pixel value, a colour, or a wording
  choice with the same underlying mechanism — collapse to one option with a
  stated reason instead.
- Capturing a before-state with a fixture you wrote for the capture, rather
  than the actual running page or the actual reproduction.
- Leaving `chosen: null` on a ticket that has `options` — that is an
  unfinished brief, not a valid one.
- Computing the grouping again inside `run-a-batch` instead of reading it
  from the brief.
- Promoting a ticket into `open/`, or moving any task file — this skill never
  touches a task's lane.
- Listing a ticket in `tickets[]` whose own Work section names an unbuilt,
  unpromoted prerequisite — that is `blocked[]`, not a group of one.
- An `OPS` ticket with no `shape` block — `run-a-batch` has nothing to read
  and will refuse to schedule it.
