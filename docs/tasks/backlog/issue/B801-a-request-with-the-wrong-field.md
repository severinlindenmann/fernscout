---
id: B801
title: A request with the wrong field name is accepted and silently does nothing
type: ISSUE
priority: medium
complexity: low
area: contacts, api
found: "2026-09-07T14:58:58Z"
---

# B801 — A request with the wrong field name is accepted and silently does nothing

## Why

`POST /api/contacts/request` takes the invite token in a field named `invite`.
Sending it as `token` — the obvious guess, and what a careless integrator
writes — returns `202 {"status":"accepted"}` and does nothing at all.

The uniform `202` is deliberate and correct: the endpoint must answer the same
way whether or not a token is real, or it becomes an oracle for guessing them.
That reasoning covers a *wrong* token. It does not cover a *malformed request*,
where no token was supplied at all — refusing that leaks nothing, because the
caller has told you they sent no token.

As it stands the caller is told their request succeeded when nothing happened,
which is the failure mode AGENTS.md singles out: "it was accepted" must not be
a different claim from "it is there".

Found by an integrator on the live instance, 2026-09-07.

## Work

Refuse a body with no `invite` field with a `400` naming the field. Keep the
uniform `202` for every case where a token *was* supplied, valid or not.

Check the other uniform-answer endpoints for the same distinction — a missing
field is not a wrong value.

## Acceptance

A request with no invite token is refused and says which field is missing. A
request with a wrong token still answers exactly like one with a right token.
