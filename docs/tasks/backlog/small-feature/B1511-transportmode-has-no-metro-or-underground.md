---
id: B1511
title: transportMode has no metro or underground, so a city day is recorded as a train
type: FEATURE
priority: medium
complexity: low
area: api, content
found: "2026-09-11T19:45:00Z"
---

# B1511 — transportMode has no metro or underground, so a city day is recorded as a train

## Why

Raised by an owner writing up three weeks in Thailand: *"teilweise taxi,
teilweise Flugzeug, teilweise Metro"*. The enum is

```
flight · train · bus · motorbike · bicycle · boat · car · taxi · walk
```

`taxi` is there, `flight` is there, and the third one is not. The Bangkok days
moved by BTS Skytrain and MRT, and the honest options were both wrong: `train`
draws an intercity leg for four stops of underground, and leaving the field
empty says the day did not move when it did.

This is not a Bangkok problem. It is every city a journal is likely to cover —
London, Paris, Tokyo, Lisbon, Vienna, New York — and a metro ride is one of the
most common ways a travel day actually moves.

The list already distinguishes `bus` from `train` and `taxi` from `car`, so the
granularity it is aiming for is clearly "how it felt to travel", not "rail vs
road". Metro belongs at that level.

## Work

Add a value. `metro` is the more international word and reads correctly in a
journal in any of the three locales; `subway` and `underground` are each local
to one country.

- The enum in the day schema, and `/openapi.json` with it.
- Whatever draws the leg on the map and in the story pager needs a line style
  and an icon for it. A metro leg is short and urban, so the flight/train arc
  is probably wrong for it — worth looking at how `walk` is drawn.
- `transportMode` is refused rather than dropped when unknown, so nothing
  breaks for existing journals; they simply gain a value.

Worth deciding at the same time, once, rather than one ticket at a time: is
`tram` also missing, and `ferry` distinct from `boat`? Adding one value is the
same amount of work as adding three, and the next owner writing up Lisbon will
ask for the tram.

## Acceptance

- `transportMode: metro` is accepted on a day and rendered.
- An unknown mode is still refused by name rather than silently dropped.
- `/openapi.json` lists the new value, so `validate-content` in
  `fernscout-helper` picks it up without a change there — it reads the enum
  from the instance.
