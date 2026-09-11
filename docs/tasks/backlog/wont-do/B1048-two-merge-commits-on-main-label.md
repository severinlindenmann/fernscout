---
id: B1048
title: Two merge commits on main label themselves B1026 and B1027, which are different tickets
wontDo: "The owner's call: not worth carrying. Two -- in fact four -- merge commits cite the wrong ticket id, and nobody has been misled by them."
type: CHORE
priority: low
complexity: low
area: tasks,git
found: "2026-09-09T07:04:25Z"
---

# B1048 — Two merge commits on main label themselves B1026 and B1027, which are different tickets

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`ad1018a5 Merge B1027: postcards and photobooks in the helper` and
`af076699 Merge B1026: the journal's own settings, keys and past conversations`
are on `main`. Neither id belongs to that work:

- B1026 is *A malformed auth/request body answers the same 202 as an
  unrecognised address*.
- B1027 is *The send button is offered on a day whose journal has no readers
  to send it to*.

The merged commits underneath (`c616728d`, `e77f5455`) do **not** claim either
id in their own bodies — only the merge messages do — so this is a labelling
slip at merge time rather than two sessions having been handed the same number
by `nextId()`. It was almost certainly branch names in a session's own local
numbering being written into the merge message unchecked.

It matters because the id is the only way tasks refer to each other, and
`git log --oneline --grep B1026` is how the next agent finds the change behind
a ticket. Today that search returns somebody else's helper work, and when the
real B1026 and B1027 merge, it returns both — with no way to tell from the
subject line which is which.

Found while merging B1031 into `main` and reading the log to see what had
landed underneath.

## Work

History on `main` is shared and already pushed, so **do not rewrite it** — the
cure is worse than the disease and this is a person's call regardless.

The cheap remedy is a `git notes` entry on each of the two merge commits saying
which work it actually is, since notes attach to a commit without changing it
and show up in `git log`. Decide whether this repository wants to start using
notes at all; if not, close this as wont-do with that reasoning, because the
alternative — a line in a document nobody greps — buys nothing.

Worth checking at the same time whether the same session mislabelled anything
else: `git log --oneline main | grep -E "Merge B[0-9]+" ` against the task
titles will show any other subject line that does not match its id.

## Acceptance

- Either both merge commits carry a note naming the work they really are, or
  the ticket is closed `wontDo` with the reason written down.
- A check has been run for other mislabelled merge subjects on `main`, and
  whatever it found is recorded here.

## Closed, 2026-09-11 — not worth carrying

Validation found it is **four** merge commits, not the two the title claims:
`ad1018a5` and `af076699` mislabel themselves B1027 and B1026, alongside the two
genuine ones.

It is real and it has misled nobody. Its own body left "is this worth doing at
all" to a person, and the answer is no. The repair would have been two `git
notes` against commits nobody reads, plus a notes convention this repository
does not otherwise have.

Recorded rather than deleted, because an id is forever here and a closed ticket
is how the next person finds out this was considered.
