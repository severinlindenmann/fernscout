# W38 — Making the first five minutes work

An agent was handed `fernscout.ch/documentation.txt` and an email address and
told to make a journal. It got there: signup, a journal, a trip, three draft
days, five photographs. Then the person who asked for it opened
`fernscout.ch/journal1` and was told no journal existed at that address, never
got a mail saying one had been made, and found the photographs attached to
nothing.

Everything below comes from that run. Nothing here is speculative: each item is
either something that visibly broke, or something the agent said in writing it
could not work out from the documentation.

---

## 1. A journal created through the API is unreachable — reproduced

**Symptom.** `POST /api/v1/journals` answers `201` with a URL. Opening that URL
answers 404 with "there is no travel journal at this address". A restart fixes
it.

**Reproduction**, against a production build (`npm run build && npm start`):

```
GET  /                        200      <- any page render, first
POST /api/v1/journals         201
GET  /repro1                  404      <- the page
GET  /repro1/documentation.txt 200     <- the route handler
GET  /documentation.txt       lists it
```

The route handlers can see the new journal. The pages cannot.

**Cause.** `getUsernames()` in `lib/users.ts` memoises the user list for the
life of the process and is invalidated only by an explicit `clearUserCache()`,
which `createJournal()` calls. In a production build Next gives the RSC/page
layer and the route-handler layer **separate instances of the module**, so that
call clears the route handler's copy and leaves the page layer's copy stale
until the process restarts. `loadServerConfig()` and `loadUserConfig()` in
`lib/config.ts` have the same shape and the same defect.

`getTrips()` and `getAllEntries()` do not have it: both already re-`stat` and
compare a signature on every call, for exactly this reason — the comment on
`tripsSignature` says a privacy control that needs a restart is not a privacy
control. The same reasoning applies to a journal that needs one to exist.

**Fix.** Give the user list and both config caches the same self-validating
shape. `getUsernames()` reads the directory anyway; the validated list is cached
against the sorted entry names. Each config is cached against its file's
`mtimeMs:size`. `clearUserCache()` and `clearConfigCache()` stay for tests, and
stop being load-bearing in production.

A regression test asserts the property directly: with the cache warm, a journal
written to disk is visible to the next `getUsernames()` without anyone calling
the invalidator.

## 2. Nothing tells the owner their journal exists

`POST /api/v1/journals` writes the folder and hands the agent a token. The
person whose address owns it is told nothing, and the agent is under no
obligation to pass the URL on.

**Fix.** One mail on journal creation, to the address that owns it: the
journal's URL, its visibility, the reminder that everything an agent writes is a
draft and where to find drafts waiting, and how to get a token later. Nothing on
trip creation — an agent making five trips must not send five mails.

The mail is best-effort. A journal that exists but whose welcome mail bounced is
not a failed creation, so a send failure is logged and the `201` still stands,
with `welcomeMailed: false` in the reply so the agent knows to hand the URL over
itself.

## 3. An agent has no idea what to ask before it starts

`documentation.txt` step 2 is "ask for the email address" — and that is the
whole of what it says to ask. The run showed two more that decide things the
person lives with:

- **the username**, which is the address of their site forever (agent.md says
  this; documentation.txt does not);
- **whether the journal is public or invite-only**, which nobody is asked, so
  every journal is public by default and its owner finds out later.

**Fix, part one — journal visibility.** It does not exist today; only trips have
it. A journal gets `visibility: "public" | "private"` in its `config.json`,
defaulting to `public` for every journal that already exists.

`private` means **unlisted**: absent from `/documentation.txt`, from the landing
page, from `sitemap.xml`, and marked `noindex`. It does not mean a wall in front
of `/<user>` — reading a trip stays governed by the per-trip gate, which is the
machinery that already works and already has a password, guests and a `people:`
list behind it. A full journal-level auth wall is a separate, larger thing and
goes to the ROADMAP rather than in here.

Nothing changes about trip defaults: `createTrip` already writes `private`
unless the caller says otherwise, whatever kind of journal it is in. Worth
saying because it is the thing everyone assumes needs adding.

**Fix, part two — say what to ask, first.** `documentation.txt` and `agent.md`
both open with the questions to put to the person before any call: the address,
the username, public or invite-only, and the name and nickname the site should
use. With one sentence each on what the answer commits them to.

## 4. A day's photographs cannot be attached to the day — blocker

`POST .../media` returns `201` and writes the files. The reply says to paste the
gallery block "into the entry", and there is no PATCH or PUT on a day, so there
is nothing to paste it into. Days written before their photographs read back
with `"gallery": []` forever, and the only route out is deleting the drafts —
pushing an agent that made an ordering mistake towards a destructive call.

**Fix.** The media endpoint already receives `day=<slug>`, so it knows which
entry to edit: it appends the items to that entry's `gallery:` frontmatter
itself. Order stops mattering and there is nothing to paste. It still returns
`items`, and it still refuses when the day is published — writing into a day
people have already read is a person's job.

`day` becomes required: it was already required in practice by `storeUploads`,
and a request that names no day now has an entry it is failing to reach.

## 5. `signup/request` answers a bare 500, and a retry kills the emailed code

Three identical calls gave 500, 202, 500. The 500 has an empty body, is not in
agent.md's error table, and is indistinguishable from "stop" and "try again".

**Cause.** `await sendMail(...)` is unguarded, so any SMTP failure becomes an
unhandled throw and a framework 500 — while the code has *already been written
to the database*. `issueCode` consumes every outstanding code for that address
first, so the failed attempt's code is live in the person's inbox and the next
attempt silently invalidates it. Two identical emails, no way to tell which.

**Fix.**

- Wrap the send. A failure consumes the code it just issued, logs, and answers
  `503 mail_failed` with a message — 503 already means this on `signup/request`
  when mail is off entirely. Same treatment for `/api/auth/request`.
- The mail says when it was requested, and that it replaces any earlier code.
- agent.md documents that a new request invalidates the previous code, and adds
  `500` and `503` to the error table.

## 6. `POST .../days` has no request schema anywhere

`openapi.json` gives the days POST responses and no `requestBody`. agent.md has
one worked example. So the only description of the write format is an example —
and `gallery`, `costs` and `transport` come back on a read while appearing
nowhere in it.

**Fix.** Full `requestBody` schemas in `openapi.json` for the days POST (with
`gallery`, `costs`, `transport`, `tags` item shapes), the trips POST, the
journals POST and the media POST. agent.md lists the optional fields, with the
shape of a cost line.

## 7. The documented markdown twin does not work

`/example/day/zion-narrows.md` answers 404. The route resolves the slug against
`currentTripRef(user)` only, so the twin works for the current trip and no
other — while the search index identifies entries as `parks-2025/zion-narrows`
and the HTML page lives at `/example/trips/parks-2025/day/zion-narrows`.

**Fix.** `/<user>/trips/<trip>/day/<slug>.md` is rewritten to the twin as well,
so the `.md` suffix works on whatever the page's own URL is. The bare
`/<user>/day/<slug>.md` keeps working and, when the current trip does not have
that slug, looks through the journal's other readable trips before giving up.
Both forms are documented with a real slug. A `.md` miss answers plain text —
already true for the rewritten route, and now also for the trip-scoped one, so
no agent fetches 40 KB of HTML 404 into a context window.

## 8. `test: true`

The agent was asked to invent three days, which the guide otherwise forbids for
good reason, and handled it by writing "this is invented test content" into the
prose. That is its convention, not the system's.

**Fix.** `test: true` on a trip or a day. The renderer shows an unmissable
banner, and the entry is excluded from the feed, the search index and the
sitemap in exactly the way a draft is. agent.md tells an agent to set it when
asked to produce content nobody lived, and the instance documentation says the
flag exists. An operator can then exercise the whole pipeline without writing
prose that is only harmless because an agent chose to make it so.

## 9. The smaller things from the same list

- **`user` vs `username`.** The path segment and the auth bodies say `user`;
  journal creation says `username`. Not worth breaking the API over; agent.md
  says once that the journal's address is what goes in the path.
- **`idempotency_key` on REST.** Documented only under MCP, so an agent cannot
  tell whether the REST writes accept it, ignore it, or reject it. The days POST
  accepts it, with the same semantics as MCP, and says so.
- **`404` means two things** — no such trip, or authentication is off
  server-wide. The second gains its own body (`auth_disabled`) so an agent can
  tell "fix the id" from "this server does not do tokens, stop".
- **Media by URL.** Say what is kept: for a URL upload the original is the file
  as downloaded, so the photobook is stuck with whatever the remote host served.

---

## Not in this round

**A journal-level authentication wall.** "Private" here means unlisted, with
per-trip gating underneath. A journal where nothing at all is readable without a
session is a larger change — every page, feed, search index, export, media route
and markdown twin — and needs an invite flow at journal level. ROADMAP.

## Verifying

`npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build` — all
four. Then a production build with signup on, running the reproduction in §1 to
a 200, and the deploy checked against `/api/health` and a real journal creation
on the VPS.
