---
id: B672
title: Everything is served off one VPS disk by one Node process
type: FEATURE
priority: medium
complexity: high
area: media, storage, database, deploy
found: "2026-09-07T08:56:04Z"
---

# B672 — Everything is served off one VPS disk by one Node process

## Why

One machine holds all of it: the journals under `content/`, the derivatives in
`trips/<trip>/media/`, the Postgres the instance runs on, and the Node process
that serves every request. Each photograph is read off that disk and streamed
by the app — `app/[user]/media/[...path]/route.ts` — because the file may be
private, and a gate that reads `visibility` is the whole reason the route
exists rather than a static mount.

That is the right shape for one traveller and it is the shape that ends. The
costs, in the order they will bite:

- **Disk.** `perUserBytes` is 5 GB by default (`lib/storageQuota.ts`), and the
  VPS has one disk under all of it. Ten journals of video is a resize, and a
  resize is downtime.
- **Bandwidth and latency.** Every image byte goes through Node and out of one
  European host. A public trip that gets linked anywhere is served photograph
  by photograph from a single process; a reader in Sydney pays the round trip
  for each one. The `public, max-age=3600` on a published photograph is the
  only thing between the site and that, and an hour is short.
- **The database.** SQLite locally, Postgres in production, and nothing
  outside `lib/db/` knows which — so the swap is already paid for. What is not
  paid for is a Postgres tuned, backed up and monitored as a database rather
  than as a container that happens to be up.

Nothing here is on fire. It is captured now so that the first day it matters is
not the day it is discovered.

Off-site backup is not this ticket — B659 has it, and its answer (a cheap
S3-compatible bucket) is deliberately the same technology as this one's.

## Work

Almost certainly more than one ticket. What this file is for is deciding the
order, and the order is probably:

1. **Measure first.** What is actually slow, and for whom. `npm run
   measure-payload` and a real page load from far away, before anything is
   moved. A CDN in front of a site that is fast is complexity for nothing.
2. **Object storage for derivatives**, behind the same gate. The route stays —
   it is what reads `visibility` — but a *published* photograph can redirect
   to a signed or public bucket URL instead of streaming bytes, while a draft
   or a labelled one keeps `private, no-store` and is served as it is today.
   That split is already in the code and is what makes this tractable.
3. **A CDN or cache in front**, once `Cache-Control` and `Vary` can be trusted
   for every path. They were written with this in mind; the header work is
   already done and needs auditing, not redesigning.
4. **Postgres as an operated database** — connection limits, a real backup
   verified by restore, and whatever `/api/health` should say when it is
   unhappy.

Explicitly not doing: multi-region, autoscaling, a queue, or anything that
assumes more than one app process before there is a reason for a second one.
A self-hosted instance must keep working with none of this switched on —
object storage is a capability that is absent by default, like every other.

## Acceptance

Cannot be met in one commit. The first deliverable is a measurement written
into this file: where the time and the bytes go on a real public trip, from
somewhere far away, with numbers. Each subsequent step is its own task opened
from here and each is switchable off, with a laptop checkout still working.
