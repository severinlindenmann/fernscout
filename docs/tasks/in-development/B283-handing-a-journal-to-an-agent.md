---
id: B283
title: Handing a journal to an agent means reading six digits down the phone, and the page offers two lines instead of a prompt
type: FEATURE
priority: medium
complexity: high
area: auth, me-page, agents, documentation
found: "2026-09-04T12:43:00Z"
started: "2026-09-04T13:40:14Z"
session: a3370c43-40d9-471c-a3d3-1a30c49b5302
claimed: "2026-09-04T13:40:14Z"
---

# B283 — Handing a journal to an agent means reading six digits down the phone, and the page offers two lines instead of a prompt

## Why

`components/AgentHandover.tsx` is what an owner is given to start an agent: a
URL, their email address, and a copy button.

```
Gib diese zwei Zeilen einem Agenten. Er liest dort die Anleitung
und fragt dich nach einem Code.

  https://fernscout.ch/documentation.txt
  viki@severin.io
```

Two lines and a promise that the agent will know what to do with them. What
actually follows is: the agent reads `/documentation.txt`, finds `/agent.md`,
calls `POST /api/auth/request`, and then asks the owner for a six-digit code
that has just arrived in their mail — which the owner reads out. Then the agent
has a token and still knows nothing about the journal: there is no single call
that says what is waiting, so it makes four or five (B91 is that finding, and
its `GET /api/v1/<user>/status` is what this task's prompt should tell an agent
to call first).

The ask is a **complete, pasteable prompt**: this journal already exists, here
is its address, here is a key that works, call `status` before you do anything,
here is the guide. Copy, paste, done — no code read aloud, no round trip.

This block is also what a brand-new owner meets on the empty trip list
(`app/[user]/me/MePageContent.tsx:226` notes it is shared), so it is the first
thing anybody sees in a journal with nothing in it. Whatever it says is the
product's first instruction.

## The decision this takes, and who took it

**The author has chosen to put a live 7-day agent token in the page, after being
shown the alternative and the cost. That decision stands and this task builds
it.** It is written down here because it reverses a stated property, and the
next person to read `resolveSession` will otherwise take this for a bug.

Today: agent tokens arrive in `Authorization: Bearer` and nowhere else, guest
sessions arrive in a cookie and nowhere else, and `resolveSession` refuses to
treat one as the other. ROADMAP decision 24 gives the reason in a sentence —
reading the site on your phone must not put a credential that can rewrite it in
your pocket — and `MePageContent.tsx:247` prints that sentence to the owner.
After this task, the page a guest cookie opens will mint and display a Bearer
token. The sentence on the page and the paragraph in the ROADMAP both stop being
true and have to be rewritten, not left standing.

`openAgentSession` (`lib/auth/index.ts:700`) is the function that mints one
without a code, and its comment is explicit: *"The one caller is `POST
/api/v1/journals` … Nothing else may use this; every other path goes through a
code."* This task adds the second caller. Rewrite that comment in the same
change; a stale invariant is worse than none.

### The design, as decided by the author

**The page hands over a 20-minute credential, and the agent mints its own
7-day token with it.** Not a 7-day token in the page — that was the first
answer and this is the better one, because it makes the thing in the clipboard
worthless twenty minutes later.

This is the signup flow's shape exactly, and it should reuse its parts rather
than invent a parallel set. Signup: a code proves the address → a **20-minute**
`signup` session (`SESSION_TTL_MS`, `lib/auth/index.ts:73`, with the reason in
the code: "short enough that a token which can create journals is not lying
around afterwards") → `POST /api/v1/journals` calls `openAgentSession` and
returns a 7-day agent token. Here: the owner is already signed in → a
**20-minute** handover session → the agent exchanges it for its own 7-day
agent token.

What that buys, and it is the whole reason to prefer it:

- **The clipboard, the screenshot and the terminal scrollback all go stale.**
  A 7-day token pasted into a chat log is a 7-day exposure; this one is
  twenty minutes and then it is nothing.
- **It fixes the cookie ceiling.** A guest cookie lasts **365 days**
  (`SESSION_TTL_MS`, `lib/auth/index.ts:70`) against an agent token's 7, so a
  page that minted the 7-day token directly would let a year-old read cookie
  in a phone in a drawer issue write credentials indefinitely — the ceiling
  would be the cookie, not the token. A 20-minute intermediate does not remove
  that (the cookie can still mint another), but it means nothing durable is
  ever *displayed*, and the exchange is a single logged event with a session
  the owner can see and revoke.
- **The agent ends up holding a credential it minted**, which is the same
  position it is in after the code flow today. Nothing downstream of
  authentication changes.

So there are two short-lived things and one durable one, and only the durable
one is a write credential:

| | Lives | Who holds it | Can write |
| --- | --- | --- | --- |
| Handover credential | 20 min | the clipboard | no — it can only be exchanged |
| Agent token | 7 days | the agent | yes |
| Guest cookie | 365 days | the browser | no |

The handover credential must not itself be usable as a Bearer token on any
content route. It exchanges, and that is all it does — the same way a `signup`
session reaches `POST /api/v1/journals` and nothing else.

## Work

A plan in `docs/plans/`, because the freshness question above decides the shape
of the route, and then:

- **A `handover` session kind**, 20 minutes, scope "exchange only", beside
  `guest`/`agent`/`signup` in `SessionKind` and `SESSION_TTL_MS`. Issued to the
  signed-in owner and nobody else — never a guest, never a trip person, since a
  buddy holds a trip-scoped token and gets it the way they get it now.
- **An exchange route** that takes the handover credential as a Bearer token,
  calls `openAgentSession`, returns the 7-day agent token and spends the
  handover session by doing so. `POST /api/v1/journals` is the model, including
  that a spent token gives one clear message rather than a bare 401
  (`app/api/v1/journals/route.ts:100`).
- **`resolveSession` must refuse a handover token everywhere else.** It is a
  fourth kind that is not interchangeable with the other three, and the test
  matrix has to say so per route family, not once.
- **`AgentHandover` renders the prompt**, not two lines: journal URL, the token
  and its expiry, "call `GET /api/v1/<user>/status` first", and the guide link.
  One copy button for the whole block.
- **Depends on B91** for `status` to exist. Until it does, the prompt would
  name a call that 404s — so either B91 lands first or the prompt names today's
  calls and is updated when it does. Say which in the plan.
- **Nothing is shown twice.** The handover credential is displayed once and
  expires on its own; the agent token is never displayed at all, because the
  page never sees it. That is the argument B280 had to have for invite links,
  and it does not transfer to a write credential.
- **The warning text changes rather than disappears.** The owner now holds the
  key rather than reading a code, so what they need told is different and not
  less: what it can do, until when, that it must not go in a group chat, and
  where to revoke it.
- **Rewrite decision 24 in `docs/ROADMAP.md`**, the "one rule" section of
  `AGENTS.md`, the `openAgentSession` comment, and `me.tokenWarning` in all
  three locales.
- **`/agent.md` and `/documentation.txt`** should describe the pasted-prompt
  entry, since an agent arriving with a token and no code flow is now a
  supported way in.

Not doing: the same block for a trip-scoped buddy token, and any browser
session that can write directly — this hands a credential to an agent, it does
not make the browser an editor. That is B262 and a separate decision.

## Acceptance

- Signed in as the owner, `/<user>/me` shows a copyable prompt containing the
  journal URL, a handover credential, when it expires, the exchange call, and
  the instruction to call `status` first.
- An agent given only that block can exchange the credential for a 7-day token
  and write a draft with it.
- The handover credential is refused on every content route — a test per route
  family, not one test — and is spent by a successful exchange, so a second
  exchange fails with a message that says why.
- It expires 20 minutes after issue, asserted against `SESSION_TTL_MS` rather
  than a hardcoded number in the test.
- The issue route refuses a guest session and a trip person, with a test per
  refusal.
- The owner can see live agent sessions and revoke one, from the page.
- No page or API response ever shows the token a second time.
- Decision 24, `AGENTS.md`, `openAgentSession`'s comment and `me.tokenWarning`
  all describe what is now true, in all three locales.
- `claude-security` has been run over the branch; every finding fixed or
  captured by id.
- The four checks pass.

## Verified

All four green: `npm run build` compiled, `npx tsc --noEmit` clean, `npx eslint .`
0 errors (4 pre-existing warnings, none in these files), `npx vitest run` 160
files / 2451 tests. `npm run unused` reports no unused files, dependencies or
unresolved imports — and `listSessions`, which had existed since W06 with no
caller, now has one.

### What was built

| | |
| --- | --- |
| `handover` session kind | 20 min, scope `exchange:token`, beside the other three in `SESSION_TTL_MS` / `SESSION_SCOPE` |
| `POST /api/v1/<user>/handover` | owner only (`isOwner`, cookie or bearer): issues one |
| `POST /api/auth/handover` | an agent spends it for its own 7-day token |
| `GET`/`POST /api/v1/<user>/keys` | the live write keys, and revoke one |
| `handoverPrompt()` in `lib/api/agentCopy.ts` | the pasteable prompt |
| `components/AgentKeys.tsx` | the list, on `/me` |

The prompt is **English regardless of the owner's locale**, because its reader
is an agent and every other agent-facing document here is English. The chrome
around it is translated in all three.

### `test/handover.test.ts` — 25 tests

The refusal matrix is the point, and it is per route family rather than one
test: a handover credential is refused on `/status`, on a write, on the drafts
queue, on the trip list, on the issue route itself, and by `resolveSession` for
all three other kinds while resolving for its own. Plus: the owner's cookie
gets one (that is the whole feature) and a trip person does not; the expiry is
asserted against `SESSION_TTL_MS.handover` rather than a literal; spending it
works once and the second attempt says "already used" rather than answering a
bare 401; and revoking a key stops the token it was minted from, immediately.

### End to end, against a real server

Built, served with `auth`/`contacts`/`mail` on and SQLite, signed in as the
example journal's owner in a browser:

```
click "Get a key and the instructions"
  → the prompt renders with a live fs_handover_… and its expiry
  → the key list gains "A key waiting to be picked up · not used yet"

POST /api/auth/handover  (Bearer fs_handover_…)   200
  → {"token":"fs_agent_…","expiresAt":"2026-09-11T…","scope":"write:content"}

GET /api/v1/example/status  (Bearer fs_agent_…)   200
  → journal Fernscout Demo · 5 trips · 2 drafts · postcards/photobook off
  → next: "2 days are written and not on the site…"

POST /api/auth/handover  (same handover again)    401
GET  /api/v1/example/status  (the handover)       401

then, on the page: the agent key is listed as
  "A seven-day writing key · works until 11/09 15:58 · last used 04/09 15:58"
click Revoke → the row goes
GET /api/v1/example/status  (the revoked token)   401
```

### Two things found in the browser that the tests could not see

**The key list did not refresh after minting one.** `AgentKeys` loads on mount,
the button is pressed afterwards, so the key it created was absent until the
owner reloaded — and a key you cannot see is a key you cannot revoke, which is
the whole reason the list exists. Fixed with a `reloadOn` counter the handover
block bumps. This is exactly the class of defect a unit test on either
component passes through, because each was correct on its own.

**An eslint rule caught a real race**, not just a style point:
`react-hooks/set-state-in-effect` on the load-on-mount. Restructuring it to
return the rows and set state behind an `active` flag also drops a response
that arrives after the effect is cleaned up — which would otherwise have shown
one journal's keys under another's name for as long as the request took.

### Security pass over the branch

No introduced vulnerability found. What was checked, and why each is settled:

- **A cookie session now mints a bearer credential.** That is the amendment,
  bounded to 20 minutes and to one exchange, and refused everywhere else by
  `lookUpSession`'s `kind !== expected` — the property that makes a fourth kind
  refused by default rather than allowed by default.
- **CSRF on the issue route.** The guest cookie is `SameSite=lax`, so a
  cross-site POST does not carry it; the route is POST-only. Same guard and
  same reasoning as `POST /api/v1/<user>/invites`, which has relied on this
  since B79.
- **Guessing a handover credential.** `generateToken` is 32 bytes of
  `crypto.randomBytes`, prefixed `fs_handover_`. The prefix is deliberate: it
  makes one identifiable in a leak and therefore revocable.
- **Logging.** `formatRequestLine` (`lib/requestLog.ts`, B257) records method,
  path and user agent — no headers, no bodies. The credential travels in a
  header and never in a URL, which is why it must stay a header.
- **Cross-journal revoke.** `POST .../keys` checks the id is one of *this*
  journal's rows before revoking. A UUID is unguessable, but unguessable is not
  checked; there is a test.
- **The prompt in the page.** Fetched by script after a click, so it never
  enters the server-rendered HTML or the RSC payload. The cache-header question
  for `/me` is **B287**, captured during B280.

### Documents amended, not left standing

`docs/ROADMAP.md` decision 24 (with the `SESSION_TTL_MS` reasoning for why 20
minutes and not 7 days), the "network doors" paragraph and table in
`AGENTS.md`, `openAgentSession`'s comment — which said "nothing else may use
this" and now names its second caller — `me.tokenBody` and `me.tokenWarning` in
all three locales, a new section in `agentGuide()` before "Authenticating", and
both routes in `openapi.json`.

### One acceptance line was missing when I first thought this was done

"The owner can see live agent sessions and revoke one, from the page" — the
`keys` route and `AgentKeys` did not exist. Built rather than dropped, because
it is what makes the rest safe to use: a credential a person cannot take back
is one they cannot hand out carefully, which is this task's own argument.
