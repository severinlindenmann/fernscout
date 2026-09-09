---
id: B1066
title: Every journal that exists was created without a number, and nothing decides what happens to them
type: FEATURE
priority: medium
complexity: medium
area: auth, migration, journals
found: "2026-09-09T07:11:56Z"
---

# B1066 — Every journal that exists was created without a number, and nothing decides what happens to them

## Why

Every journal on this instance was created before a number was asked for, so
every one of them has an unproven owner by the new rule. `Owner.tel` is
optional and, where it is set at all, it means *"send my own copy of a
published day here"* (B614) and was never verified.

A requirement that arrives without an answer for the journals that already
exist has three possible endings, and choosing by default is how a person who
has written forty days finds themselves locked out of them:

- **Grandfathered.** The rule applies to new journals. Simple, honest, and
  leaves the anti-abuse argument half-built.
- **Asked, not required.** A note on `/<user>/me` and in the helper's opening,
  and nothing stops working. Costs nothing and probably reaches most people.
- **Required to write.** Reading and publishing keep working; the next write
  asks first. This is the only version that actually closes the hole, and it
  is also the one that can strand somebody mid-trip on a bad connection.

There is a fourth consideration that is not a choice: **whatever is decided
must not be able to lock the owner out of their own content.** The files are
on disk and an export must keep working regardless, which is the property that
makes even the strictest option survivable.

## Work

- A person picks one of the three. Write which, and why, into this file before
  any code.
- Whatever is picked, the journal's own export and `/<user>/documentation.txt`
  are unaffected — assert it.
- If a number is ever required, the prompt has to appear in all three doors:
  `/<user>/me`, the helper's opening (`lib/helper/opening.ts`), and the API's
  `GET /api/v1/<user>/status`, which is the call an agent makes to find out
  where it stands. A requirement that only a browser mentions is one an agent
  discovers as an unexplained refusal.
- Decide what the operator address (`FERNSCOUT_ADMIN_EMAIL`) does here. It is
  one address in the environment and owns no journal; it must not need a
  number.

## Acceptance

The decision is written in this file, and a journal created before the rule
behaves exactly as the decision says — proved by a test with a
`config.json` that has no `tel` at all.
