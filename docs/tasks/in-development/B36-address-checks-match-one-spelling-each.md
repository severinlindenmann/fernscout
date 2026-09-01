---
id: B36
title: Address checks match one spelling each, and the URL parser writes another
type: SECURITY
priority: medium
complexity: low
area: fetchMedia, security
found: "2026-09-01"
started: "2026-09-01"
---

# B36 — Address checks match one spelling each, and the URL parser writes another

## Why

B31 fixed one instance of this and it is worth asking whether there are more.

`isPublicAddress` in `lib/api/fetchMedia.ts` refuses private ranges by matching
strings. The IPv4-mapped IPv6 check matched `::ffff:127.0.0.1` — the spelling a
person writes — while `new URL()` normalises that host to `::ffff:7f00:1`. So
the address the check actually received never matched the pattern written to
catch it, and `169.254.169.254` reached the function as `::ffff:a9fe:a9fe` and
was declared public. The cloud metadata endpoint, past the check whose comment
names it.

It was masked by a second bug rather than by anything deliberate: `hostname`
keeps its brackets for a v6 literal, `net.isIP("[…]")` is `0`, so every IPv6
literal fell through to a DNS lookup that threw and refused the URL. Fixing the
brackets in B31 removed the accident, which is how it surfaced — and is why
B31 had to fix the mapped form in the same change rather than defer it.

Both are fixed. What is not answered is whether the same class of gap exists
elsewhere in that function, because every branch below the mapped check is also
a string match against one chosen spelling:

- `lower === "::"` and `lower === "::1"` — exact equality. `0:0:0:0:0:0:0:1` is
  the same address, and `net.isIP` accepts it. Does anything normalise it
  first?
- `startsWith("fc")` / `startsWith("fd")` — unique-local is `fc00::/7`, which
  is `fc` and `fd` and nothing else, so this one looks right. Worth confirming
  rather than assuming.
- `startsWith("fe80")` — link-local is `fe80::/10`, which spans `fe80`–`febf`.
  `fe90::1` is link-local and starts with `fe9`.
- NAT64 (`64:ff9b::/96`) embeds an IPv4 address the same way `::ffff:` does,
  and is not checked at all.

Related to B03, which is about the same function re-resolving a hostname after
checking it. Both are "the check is right and what reaches it is not".

## What was found, and the decision

**Every suspicion in this file was correct, and there was one more.** Probed
against the old implementation before changing anything:

```
REACHABLE 0:0:0:0:0:0:0:1                    loopback, written out
REACHABLE 0000:0000:...:0001                 loopback, fully padded
REACHABLE fe90::1                            link-local (fe80::/10 is fe80-febf)
REACHABLE feb0::1                            link-local, top of range
REACHABLE 64:ff9b::7f00:1                    NAT64 carrying loopback
REACHABLE 64:ff9b::a9fe:a9fe                 NAT64 carrying the metadata endpoint
```

`fc00::/7` was the one this file guessed might be fine, and it was. Everything
else leaked. The extra find is `fec0::/10`, site-local — deprecated, not
routable, and not checked.

**Decision: parse to bytes.** The alternative was another round of spelling
patches, and this file had already produced two of those (B31). A string is a
spelling, not an address; reduced to sixteen bytes there is nothing left to
spell differently, and the ranges can be compared as the RFCs write them.

Two consequences worth recording:

- **IPv4 is stored as `::ffff:a.b.c.d`**, so one set of range checks covers
  both families and an address cannot be private in one form and public in
  another. That was the actual shape of the B31 bug.
- **NAT64 is judged on what it embeds**, like the mapped form, rather than
  refused outright. `64:ff9b::808:808` is a legitimate route to 8.8.8.8 and
  there is no reason to block it; `64:ff9b::a9fe:a9fe` is the metadata endpoint
  and is refused for the same reason `::ffff:a9fe:a9fe` is. That is the NAT64
  decision this file asked for.

The tests gained the alternate spellings, an "every spelling agrees" property
that states the rule once instead of enumerating it, and boundary pairs either
side of each widened range — `fe7f::` public / `fe80::` not, `fbff::` public /
`fc00::` not. Those last are where a `/9` written for a `/10` would show up and
nowhere else. Fourteen of them fail against the old code.

## Work

- Decide the approach first: keep matching strings, or parse the address into
  bytes once and range-check it. The second is more code and removes the whole
  class — every spelling of one address becomes the same sixteen bytes. Given
  this file has now produced two spelling bugs, it is probably the answer.
- Whichever: `fe80` must become the `fe80::/10` range, `::1` must survive being
  written out in full, and NAT64 needs a decision (refuse, or extract and
  check the embedded v4).
- The existing table-driven tests in `test/fetch-media.test.ts` are the right
  shape for this; add the alternate spellings beside the ones already there.

Not doing: anything about DNS rebinding. That is B03 and has its own fix.

## Acceptance

- A test asserts every private address in the existing table is still refused
  when written in each of its valid spellings — at minimum `::1` as
  `0:0:0:0:0:0:0:1`, and a `fe90::` link-local address.
- A decision on NAT64 is recorded in this file, and implemented if it is
  "refuse".
- No public address in the existing allow-list becomes refused.
