---
id: B1223
title: Three failed photobooks for one journal share one attention-band id, so acknowledging one silently hides the other two and React sees duplicate keys
type: ISSUE
priority: high
complexity: low
area: lib/adminConsole.ts
found: "2026-09-10T04:51:05Z"
started: "2026-09-11T04:23:06Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:06Z"
---

# B1223 — Three failed photobooks for one journal share one attention-band id, so acknowledging one silently hides the other two and React sees duplicate keys

## Why

Found by opening `/admin` on the live instance, which is the only place this
shows: the band there holds seven entries and six of them are print failures.

`attention()` builds a trouble's id from the owner and the phrase
(`lib/adminConsole.ts`):

```ts
id: `trouble:${trouble.owner ?? "-"}:${trouble.what}`
```

`troubles()` returns one row per failed order, and `what` is a fixed phrase —
"A photobook never printed". So the three failed photobooks for `example` are
three entries carrying **one id**. Live, right now:

```
Fault  A photobook never printed  example · dry-run refused it · order fin2123-largesquare-hard
Fault  A photobook never printed  example · dry-run refused it · order fin2123-portrait-hard
Fault  A photobook never printed  example · dry-run refused it · order fin2123-square-hard
```

Two faults follow, and the first is the serious one:

**Acknowledging one hides all three.** `applyAcks` matches on the id, so
pressing Acknowledge on the first row silences two other failed orders the
operator never looked at. That is precisely the muzzle B1203 was written to
avoid, arriving through the id rather than through the level.

**Duplicate React keys.** `NeedsYou` keys its `<li>` on `item.id`, so three
siblings share a key.

Neither is visible on a healthy instance, which is why the tests missed it:
`test/admin-attention.test.ts` builds one trouble at a time.

## Work

`Trouble` gains a `ref` — the row id `troubles()` already selects and already
prints into `detail` — and `attention` uses `trouble:<ref>`. The same shape as
`Wrong.id` and for the same reason: the producer names what it produced, and a
consumer composing an id out of prose is a consumer that will collide.

Consider while there: several failures of the same kind for the same journal
may be worth folding into one entry with a count ("3 photobooks never
printed"). That is a different decision from this one — a person should make
it — so this ticket only makes the ids distinct.

Not doing: anything about the failures themselves. `dry-run refused it` on the
live instance is the print provider being off by choice, which is a separate
question and probably a capture of its own.

## Acceptance

- Two troubles with the same `what` and the same owner produce two different
  ids, and a test in `test/admin-attention.test.ts` says so.
- Acknowledging one of them leaves the others in the band.
- On the live `/admin`, the six print failures acknowledge one at a time.
