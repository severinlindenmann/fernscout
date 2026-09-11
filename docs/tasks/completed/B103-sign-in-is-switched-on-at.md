---
id: B103
title: Sign-in is switched on at fernscout.ch and no one has been through the code flow there end to end
type: OPS
priority: high
complexity: medium
area: auth, ops, capabilities
found: "2026-09-03"
related: B102, B104, B105, B106, B107, B108, B109, B110
started: "2026-09-09T18:01:46Z"
merged: "2026-09-09T18:03:11Z"
---

# B103 — Sign-in is switched on at fernscout.ch and no one has been through the code flow there end to end

## Why

> **Stale reference, 2026-09-04.** B298 removed MCP: there is no `lib/mcp/`
> and no `/api/mcp`. Every mention of an MCP tool or endpoint below describes
> deleted code, and "the network door" now means the REST API alone. The
> reasoning is unchanged — the paths it names are one fewer than it says.

**Note, 2026-09-05.** The per-journal half of the reading below can no longer
be taken from `/api/health`: B473 stopped it naming journals and their
capability posture. The server switches are all still on. Whether a journal
has this one on is a question for the server now, not the endpoint.

`/api/health` reports `auth` enabled on the server. Auth is the gate in front
of everything an agent may write, and nothing records that a person has been
through the flow on the deployed instance: `POST /api/auth/request` → a
six-digit code by mail → `/api/auth/verify` → a 7-day token that arrives in
`Authorization: Bearer` and nowhere else. Guest sessions are cookies and the
two must never be interchangeable — that is decision 24, enforced in
`resolveSession()`, and reading the site on a phone must not put a write
credential in your pocket.

Five merged tasks are sitting in `testing/` on exactly this surface, waiting
for somebody to try them: B40 (a six-digit code expires in ten minutes, which
is shorter than people take to find the mail), B55 (a signup token documented
as single-use and is not), B69 (the one-tap link loses the page you were
trying to read), B29 (an agent handing its owner a working sign-in link), and
B98 (revoking access leaves tokens already issued still working). Merged is
not verified. This task is where that is found out, on the machine that
serves.

Depends on B102 — the code arrives by mail, so mail has to reach you first.

## Related

One campaign, not nine tasks: every capability this instance can switch on,
driven once against fernscout.ch by somebody who can read the answer. They
share the standing rules, the test journal and the rule that every defect
becomes its own capture. The order is forced — B102 first (everything else
arrives by mail), then B103, and the rest in any order. B101 is the same
shape pointed at the gate rather than the feature.

## Work

From outside, against fernscout.ch:

- request a code for an address you control, verify it, and get a token; use
  that token for a read and a write through `/api/v1/…` **and** through
  `/api/mcp`, since the same boundaries have to hold on both doors;
- check the token's lifetime is the 7 days claimed, and what happens on the
  other side of it;
- check a wrong code burns a guess and that five burn the code; check the
  ten-minute expiry against how long the mail actually took to arrive (B40);
- check a trip-scoped token cannot touch another trip, and cannot publish;
- check a guest cookie is refused as a bearer token, and a bearer token is
  refused as a session cookie;
- check logout, and the one-tap sign-in link's landing page (B69).

Not doing: attacking it. Probing for a way past the gate is B101, a separate
engagement against a local instance. This task establishes that the front door
works for somebody holding the key.

Standing rules for this run: any secret goes in `/etc/fernscout/env` and
nowhere else — never `content/config.json`, never a commit, never echoed back
into a chat. Work in a journal created for this, with days carrying
`test: true`, and do not write into a journal somebody is actually using.
Leave the instance as you found it, or say in this task what you left switched
on. Every defect becomes its own backlog task referencing this id — do not fix
anything here, so the finding and the fix stay separate records. B101 is the
same shape: an engagement whose output is other tasks.

## Acceptance

- Each check above recorded with the request made and the response seen.
- An explicit line for each of B29, B40, B55, B69 and B98 saying whether this
  run confirms or contradicts it — those five are in `testing/` and this is
  the evidence they are waiting for.
- One backlog task per new defect, referencing B103.

---

## The run — 2026-09-09, against fernscout.ch

Instance at commit `bb50b142`. Driven from outside over TLS, in the journals
B102 created for this run (`test-b102-mail`, `test-b102-de`). Codes were read
from the server's own mail copies, since the receiving inbox is not one this
session can open; that changes nothing about the flow being exercised.

**One premise of this ticket is stale.** B29, B40, B55, B69 and B98 are all in
`completed/`, not in `testing/`. They were verified anyway, independently,
against the running instance — that is the section below.

### The flow, end to end

| Check | Request | Response |
| --- | --- | --- |
| Ask for a code | `POST /api/auth/request` `{user, email, kind:"agent"}` | `202 {"status":"accepted"}` |
| Code arrives | mail copy, ~1s later | six digits, *"It works for 30 minutes"* |
| Exchange it | `POST /api/auth/verify` | `200`, `fs_agent_…`, `scope:["write:content"]`, `expires` **+7 days** |
| Replay the same code | same call again | `401 invalid_code` — single use |
| Read with the token | `GET /api/v1/<user>/status` | `200` |
| Write with the token | `POST …/trips`, `POST …/days` | `201`, day arrives as `status: "draft"` |

`/api/mcp` was not driven: B298 removed it. The ticket's note at the top
already says so.

**Token lifetime.** `expires` is exactly seven days on every token this run
minted (`2026-09-09T17:45:26Z` → `2026-09-16T17:45:26Z`). What happens on the
far side of it could not be observed in an afternoon; an unknown token is
`401 invalid_token` with *"The token is unknown, revoked or expired. Ask for a
new code at POST /api/auth/request."*, which is the message an expired one
takes. Not proof, and recorded as not proof.

**Wrong codes.** Five wrong guesses burn the code — driven live: six wrong
submissions, then the *correct* code, which was refused. `MAX_CODE_ATTEMPTS` is
5 (`lib/auth/index.ts:73`). A burned code and a wrong code both answer
`401 invalid_code`, so nothing is leaked about which happened; the cost is that
a person who mistyped five times is not told they now need a fresh code. Not
filed — it is a defensible trade, and worth a look if anybody redesigns the
message.

**Expiry against how long the mail took.** Every code mail was queued at the
relay within one second of the request. Against a 30-minute window this is not
close, and B40's original complaint — ten minutes being shorter than people take
to find the mail — no longer applies.

### The boundaries

All refusals below were driven, not read:

| Attempt | Result |
| --- | --- |
| Trip-scoped token writes into its own trip | `201` |
| …writes into a different trip in the same journal | `404 unknown_trip` — existence not leaked |
| …creates a trip | `403 out_of_scope`, *"Only the journal's owner can create a trip."* |
| …publishes a day | `403 out_of_scope`, *"Only the journal's owner decides what goes on the site."* |
| …deletes the journal | `403 out_of_scope`, *"Writing to a trip and deleting the journal around it are different authorities."* |
| Code for trip A redeemed naming trip B | `401 invalid_code` |
| Guest cookie value sent as `Authorization: Bearer` | `401 invalid_token` |
| Identity cookie value sent as `Authorization: Bearer` | `401 invalid_token` |
| Agent token sent as `Cookie: fs_session=` | `401 missing_token`, *"Send the token as `Authorization: Bearer <token>`, and nowhere else."* |
| Guest cookie used to write a day | `401 missing_token` |

Decision 24 holds in both directions on the deployed instance.

**Cookies.** `POST /api/auth/link` sets `fs_session` and `fs_identity`, both
`Secure; HttpOnly; SameSite=lax`, both one year. Matches what AGENTS.md
describes.

**Logout.** `POST /api/auth/logout` → `200 {"ok":true}`, and the same cookie
that had been rendering a `guest` trip a moment earlier renders the sign-in gate
afterwards. The trip's content is gone from the response, not merely hidden.

### The five tickets this run was asked to adjudicate

- **B29 — an agent handing its owner a working sign-in link. CONFIRMED.**
  `POST /api/v1/journals` returns a `signIn` URL, and the welcome mail carries a
  second, standing one. Both work; both are single-use. The create-call link had
  been invalidated by later code requests for the same address — which is what
  its own `signInNote` says will happen — and failed cleanly with
  `401 link_spent` and `next: "/test-b102-mail/me?signin=expired"`, i.e. the
  page that can issue a fresh one. The standing link then signed in on the first
  press and was spent on the second.
- **B40 — a code expiring in ten minutes. CONFIRMED FIXED.** It is thirty, live,
  in the code (`CODE_TTL_MS`), and in the mail. But `/openapi.json` on the same
  server still says ten — filed as **B1130**.
- **B55 — a signup token documented single-use and not being it. CONFIRMED
  FIXED.** The token that created `test-b102-mail` was replayed against
  `POST /api/v1/journals` and refused: `401 invalid_token`, *"A signup token
  creates one journal and is spent by doing so."*
- **B69 — the one-tap link losing the page you were trying to read. CONFIRMED
  FIXED.** A guest code requested with
  `destination: "/test-b102-mail/trips/trip-one"` produced a link whose
  `POST /api/auth/link` answered `{"ok":true,"next":"/test-b102-mail/trips/trip-one"}`.
  The destination survives the round trip and never appears in the mailed URL.
- **B98 — revocation leaving issued tokens working. CONFIRMED FIXED, with a
  defect beside it.** Removing the address from `people:` caused its existing
  trip-scoped token to be refused on the next write — `403 access_revoked` —
  one second later. Membership is re-checked at use. The API's own response to
  that removal still tells the owner the opposite, which is **B1131**.

Also worth knowing, since B142's reasoning is what this rests on: the one-tap
link is a page with a button, not a `GET` that signs you in, and it behaves that
way live — fetching the URL signs nobody in.

### Defects filed

- **B1130** — `/openapi.json` says a code lasts ten minutes; `/agent.md` and the
  code say thirty.
- **B1131** — removing somebody from a trip tells the owner their token keeps
  working, and it does not.

B102 filed three more from the same session: B1132, B1133, B1134.

### Not done

Attacking the gate — that is B101, and deliberately not this. What this
establishes is that the front door works for somebody holding the key, and that
each of the five doors it must *not* open stayed shut when pushed.
