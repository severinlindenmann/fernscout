---
id: B38
title: A journal or a trip can be created through the API but never removed
type: FEATURE
priority: medium
complexity: high
area: api, journals, trips, mail, auth
found: "2026-09-01"
started: "2026-09-01"
---

# B38 — A journal or a trip can be created through the API but never removed

## Why

`POST /api/v1/journals` makes a journal and `POST /api/v1/{user}/trips` makes a
trip. Neither has a counterpart. The only `DELETE` in the whole v1 surface is
one day at a time (`app/api/v1/[user]/trips/[trip]/days/route.ts:152`), so the
way to remove a trip is to delete its days one by one and leave an empty
folder, and the way to remove a journal is to open a terminal on the VPS.

That is a bad shape for a product whose entire creation path is an agent. An
agent can make a journal for somebody in a minute; if the name is wrong, or it
was a test, or they simply changed their mind, the agent has to tell them the
only way back is a shell. It also quietly undermines the promise the export
feature makes — `lib/exportZip.ts` calls itself *"the anti-lock-in pitch, made
concrete"* — because taking your data out is only half of leaving. And with
`MAX_JOURNALS_PER_EMAIL = 3` (`lib/journals.ts:72`), three abandoned
experiments are a permanent ceiling on a person who cannot delete any of them.

**The existing confirmation mechanism is not sufficient here, and the reason is
the interesting part.** `lib/agentConfirm.ts` already refuses a destructive
call once and hands back an HMAC bound to the exact operation, which the agent
repeats. It is well built and its own header is honest about the limit: it is
*"deliberately not single-use"*, and the code goes **to the agent**. So the
agent that was asked to write up a day can, on its own, complete a two-step
deletion without any person seeing either step. For a draft day that is the
right trade — the second refusal exists to make an agent stop and think, not to
be cryptographically final.

A journal is not a draft day. It is somebody's photographs and every word they
wrote, and the failure mode is an agent that misreads "get rid of that test
entry" as "get rid of that journal" and then satisfies its own confirmation.
So this needs a step the agent cannot take: a mail to the owner's address, and
a link only a person can follow. That also re-proves the address still belongs
to them, which nothing else in the delete path would.

Related to B21 — the restore drill has never been run on the deployed stack.
Shipping deletion makes that task load-bearing rather than prudent: this is the
first feature whose bugs are unrecoverable without a backup that works.

## Work

Two endpoints, one flow, and the mail is the gate for both.

- `DELETE /api/v1/{user}/trips/{trip}` — the trip folder and everything in it,
  including its `media/`. Note the difference from day deletion, which
  explicitly leaves photographs on disk; a trip taking its media with it is the
  right behaviour but it is a departure and should be said out loud in the
  confirmation text.
- `DELETE /api/v1/{user}` — the journal: `content/<username>/` and every
  database row that names it.

Neither deletes anything when called. Each answers `202` and sends the owner a
mail: *you asked to delete this, are you sure*, with what will go, and a link.
The reply to the agent says a mail was sent and names the address in the form
the owner would recognise, so the agent can tell the person to go and look —
and says plainly that nothing has been deleted yet.

### The link

- A random token, stored **hashed** (`hashSecret`, `lib/auth`), like every
  other bearer credential here. Not a UUID: a UUID is an identifier, and a
  credential that opens a destructive action should be generated as a secret.
- Bound to the exact target, single-use, and short-lived — an hour or so. This
  is the property `agentConfirm` gives up and the reason this is a separate
  mechanism rather than a longer TTL on that one.
- **The link must not delete on GET.** It lands on a page that names what is
  about to go and has a button. Mail scanners, link previewers and corporate
  security appliances follow links in mail; a GET that destroys a journal will
  eventually be followed by a robot, and there is no undo. This codebase has
  already reasoned about exactly this twice, in opposite directions —
  `app/[user]/s/[token]/route.ts` explains why a *sign-in* GET is acceptable
  (worst case, a session nobody uses), and the unsubscribe route at
  `app/[user]/u/[token]/route.ts:49` refuses to act on GET because the loss is
  invisible and irreversible. Deletion is far past the second case.
- Offer the export on that page and in the mail — `exportZip` with the `"all"`
  scope already produces the whole journal. Somebody about to delete five years
  of writing should be handed a copy without having to think of it.

### What a journal deletion actually removes

Enumerate it in the code rather than trusting a cascade. `TABLE_NAMES`
(`lib/db/schema.ts:286`) is the list: `contacts`, `contact_invites`,
`access_grants`, `digest_sends`, `push_subscriptions`, `reactions`, `jobs`,
`tracking_points`, `print_orders`, plus `sessions` and `login_codes` for the
owner and anyone signed into the journal. `access_grants` and
`push_subscriptions` cascade from `contacts`, but the rest key on `owner_id`
and will be orphaned silently. A test should assert that no row anywhere names
the username afterwards — that is the only check that will not rot as tables
are added.

Decisions to make and record here before writing code:

- **Is the username reserved afterwards, or freed?** Freeing it means the next
  person to claim `anna` inherits every link, QR code and bookmark pointing at
  the old journal, and a family following an old address lands on a stranger's
  photographs. Reserving it means a name is burned forever by one test journal.
  Leaning to reserving — `loadServerConfig().users.reserved`
  (`lib/users.ts:57`) is already the mechanism — but it is the owner's instance
  and an operator may want to reclaim, so whatever is chosen must be visible to
  the operator rather than implicit.
- **What do the old URLs answer?** `410 Gone` rather than `404`, so a crawler
  drops the pages instead of retrying, and anyone with the link is told the
  journal was removed rather than that they mistyped.
- **Is a deletion staged or immediate?** A grace period — marked for deletion,
  gone in seven days, any sign-in cancels it — is the difference between a
  mistake that is embarrassing and one that is final. It also costs a scheduled
  job and a state nothing else in the codebase has. Decide explicitly; do not
  let "immediate" be the default because it was easier.
- **Who may ask?** The owner. A trip-scoped agent token must be refused for
  both endpoints, and somebody merely listed in a trip's `people:` may not
  delete that trip — they can write to it, which is not the same authority.
  Assert both.

### The decisions, made

Written before the code, and the code matches them.

**1. The username is reserved, by a tombstone the operator can see and remove.**

Deleting `content/anna/` leaves `content/.deleted/anna.json`: when it went, who
asked, what it held. `isReservedUsername()` consults it, so `POST
/api/v1/journals` refuses the name with `reserved_username` and the same
sentence it uses for `api` or `_next`. Freeing the name is one command —
`rm content/.deleted/anna.json` — which is a thing an operator does on purpose
and can see in a directory listing.

Chosen over `loadServerConfig().users.reserved` (the mechanism the task file
leans on) because that file is hand-written by the operator: a program that
rewrites `content/config.json` on every deletion is a program that reformats
somebody's configuration and loses their comments. The tombstone is additive on
top of that list, in a directory that exists for nothing else, and it carries
the *why* — a name in a `reserved` array says nothing about what happened to it.
Chosen over freeing the name because a family following a five-year-old link
must never land on a stranger's photographs, and there is no way to un-hand-out
a QR code on somebody's fridge.

**2. Old URLs answer `410 Gone`.**

The tombstone is what makes this possible: without a record on disk there is
nothing that distinguishes "deleted" from "never existed", which is why this
decision and the one above are the same decision twice. `proxy.ts` answers 410
for `/<username>` and everything under it, and for a deleted trip's
`/<username>/trips/<trip-id>`, before any page renders — a page cannot set a
status code in Next, and a route handler cannot sit where a page already does.
A crawler drops the URL instead of retrying it for a year; a person reads that
the journal was removed by its owner, which is a different sentence from "you
mistyped this".

Trips get a tombstone too (`content/.deleted/<username>/<trip-id>.json`), for
the same reason and out of the same code.

**3. Deletion is immediate on confirmation. Staged deletion is B49.**

Not because it was easier. Because a grace period needs something to run at
the end of it, and on this stack nothing runs: `deploy/fernscout-worker.service`
says in its own header *"Nothing enqueues work yet"*, `npm run worker` is not a
script in `package.json`, and nothing anywhere drains the `jobs` table. A
seven-day expiry that no process reaches is not a grace period — it is a
journal that has been told it is gone, is already unreachable, and stays on
disk forever. That is precisely the "broken rather than absent" failure
`AGENTS.md` forbids, and it would be worse than what we have now: the owner
would believe their content was deleted when it was not.

What the grace period was for is bought a different way, and this is the part
that made the trade acceptable:

- The gate is already two independent steps in two different places — an API
  call, and then a mailbox only a person can open. The agent cannot complete
  the second one.
- **The mail and the page both carry a full export**, `"all"` scope: private
  trips, drafts, everything. `/<user>/export.zip` anonymously serves only the
  public scope, so linking that before a deletion would have handed somebody a
  copy that silently omitted the things they were about to lose. The deletion
  token authorises the complete archive at
  `/<user>/delete/<token>/export.zip`, and the confirmation page puts it
  *above* the delete button. Leaving with your data is the recovery a person
  can actually perform.
- The tombstone records the exact timestamp, which is what an operator needs
  to pick a point to restore from (`deploy/fernscout-backup.timer`). Related to
  B21: this is the feature that makes that drill load-bearing.

B49 captures the staged version, to be reconsidered when there is a worker.

**4. Only the journal's owner may ask, and the mail goes to the journal's own
owner address.**

Both endpoints require an agent session for that journal whose scope is the
unqualified `write:content`. Somebody listed in a trip's `people:` gets
`write:trip:<id>` from `/api/auth/request` (`mayRequestAgentToken`), and is
refused on both endpoints — including on the very trip they may write days
into. Writing to a trip and removing it are not the same authority.

The confirmation mail is addressed to `owner.email` in
`content/<user>/config.json`, never to `session.email`. Those are the same
address today, but reading it from the config rather than from the credential
means a token can never route its own confirmation somewhere else.

Documentation, in the same change: `agent.md` and `documentation.txt`
(`agentGuide()`, `lib/api/documentation.ts`), `openapi.json`, the MCP tool list
(`lib/mcp/tools.ts`), and `AGENTS.md`. The guide should tell an agent to
mention the mail rather than treat a `202` as success — an agent that reports
"deleted" when nothing has been deleted is worse than one that cannot delete.

### Found while building it

Two things the Why did not know, both recorded rather than absorbed:

**`proxy.ts` was in the browser bundle.** The 410 has to be served from the
proxy — a page in Next cannot set a status code, and a route handler cannot sit
where a page already does — so the proxy had to read a file, and that broke
`npm run build` with *"the chunking context does not support external modules
(request: node:fs)"* while chunking `/page`. The cause: `LOCALE_COOKIE` and
`PATH_HEADER` were exported from `proxy.ts`, and `components/LocaleSwitcher.tsx`
is a client component that imported one of them — so everything `proxy.ts`
imported was pulled into the browser graph. Harmless while the proxy imported
nothing; a build failure the moment it needed the filesystem. The two constants
moved to `lib/requestKeys.ts`, which imports nothing, and `proxy.ts` no longer
exports anything a page or a component may import. The reasoning is written
into both files so it does not come back.

**Two mails in the same millisecond overwrite each other** in the development
file transport — `B50`, captured, not fixed here. It made one of these tests
fail about one run in ten before the helper stopped depending on it.

**`B49`** carries the staged-deletion decision, to be revisited when there is a
worker to run the sweep.

Not doing: deleting a single day, which already works. Deleting somebody's
account across journals — `journalsOwnedBy` returns several and each is deleted
on its own. Removing content from the operator's backups or from version
control if the content directory is under any, which this cannot reach and
should say so in the mail rather than imply a completeness it does not have.

## Acceptance

- `DELETE` on a trip and on a journal each answer `202`, delete nothing, and
  write a `.eml` under `content/<user>/mail/` naming what would go.
- Following the link with GET deletes nothing; the deletion happens only on the
  explicit confirmation from that page. A test asserts the GET is inert.
- A used token, an expired token, and a token for a different target are all
  refused, and the refusal lands somewhere that explains rather than on a 404.
- After a journal deletion, `content/<username>/` is gone and no row in any
  table in `TABLE_NAMES` names the username — asserted by iterating the list,
  not by naming tables individually.
- After a trip deletion, the folder including `media/` is gone and the rest of
  the journal is untouched.
- A trip-scoped agent token is refused on both endpoints; a person listed in
  `people:` is refused the trip deletion.
- The username decision and the staging decision are recorded in this file and
  match what ships.
- Old URLs answer `410`.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
