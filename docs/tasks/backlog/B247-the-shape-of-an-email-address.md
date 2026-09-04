---
id: B247
title: The shape of an email address is checked by three different regexes
type: ISSUE
priority: low
complexity: low
area: validation
found: "2026-09-04T09:05:06Z"
---

# B247 — The shape of an email address is checked by three different regexes

## Why

Found while making `createTrip` refuse a `people:` entry the reader would
drop (B207). To do that honestly the writer has to use the *reader's* idea of
an address, which meant exporting one from `lib/trips.ts` — and there are three
of them:

| | |
| --- | --- |
| `lib/trips.ts:129` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — a trip's `people:` |
| `lib/config.ts:280` | `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` — a journal's `owner.email` |
| `lib/auth/index.ts:225` | `isEmail()` — who may ask for a token |

The first two differ: `{2,}` on the last segment. So `a@b.c` is a usable
`people:` entry and not a usable owner address, and nothing says which is
intended. The cost is not theoretical — `people:` decides who may obtain a
trip-scoped token, and `isEmail` decides whether that request is even accepted,
so an address one accepts and another does not is a person who is on a trip and
cannot get in.

B204 is the same shape one layer down: two private copies of a quoting helper,
both wrong in the same way, and the fix was one exported function.

## Work

- Pick one predicate and one home for it — `lib/auth`'s `isEmail` is the
  strongest candidate, because it is the one that gates the thing everything
  else depends on.
- Replace the other two with it, keeping the *looseness* deliberate: the
  address has to survive a mail server, not RFC 5322, and anything stricter
  rejects real addresses.
- A test naming the addresses that must be accepted and the ones that must not,
  so the next person to tighten it has to say what they are excluding.

Not doing: changing what is accepted. This is one predicate where there are
three, not a new policy — if unifying them changes the answer for any address,
that is worth saying out loud in the ticket rather than shipping quietly.

## Acceptance

- `grep -rn "@\[^\\\\s@\]" lib/` finds one definition.
- A trip's `people:` and `/api/auth/request` agree about every address in the
  test table above, including `a@b.c`.
