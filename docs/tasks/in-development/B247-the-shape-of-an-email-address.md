---
id: B247
title: The shape of an email address is checked by three different regexes
type: ISSUE
priority: low
complexity: low
area: validation
found: "2026-09-04T09:05:06Z"
started: "2026-09-07T10:37:40Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T10:37:40Z"
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

## Triage

Confirmed as described: three definitions, `lib/trips.ts`'s missing the
`{2,}` on the last segment.

`isEmail` (`lib/auth/index.ts:317`) is now the only definition. `lib/trips.ts`
re-exports it as `isPersonEmail` and `lib/config.ts`'s `owner.email` check
calls it directly; both former private regexes are deleted.
`lib/tripWrite.ts`'s two `people:`/`for:` validators, which imported
`PERSON_EMAIL_RE` from `lib/trips.ts`, now call `isPersonEmail` instead.

**What changes for `a@b.c`, said out loud as the Work section asked.** Picking
`isEmail` as canonical *tightens* `lib/trips.ts`'s old regex rather than
loosening the other two — `a@b.c` (a one-character TLD) was accepted by the
old `people:` check and is not accepted by `isEmail`, so it is now refused
there too. Re-reading the ticket's own acceptance line: "agree about every
address … including `a@b.c`" turns out to mean *agree on the same answer*
for it, not necessarily *accept* it, and refusing it consistently satisfies
that. No real address loses anything: every current TLD is two characters or
longer, so nothing that survives a mail server is excluded.

`grep -rn "@\[^\\\\s@\]" lib/` — the literal ticket command doesn't match
(shell-escaping the ticket's own regex-in-a-regex is awkward), but
`grep -rln 'PERSON_EMAIL_RE\|EMAIL_RE = /' lib/` returns nothing and
`grep -c '\[\^\\\\s@\]' lib/auth/index.ts` finds exactly one definition, in
`isEmail`.

**Test:** `test/email-shape.test.ts` (new file) — a shared table exercising
`isEmail` and the re-exported `isPersonEmail` directly, plus one integration
test writing a trip's `people:` block and a journal's `owner.email` with
`a@b.c` and asserting both now drop it the same way. Confirmed the whole
suite (4227 tests, all files) still passes after unifying, so nothing else
depended on the old looser `people:` check.

**Acceptance:** met, with the note above about what "agree" turned out to
mean. `npm run verify` passes in full.
