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

## Decided — 2026-09-09

Answered by the owner, and the answer is smaller than the ticket assumed.

**The population is one.** Most journals on the instance are tests and will be
deleted; `severin` is the only real one, and the owner will add a number to it
himself. So there is no migration and no grandfathering question — the three
endings this ticket was written to choose between do not apply.

What is left:

- Delete the test journals first, so the rule lands on a clean instance.
- Add the owner's own proven number to `severin`.
- **Then require a proven number from day one**, for every journal created
  afterwards. No grandfather clause, no "asked but not required" state, and
  therefore none of the three-doors prompting this ticket described.
- Keep the one property that was never optional: the files are on disk and an
  export must keep working regardless of any of this. Assert it.

This ticket is now small enough that it may be a paragraph inside B1064 rather
than a ticket of its own. Whoever takes B1064 should decide that.

## Decided further — 2026-09-09

- The exemptions are the operator's own address and test journals — see B1064
  and B1065. Everybody else proves a number from day one, which is only
  workable because the existing population is one journal the owner controls.
