---
id: B38
title: A journal or a trip can be created through the API but never removed
type: FEATURE
priority: medium
complexity: high
area: api, journals, trips, mail, auth
found: "2026-09-01"
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

Documentation, in the same change: `agent.md` and `documentation.txt`
(`agentGuide()`, `lib/api/documentation.ts`), `openapi.json`, the MCP tool list
(`lib/mcp/tools.ts`), and `AGENTS.md`. The guide should tell an agent to
mention the mail rather than treat a `202` as success — an agent that reports
"deleted" when nothing has been deleted is worse than one that cannot delete.

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
