---
id: B184
title: The digest cannot be exercised end to end, because everything an agent may write is filtered out of it
type: CHORE
priority: medium
complexity: low
area: digest, test-content, qa
found: "2026-09-03"
started: "2026-09-04T06:22:44Z"
merged: "2026-09-04T06:50:22Z"
---

# B184 — Two correct rules make the digest untestable

## Why

Found while verifying B52 against the live instance, which is BLOCKED on this
and not on anything B52 built.

Two rules, both right on their own:

- **`AGENTS.md`**: anything an agent invents carries `test: true`. It is the
  one exception that lets an agent write content nobody lived, and it is not
  optional.
- **B70**: the digest refuses test content, at *both* levels it could enter.
  `lib/digest/visibility.ts:80` drops any trip with `test: true` before asking
  a single visibility question, and `lib/digest/content.ts:166` drops any
  *entry* with `test: true`, so a flagged day inside an unflagged trip yields
  nothing either.

Together: **no content an agent is permitted to write can ever produce a digest
line.** The digest is the one mechanism in the product that cannot be exercised
by the only party allowed to write to it.

Observed rather than inferred. With a fully eligible reader in place — active,
consenting, holding a `read` grant — on the VPS:

```
$ sudo -u fernscout npm run digest -- --user xydhd-qa1 --dry-run --force --since 2020-01-01
0 digest(s) would go to 0 readers
Not written to (8):
  xydhd-b52reader@severin.io  nothing-new — since 2020-01-01
  …
```

`nothing-new`, with the watermark pushed back to 2020, on a journal holding
`b46-onecity` — a **public, listed** trip with four **published** days. The
flag empties the digest before visibility is ever consulted.

Working around it is not available and should not be. The only fixture that
would produce a line is a guest trip with no `test:` flag holding a published
day with no `test:` flag — unmarked fabricated content, written specifically so
it will enter somebody's mail. That is exactly the harm B70 exists to prevent,
so an agent must not build it, and a campaign that quietly did would be
undermining the rule it is meant to be verifying.

The cost is not hypothetical: B52's three behavioural bullets, and any future
digest work, can only ever be verified in unit tests. The digest is a thing
that sends real mail to real people, which is precisely the category where a
live check is worth most.


## Confirmed again by B70, plus two things B70 added (2026-09-03)

B70 hit the same wall from the opposite direction and is BLOCKED on it too, so
this task now unblocks two tickets rather than one. Its agent was offered the
publish authorisation and **declined to use it**, correctly: the only fixture
that would close B70's day-level bullet is a trip *without* `test: true`
holding a published test day, and creating an unflagged trip is precisely what
`AGENTS.md` forbids — "writing 'this is a test' into the prose instead is a
convention, not a guarantee". An `--include-test` dry-run flag makes that
fixture unnecessary, which is the strongest argument for building it.

**A skip reason for suppressed test content.** `DigestSkipReason` has five
values and none of them is about test content, so a reader excluded *solely*
because every trip in the journal is fiction is reported identically to a
reader in a genuinely quiet journal: `nothing-new — since <date>`. An operator
dry-running the pipeline against a test trip — the only thing they can safely
dry-run against — gets no signal that anything was deliberately suppressed.
Add a reason, or say it in the line. Cheap, and it is what turns a silent zero
into a legible one.

**No positive control exists on this instance.** Nothing in either
contacts-enabled journal is non-test, so nobody has yet demonstrated that the
digest emits a mail *at all* against fernscout.ch — only that it emits none.
The pipeline is provably alive up to content building (it distinguished
`no-consent`, `not-approved` and `nothing-new` correctly across eight
contacts), so the deductive gap is narrow, but "0 digests" is not by itself
proof that the test filter is the cause rather than something upstream. The
same flag closes this gap too.

## Work

Give the digest a way to be driven over test content **without ever mailing
it**. The obvious shape:

- A flag — `--include-test` — that is **refused unless `--dry-run` is also
  set**. Not a config value, not an environment variable: an argument that
  cannot be present on a real send by construction. If the two can ever be
  separated, this becomes a way to mail fiction to somebody's family, so the
  refusal has to be structural rather than documented.
- The dry-run output should say plainly that test content was included, in
  every line it produces, so nobody mistakes a drill for a real run.

Alternatives considered and worth weighing: a fixture journal on the instance
that is exempt (rejected — an exemption that lives in config will eventually be
set on a real journal), or accepting that the digest is unit-tested only
(defensible, but it leaves the one mail-sending path unverified against the
deployment, which is where B64 and B142 both turned out to be hiding).

Also worth recording, found in passing: **every contact on `xydhd-qa1` has
`wantsEmailDigest: false`** by default, so a journal cannot deliver a digest to
anybody until somebody consents. Correct, and it means any digest test must
create its own consenting reader — worth a line in whatever runbook covers
this.

## Acceptance

- The digest can be run against test-flagged content and produce lines, in
  dry-run only.
- Attempting it without `--dry-run` is refused, and a test asserts that.
- The dry-run output states that test content was included.
- B52's guest-trip bullet becomes checkable against a running instance.

## Built (2026-09-04)

The flag, exactly as the Work section describes it, plus the skip reason.

- `DigestOptions.includeTest` reaches `digestableTrips` and
  `buildDigestContent`, so both levels the filter works at can be widened
  together. `runDigest` throws when it is set without `dryRun`, **before** it
  loads the user or plans anything — and it is an argument, not a config value
  or an environment variable, so there is no state anywhere that can arrive
  holding it. `test/digest.test.ts` asserts the refusal, and that no `.eml` and
  no `digest_sends` row exists afterwards.
- `DigestPlan.includedTest` is what lets the CLI mark **every** line, not just a
  header: `[TEST CONTENT INCLUDED]` on each reader and each skip, plus a block
  after the count. A header scrolls away; a line copied into a ticket does not
  carry one.
- `DigestSkipReason` gains **`all-test`**, reported only on a run that did not
  ask for test content and only for a reader who was getting nothing anyway —
  the content is built a second time, with the flag, and if that yields
  something the suppression was the cause. The existing B70 test that asserted
  `nothing-new` for exactly this case now asserts `all-test`, which is the
  distinction this task asked for.
- `test/cli.test.ts` runs the script itself: `--include-test` without
  `--dry-run` exits non-zero with the refusal and writes no mailbox, and the
  paired form gets past that guard. The guarantee lives in `runDigest`, but the
  flag reaching it from a command line is the operator-facing half.
- `docs/TESTING.md` gains H11–H13: the drill, the refusal, and the legible zero.

The alternatives in the Work section were both declined for the reasons written
there. Nothing was built that lets test content reach a real send, and no
unflagged fabricated trip was created to work around the filter.

B52's guest-trip bullet and B70's day-level bullet are now checkable against a
running instance with `--dry-run --include-test`.
