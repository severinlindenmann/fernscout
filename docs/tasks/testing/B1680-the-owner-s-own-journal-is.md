---
id: B1680
title: The owner's own journal is unreadable on the live instance: its trips are still trip.md
type: ISSUE
priority: high
complexity: medium
area: content
found: "2026-09-13T14:29:58Z"
merged: "2026-09-14T06:09:06Z"
---

# B1680 — The owner's own journal is unreadable on the live instance: its trips are still trip.md

## Why

Every trip in the owner's own journal answers 404 on the deployed instance:

```
$ for t in algarve-2026 elsass-2025 thailand-2025 ungarn-2026; do
    curl -s -o /dev/null -w '%{http_code}\n' "https://fernscout.ch/severin/trips/$t"; done
404
404
404
404
```

`/severin/trips` still answers 200, so the index renders and every card behind
it is a dead link.

The cause is the format flip, not a bug in a route. `lib/trips.ts` reads
`trip.json` and has no `trip.md` fallback (B1598). On the box:

```
$ ssh … 'for d in /var/lib/fernscout/content/*/; do …; done'
example        trip.md=0 trip.json=8
severin        trip.md=4 trip.json=0
test-elena     trip.md=1 trip.json=0
test-jonas     trip.md=1 trip.json=0
test-margrit   trip.md=1 trip.json=0
test-mobile    trip.md=1 trip.json=0
```

Decision M2 says the owner migrates their own journal later, personally — so
this state was *foreseen*. What was not decided is that the journal would sit
live and broken in the meantime. A reader following a link gets a 404 with no
explanation, and the owner's own content is the only real content on the
instance.

`scripts/example-to-v2.mts` converted `content/example`. Nothing has converted
anybody else's, and that script is written against the demo journal.

## Work

A person decides which of these, and it is their journal:

1. Convert the four trips, through the real serializers, the way
   `content/example` was converted. This is the outcome M2 describes.
2. Take the journal out of the listing until it is converted, so a reader
   meets an honest absence rather than a 404.

Whichever is chosen, the same question applies to `test-elena`, `test-jonas`,
`test-margrit` and `test-mobile` — throwaway journals from earlier sessions
that are in the same state. Those are `test-` named and deletable; **do not
delete `content/severin`.**

Not doing: a `trip.md` fallback in the reader. The migration deliberately has
one format, and adding a fallback would reopen the split brain B1598 closed.

## Acceptance

- `curl -s -o /dev/null -w '%{http_code}' https://fernscout.ch/severin/trips/<trip>`
  answers 200 for every trip the index lists, or the index lists none.
- No `.md` file remains under any journal's `trips/` on the box.
