---
id: B1134
title: Accept-Language is the only way to set the language of the two pre-journal mails and no agent-facing document says so
type: FEATURE
priority: low
complexity: low
area: mail, i18n, api, docs
found: "2026-09-09T18:00:06Z"
---

# B1134 — Accept-Language is the only way to set the language of the two pre-journal mails and no agent-facing document says so

Found during B102, driven against fernscout.ch on 2026-09-09.

## Why

Two mails go out before a journal exists, so neither can read a journal's
`defaultLocale`: the signup code (`POST /api/auth/signup/request`) and — for an
address with no journal — the identity code.

`app/api/auth/signup/request/route.ts:75` picks the language from the request's
`Accept-Language` header, and it works: the same call with
`accept-language: de-CH,de;q=0.9` produced *"Dein Code, um auf Fernscout ein
Reisetagebuch zu beginnen"* against the live instance, and without it produced
English.

The lever is real, and nothing an agent reads mentions it. `/agent.md` does not
contain the string `Accept-Language`; neither does `lib/api/openapi.ts`; and the
request schema for the route is `{ email }` and nothing else. A caller building
an HTTP request from the documented schema sends no such header — browsers send
it, agents do not — so the first thing this software says to a German- or
Hungarian-speaking person is in English, on a door built for agents.

Once the journal exists the problem stops: its own locale is used, and the
welcome and deletion mails came back in real German in this run. B26 is
genuinely fixed. This is the sliver in front of it.

## Work

Two options, and the second is probably the lazier one:

- accept an optional `locale` in the signup and identity request bodies, and
  prefer it over the header; or
- document `Accept-Language` on both operations in `lib/api/openapi.ts` and in
  the sign-up section of `/agent.md`, so the existing mechanism is reachable.

Either way the contract has to say so — a language lever nobody outside can
find is the same as not having one. If the body field is added, `openapi.ts`
gets the property and `/agent.md` gets a sentence; see the `keep-the-contract`
skill.

## Acceptance

- An agent reading only `/agent.md` and `/openapi.json` can cause the signup
  code mail to arrive in German.
- Driven against a running instance, in German and in English.
