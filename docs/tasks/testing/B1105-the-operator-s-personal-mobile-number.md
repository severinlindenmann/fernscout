---
id: B1105
title: The operator's personal mobile number is the example in the source, the public API spec and the agent guide
type: SECURITY
priority: high
complexity: low
area: privacy, docs, depersonalisation
found: "2026-09-09T16:37:18Z"
started: "2026-09-09T16:42:03Z"
merged: "2026-09-09T16:51:04Z"
---

# B1105 — The operator's personal mobile number is the example in the source, the public API spec and the agent guide

## Why

**The operator's own mobile telephone was the example.** It is the
example used everywhere a telephone number needs explaining — fourteen
occurrences across nine files in `lib/`, `app/`, `components/` and `test/`:

```
lib/whatsapp/phone.ts:6,7,13,48     lib/journals.ts:854,1036,1037
lib/config.ts:608,609               lib/api/openapi.ts:3918-3920
lib/api/documentation.ts:1280       app/api/contacts/request/route.ts:101
components/ContactsAdmin.tsx:605    components/TelField.tsx:10,83
test/tel-field-combobox.test.tsx:90,94,130
```

Two of those are generators, so it is not only in the repository — **it is
served, live, to anybody**, verified on 2026-09-09:

```
$ curl -s https://fernscout.ch/agent.md      | grep -c "<the number>"   → 1
$ curl -s https://fernscout.ch/openapi.json  | grep -c "<the number>"   → 3
```

And `site/config.json` gives the repository as
`https://github.com/severinlindenmann/fernscout`, so it is also published
there, in the history, for as long as the history exists.

Nobody chose this. It is what happens when the person writing the comment
needs a realistic number and uses the one they know by heart — which is
exactly why `test/depersonalised.test.ts` exists.

**And that test has a hole precisely this shape.** `personalTerms()` builds
its forbidden list by reading *names* out of config: `site.credit.name`, and
each journal's `owner.name` and `owner.nickname`, splitting them into words.
It never reads `owner.tel`, and a telephone number is not a word. So the guard
that exists to stop a real person's details reaching `lib/` has been passing
this the whole time.

The harm is small and real: an unlisted personal mobile, attached to a named
individual, in a public repository and on a public URL, indexed by whatever
reads either. It is not a credential and nothing is compromised. It is a
person's telephone number in a place they did not put it deliberately.

## Work

- **Replace every occurrence with a number that cannot belong to anybody.**
  It has to stay *well-formed*, because most of these examples exist to show
  the difference between `+41 …`, `0041 …` and a refused national `076 …` —
  a nonsense number would stop the documentation working.

  Check whether **BAKOM reserves a range for documentation or drama**, as
  several regulators do, and use it. If none exists, pick a number in an
  unallocated range and say in one comment why that one, so the next person
  does not "improve" it back to a plausible one.

- **Close the hole in `test/depersonalised.test.ts`.** Two parts:
  - Add `owner.tel` (and `site.credit` telephone, if it ever gains one) to
    `personalTerms()`, normalised — a number appears in four spellings
    (`+41 …`, `0041 …`, the national `0…` and bare E.164 digits), and a term
    list that only matches one of them catches nothing.
  - Consider failing on **any** telephone-shaped literal in `CODE_DIRS` that
    is not the agreed documentation number. That is the version that catches
    the next one, rather than this one.

- **The git history keeps it**, and rewriting history on a published
  repository is a bigger decision than this ticket. Say so and leave it to a
  person: the number stays in old commits either way, and the live
  `/openapi.json` and `/agent.md` are the copies that actually matter.

Not doing: changing `owner.tel`'s meaning, or anything about B1064's proven
number. This is only about the example.

## Acceptance

`grep` for the operator's number in `lib app components scripts test` returns
nothing; `curl https://fernscout.ch/openapi.json` and `.../agent.md` return
nothing; and `test/depersonalised.test.ts` fails if somebody puts it back.
