---
id: B718
title: A metered write can be charged twice after a restart
type: SECURITY
priority: high
complexity: low
area: credits, api
found: "2026-09-07T11:44:09Z"
started: "2026-09-08T05:20:12Z"
session: 41335894-5435-4167-8cb6-898e370cd6a9
claimed: "2026-09-08T05:20:12Z"
---

# B718 — A metered write can be charged twice after a restart

## Why

`lib/idempotency.ts:23` keeps its store **in memory, per process**. That was an
honest trade for `/api/v1` writes, where the filesystem is the real backstop: a
replayed day write finds the day already there.

`POST /api/helper/<user>/day/write-day` (B684) breaks that assumption, because
it is the first route where the idempotency key guards **money**. It spends a
credit, calls the model, and writes nothing to disk — so there is no filesystem
backstop at all. After a server restart, or on a second Node process behind a
load balancer, a retried request is a fresh key and the journal is charged a
second credit for the same words.

The instance already has a database, and the ledger this protects is in it.

Found while building B684 and reported rather than fixed.

## Work

Give the idempotency store a durable backend when a database is configured,
keeping the in-memory one for instances without. Key rows by owner and key,
with the answer and an expiry.

Check every current caller: a route that relies on the current
per-process semantics for something other than money should keep working
unchanged.

## Acceptance

A credited write replayed after a process restart returns the first answer and
charges nothing. A test covers it with the store's durable backend.
