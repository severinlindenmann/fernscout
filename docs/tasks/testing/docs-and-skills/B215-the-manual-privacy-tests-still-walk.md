---
id: B215
title: The manual privacy tests still walk an operator through a trip password
type: DOCS
priority: medium
complexity: low
area: docs, qa
found: "2026-09-04T06:33:34Z"
started: "2026-09-04T09:30:25Z"
merged: "2026-09-04T10:00:32Z"
---

# B215 — The manual privacy tests still walk an operator through a trip password

## Why

Found while doing B81, and deliberately not absorbed into it: B81 is one
sentence in `scripts/notify.mts`, this is a whole scenario table.

`docs/TESTING.md` section F — "Privacy", introduced with "this is where a
mistake would be expensive, so test it properly" — is twelve steps, and the
first four cannot be performed:

| Step | Says | Reality |
| --- | --- | --- |
| F1 | `npm run trip:password -- "familie2026"` | No such script. `package.json` has no `trip:password`, and `scripts/trip-password.mjs` does not exist. |
| F2 | write `passwordHash:` and `visibility: password` | B39 removed the scrypt hash, the signed cookie and the unlock form. `visibility` takes `private`, `public` or `guest`; anything else reads as `private`. |
| F3–F6 | a password form, a wrong password, the right one, and it staying unlocked | There is no form. The gate is `components/TripGate.tsx`, and it asks for an e-mail address. |
| F10 | `visibility: unlisted` | W27 split that into two fields. It is `listed: false` on a `public` trip now, and `listed: true` on a trip no visibility advertises is refused (B51). |

F7 to F9 are still exactly right and are the valuable half — a private trip's
photos must 404 by URL, it must be in neither the sitemap nor the feed, and the
rest of the journal must keep working.

The cost is not that the steps fail; it is that the one document an operator is
pointed at to check privacy before shipping cannot be completed, so it stops
being run at all — and the three checks that do still matter go with it.

## Work

- Rewrite F1–F6 against the mechanism that exists: set `visibility: guest` or
  `private` on a trip, meet the gate, and confirm it names the journal and not
  the trip (B117). Signing in alone must open nothing; a grant is what opens a
  `guest` trip and `people:` is what opens a `private` one.
- Replace F10 with `listed: false`, and add the refusal in B51 as a step.
- Keep F7, F8, F9 as they are.
- Grep `docs/` for `passwordHash`, `trip:password` and `visibility: password`
  while there.

Not doing: `docs/plans/`, which is the record of intent before the work and is
deliberately never updated (`docs/plans/INDEX.md` says so, and
`test/docs-links.test.ts` excludes it for that reason).

## Acceptance

- Every step of section F can be performed against a local dev server.
- `grep -rn 'trip:password\|passwordHash' docs/` finds nothing outside
  `docs/tasks/` and `docs/plans/`.
- The four checks.

## Built

**Section F, F1–F6 rewritten and F10 replaced.** F7, F8 and F9 are untouched,
character for character. The new F1–F6 walk `visibility: private` → the gate →
what the gate does *not* say → a signed-in stranger still refused → `people:`
opening it → `guest` refusing the same person. F10 is `visibility: public` plus
`listed: false`, F11 is B51's refusal, and the old F11 and F12 shift down to
F12 and F13 — the numbers people report with are stable through F9, which is
where the value is.

Two things the walkthrough itself taught, now in the preamble rather than
discovered by the next operator:

- A visibility change needs no rebuild. The caches carry a fingerprint of the
  files they were built from, so the next request sees it.
- `features.auth.enabled` has to be set in **`content/example/config.json` as
  well as `content/config.json`**. A journal opts in to sign-in separately, so
  with only the server flag the gate renders `gate.askOwner` — "ask whoever
  writes this journal" — and no form, and the section stalls at F4 with nothing
  saying why. The API does *not* ask that second question and issues sessions
  for the journal anyway; that inconsistency is **B252**, captured rather than
  absorbed.

F6's second half — an approved guest opening a `guest` trip — is a pointer to
H2–H5 rather than a step of its own, because approving somebody needs a
confirmed contact and that flow is exactly what H already walks. The refusal
half, which is the part F is about, is performed in F6 itself.

**The other documents.** `docs/running-locally.md` said "there is no
`passwordHash:` and no `npm run trip:password`" — true, and it made the
acceptance grep report a hit, so the same sentence now says it without naming
the removed things. `docs/qa/SCENARIOS.md` D1–D3 and D6 and D11 were the same
stale vocabulary (D11 said an unrecognised `visibility:` reads as `password`;
it reads as `private`), and D12 adds B51's refusal. `docs/qa/BLACKBOX.md`
described the test instance as having a trip with the password "alpenglow2024"
and another that is `unlisted`. `docs/ROADMAP.md` decision 12 is a dated
decision and is amended in place with a note, the way decision 19 already
records B37's amendment; the "journal-level authentication wall" entry further
down claimed the trip gate "already has a password", which is simply false now.

## Evidence

Every step performed against `npm run build && PORT=3700 npm start`, editing
`content/example/trips/alps-2024/trip.md` and restoring it afterwards.

| Step | What was run | What came back |
| --- | --- | --- |
| F1–F3 | `curl -s localhost:3700/example/trips/alps-2024` with `visibility: private` | `<h1>Fernscout Demo</h1>`, `<title>Fernscout Demo — Five journeys… · Fernscout</title>`, `<meta name="robots" content="noindex, nofollow">`, and the string "Four days round the Alps" absent from the whole document |
| F4 | `/api/auth/request` + `/verify` as `visitor@example.com`, then the trip with that `fs_session` | `<h1>This trip is not shared with you</h1>`, the `gate.refusedBody` sentence naming the address, and a link to `/example/me` |
| F5 | that address added to `people:` | `<title>Four days round the Alps · Fernscout Demo</title>` on the trip, its `/gallery` and its `/costs`; a request with no cookie still meets the gate |
| F6 | `visibility: guest`, address removed | `<h1>This trip is not shared with you</h1>` again for the same session |
| F7 | `/example/media/alps-2024/over-the-susten/01.jpg`, no session | `404` |
| F8 | `/sitemap.xml`, `/example/feed.xml` | 0 occurrences of `alps-2024` in either |
| F9 | `/example`, `/example/trips` | `200`, `200` |
| F10 | `visibility: public` + `listed: false` | trip page `200`; 0 occurrences in the sitemap, in the feed, and no "Four days round the Alps" on `/example/trips` |
| F11 | `visibility: guest` + `listed: true` | on the server's console: `[trips] alps-2024/trip.md says listed: true, but visibility "guest" does not advertise the trip — ignoring it. listed: can only narrow; write visibility: public to advertise a trip.` — and still absent from the sitemap |

F12 (`costsVisibility: guests`) and F13 (undo) are unchanged from the old F11
and F12 and were not re-run.

The grep in the acceptance:

```
$ grep -rn 'trip:password\|passwordHash' docs/ | grep -v '^docs/tasks/' | grep -v '^docs/plans/'
(no output)
```
