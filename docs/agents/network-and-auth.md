## The network doors

| | |
| --- | --- |
| `GET /documentation.txt` | what this instance is, and who is on it |
| `GET /<user>/documentation.txt` | one journal's own summary |
| `GET /skill/<task>.md` | one task's own guide — `new-account`, `add-journal`, `add-a-trip`, `add-a-day`, `ingest-photos`, `invite-someone`, `costs`, `send-postcards`, `make-a-photobook` (B311) |
| `GET /agent.md` | retired (B311): a 301 to `/documentation.txt`, kept so an old link or a pasted prompt still lands somewhere true |
| `GET /<user>/day/<slug>.md` | a day's markdown source |
| `GET /api/v2/<user>/figures/presets` | the vocabulary the walking figures are described in, and twelve starting points |
| `GET /api/v2/<user>/figures/preview` | that description as a picture, so a person can see themselves before it is written |
| `POST /api/auth/codes` with `for: "read"` or `"write"`, then `POST /api/auth/codes/redeem` | a six-digit code → a 7-day agent token. One door, parameterised by `for`, replacing the old `/api/auth/request` + `/verify` (B1600) |
| `POST /api/auth/codes` with `for: "identity"`, then `POST /api/auth/codes/redeem` | a six-digit code → a year-long **identity** cookie: proves an address to the whole instance and authorises nothing |
| `POST /api/auth/<user>/handover` | owner only: a 20-minute credential to paste into an agent |
| `POST /api/auth/handover` | an agent spends that credential for its own 7-day token |
| `GET /api/v2/<user>/status` | where an agent stands: drafts waiting, trips, capabilities |
| `/api/v2/<user>/…` | REST: trips, days, drafts |
| `/api/v2/<user>/invites` | issue, list and revoke the two invite links — see below |
| `/api/v2/<user>/postcards/orders/{id}` | propose printed postcards — see below |
| `/<user>/postcards/<id>` | where a person looks at them and sends them |
| `/<user>/invite/guest/<token>` | where a guest link lands |
| `/<user>/invite/buddy/<token>` | where a buddy link lands |
| `DELETE /api/v2/<user>` and `…/trips/<trip>` | ask to delete — see below |
| `/admin` | what the instance costs to run — operator only, see below |

**One address can sit above all of this, and it is not in any config file.**
`FERNSCOUT_ADMIN_EMAIL` in the environment names the instance's operator, and
`isOwner` answers yes for them on every journal — reading, publishing, the
contacts page, credits, the lot. Unset is the default and every instance that
does not set it behaves as though `lib/admin.ts` were not there. It is
deliberately not a role, a rank or a row in a table: one address, read from the
environment on each call, so it is an operations decision rather than something
a journal's own file can widen. B480.

**That address has one page of its own, and it is the only thing on this
instance that is about the instance** — `/admin`, B746. What a month of model
calls, speech, print orders and sends actually cost, priced from a `costs`
block in `site/config.json` that the operator edits without a deploy, plus
every journal's balance and its ledger. It reads a **cookie** and never a
bearer token, and it asks `resolveIdentity` rather than `resolveAccess`,
because the question is instance-wide and one journal's own session must not
answer it. With `FERNSCOUT_ADMIN_EMAIL` unset it is a 404 for everybody, which
is how every other instance behaves.

The numbers behind it come from a `usage` table (`lib/usage.ts`) that records
tokens and audio seconds — units, never money, so a period can be re-costed
when a price changes — and `recordUsage` **never throws**: a person has already
spent a credit and been given their day by the time it runs, and losing the day
to an accounting insert would be trading the product for the bookkeeping.

**Its "add credits" button does not add credits**, and that is the same shape as
deleting. `lib/credits.ts`'s property 1 stands unchanged — nothing a *caller*
can reach over HTTP raises a balance — so the button files a zero-franc
transaction and mails the operator the single-use approval link an ordinary
purchase mints. Report it as a mail waiting, never as credits added.

**Buying credits is Stripe, and the key is the only switch** — B792. `PUT
/api/v2/<user>/purchases/<id>` (owner only, and an owner's agent token counts,
client-chosen id so a retry never mints a second row) files a pending
transaction and answers with an absolute `paymentUrl`; the person opens it,
and `/api/web/<user>/purchases/<id>/pay` sends them to a hosted checkout
page for TWINT, a wallet or a card. Nothing an agent holds can pay, and nothing
it holds can grant: `POST /api/webhooks/stripe` is what grants, from Stripe's
own signature over the raw body and a once-only claim on the row
(`claimProviderPayment`). That webhook is one of the three files `GRANT_ALLOWED`
in `test/credits.test.ts` names, beside the operator approval route and the
one-off grant a new journal gets at signup — and that list is the whole of it.

`sk_test_…` is Stripe's sandbox and `sk_live_…` is real money — there is
deliberately no `sandbox: true` beside the key, because a flag beside a
credential is a flag that can disagree with it. `/api/health` prints the mode
it read. With no `STRIPE_SECRET_KEY`, purchases fall back to the operator
approving a mail by hand (B425), which is what keeps this developable with no
Stripe account. `lib/stripe.ts`.

Agent tokens arrive in `Authorization: Bearer` and nowhere else; guest sessions
arrive in a cookie and nowhere else. The two are not interchangeable, and
`resolveSession()` enforces it — it compares a row's `kind` against what the
caller asked for, which is also what makes a *new* kind refused everywhere by
default. That is decision 24: reading the site on your phone must not put a
credential that can rewrite it in your pocket.

**The converse holds too: an agent token reaches `/api/…` and never a
rendered page.** The owner's own pages — `/<user>/contacts` and `/<user>/me`
among them — authenticate from a cookie session only, with no `request`
argument for `isOwner` to read a bearer token from. A token that drives every
write on a trip renders none of these pages; an agent that wants to *see* one
needs a browser session, obtained the way a person gets one. This is also why
a ticket's acceptance line about what a *page shows* cannot be closed by an
agent over the API — write it against the browser explicitly, or against the
API state that drives the render.

**A third browser credential says who you are and opens nothing.** Since B410
an `fs_identity` cookie is bound to an address and to no journal — the
`NO_JOURNAL` (`"*"`) sentinel in `owner_id`, which `USERNAME_RE` can never
collide with. It lasts a year, and it is handed out by the identity code flow
*and* by every ordinary journal sign-in, because proving an address for one
journal proves the address. It authorises nothing by itself: every gate asks
`resolveSession` for `"guest"` or `"agent"` and an `identity` row is refused to
all of them. `resolveAccess()` in `lib/auth/handshake.ts` is the one place that
turns it into an answer about a particular journal, and the answer is **an
address, not a permission** — `journalReader` still asks `hasReadGrant`,
`isOwner` still reads `owner.email`, `isPersonOnWith` still reads `people:`, on
every request. So a year-old identity opens exactly what its holder is entitled
to today, and revoking it (`/api/auth/logout`, or the device list) ends it
outright with nothing downstream left holding access.

Read a journal's access through `resolveAccess(username)` rather than reading
`fs_session` yourself: a reader may hold either credential, and a gate that
looks only at the cookie silently refuses everyone who arrived by identity.

**One thing crosses that line, deliberately, in one direction only.** Since
B283 the owner's own page — a cookie session — can mint a **`handover`
credential**: twenty minutes, scope `exchange:token`, refused on every route
except `POST /api/auth/handover`, which spends it for an agent token the agent
then holds itself. The browser still cannot read or write with it, and the page
never sees the seven-day token. It exists so an owner can paste a whole prompt
into an agent instead of reading a six-digit code down a phone. The code flow
is unchanged and still works. Why twenty minutes rather than printing the
seven-day token: a guest cookie lasts a **year** (`SESSION_TTL_MS`), so the
cookie — not the token — would have been the ceiling, and a week-long
credential would have sat in a clipboard, a screenshot and a scrollback.

**Two links let other people in, and only one of them is safe to forward.**
`PUT /api/v2/<user>/invites/<id>` (owner only, client-chosen id — an invite
has no update once created) makes either a **guest** link — leads to reading the journal's `guest` trips — or a
**buddy** link, which names a trip and leads to **write access** to it. Say
which you are handing over: a guest link belongs in a family group chat and a
buddy link does not. Neither grants anything on its own. Whoever opens one
proves their own address and lands in the owner's approval queue, and
`approveContact` is still the only thing in the codebase that creates a grant —
so report a link as an invitation to *ask*, never as "they now have access".
The token is in the response once, in that API call. Its hash is stored
always, and — since B280 — a reversible copy beside it where the instance has
a contacts encryption key, so the owner's own `/<user>/contacts` page can show
a lost link again; without that key it is hash-only and a lost link can only
be reissued. `lib/contacts/invites.ts`.

**Posting a real postcard is the other thing an agent cannot finish** — B434,
and the same shape as deleting, for a different reason. `PUT
/api/v2/<user>/postcards/orders/<id>` writes a proposal and answers with a URL; it charges
nothing and prints nothing. The owner opens that page, sees the photograph, the
message on the back, who each card is going to, the cost and their balance, and
presses one button. That button is the only thing in the codebase that spends
credits at a printer.

Addresses never reach an agent. `GET …/postcards/recipients` answers with a
name, a town and a country, and cards are addressed by `contactId` — so a card
can only ever go to somebody who asked this journal for one, and never to an
address that arrived in a conversation. The send route is outside `/api/v2/`,
takes the owner's cookie only, and refuses a bearer token outright;
`test/postcard-orders.test.ts` fails if anything under `app/api` ever imports
`sendOrder`. **Hand over the URL and say a preview is waiting. Do not say the
cards have been sent.** `lib/postcard/orders.ts` and `lib/postcard/send.ts`.

**Deleting is the one thing an agent cannot finish.** `DELETE` on a journal or
a trip removes nothing and answers `202`: the server mails the address in that
journal's `config.json` a single-use link to a page with a button, and only the
button deletes. `lib/agentConfirm.ts` is not used for it and must not be — that
code is deliberately not single-use and it goes *to the agent*, so an agent
could satisfy its own confirmation. Here the second step happens in a mailbox.
An agent that reports a `202` as "deleted" has said something false; say a mail
is waiting, and stop. `lib/deletions.ts`, and B38 for the reasoning.

Since B1321 the owner has a shorter road for a *trip* — a Delete link on the
trip's own page, behind their browser cookie only
(`app/[user]/trips/[trip]/delete/route.ts`, the same door-shape as the
postcard send), with the inventory named before the second press. That changes
nothing for you: the route refuses any `Authorization` header outright, so an
agent's path is still the mail, and a whole journal still ends in the mailbox
for everybody.
