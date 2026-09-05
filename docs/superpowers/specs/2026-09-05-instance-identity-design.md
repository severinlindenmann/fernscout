# An identity that spans the instance, a home view that uses it, and a PWA cache that can hold it

*2026-09-05. Design for B410, B411 and B412. Written before the work; B410's
section records one decision that changed during implementation, marked below.*

## The problem

There is one guest cookie, `fs_session`, and the row it points at names a
journal in `sessions.owner_id`. Signing into journal B replaces the session for
journal A. A person who is a guest of one journal, a buddy on a trip in a
second and the owner of a third holds credentials for exactly one of them at a
time.

Two things follow. The server cannot answer "what may this address open?",
because every resolver starts from a cookie that has already picked a journal.
And being let in is a property of a device rather than of a person: an approved
guest proves their address again on each journal and each browser.

The root page is where this shows. `/` is one page for everybody — the pitch,
the copy-this-to-your-agent block, and the journals `listedUsernames()`
advertises. It is the right page for a stranger and the only page there is,
including for the owner opening the installed PWA, whose `start_url` is `/`.
The journals a signed-in reader may actually open are mostly not on it:
`listedUsernames()` excludes an unlisted journal by design, and a `private`
trip is advertised nowhere.

## The shape

Three pieces, in dependency order.

### B410 — the identity credential

A fifth `SessionKind`, `identity`, bound to an address and to no journal.
`owner_id` takes the `"*"` sentinel that signup already used, renamed
`NO_JOURNAL` because two kinds now share it. A year, `scope: "identity"`, and
it authorises nothing.

The property that makes a new kind safe is B283's, reused: `lookUpSession`
compares `kind` against what the caller asked for, and every read and write in
the codebase asks for `"guest"` or `"agent"`. A new kind is refused everywhere
by default and must be let in deliberately.

It rides in a second cookie, `fs_identity`, rather than widening `fs_session`.
Fourteen call sites read that cookie meaning "this person's access to the
journal this request is about"; teaching all fourteen that it might now hold
something granting nothing is fourteen chances for one of them to be wrong.

Two doors issue it. The identity code flow proves the address directly. And
every existing journal sign-in — `/api/auth/verify`, `/api/auth/link`,
`/api/contacts/confirm` — issues one alongside the journal session, because
proving an address for one journal proves the address. That second door is what
makes the feature reach people who already read this site with no new flow to
discover, and it is safe because an identity opens nothing on its own.

`resolveAccess(username)` in `lib/auth/handshake.ts` is the one place that turns
an identity into an answer about a particular journal, and the answer is
deliberately thin: **an address, not a permission**. Everything deciding what an
address may do is unchanged and still runs per request — `journalReader` asks
`hasReadGrant`, `isOwner` reads `owner.email`, `isPersonOnWith` reads `people:`.
A year-old identity therefore opens exactly what its holder is entitled to
today.

Not in `proxy.ts`: Next's own documentation says proxy runs on every route
including prefetched ones and must not do database work
(`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:29`).

**Changed during implementation.** The design had an identity mint a
per-journal `guest` session, kept `parent_id` so revocation could cascade, and
added a `POST /api/auth/handshake` route plus a client component to materialise
it. It was dropped. Every gate re-derives access from the address on each
request anyway, so the minted session saved no work — one indexed `sessions`
lookup either way — and existed only to create rows a revocation then had to
chase. Removing it also makes revocation stronger: an identity has nothing
downstream of it to outlive it. The migration keeps only `public_id`.

An owner's `edit` credential was considered and rejected. The handshake mints a
role, never write power; `isOwner()` still decides every write per call.
Decision 24 is untouched.

### B411 — the signed-in home view

Signed out, `/` is today's landing, unchanged. Signed in: your journals grouped
by how you got in — reusing `ViewerTrip.through`'s vocabulary so the panel and
the gate keep one word for one fact — then public journals, then the agent
block with the B283 handover for journals you own, then your devices with a
revoke per row.

`GET /api/v1/me/home` serves the personal half as JSON so B412 can cache it
apart from the shell, and authenticates on `fs_identity` alone.

One refactor makes this small rather than large: `resolveViewer()` reads the
cookie itself and so cannot be asked about an arbitrary address. Split out the
part that takes an email and keep `resolveViewer` as the wrapper, so one
resolver serves `/<user>/me` and the cross-journal loop. A second
implementation drifting from the first is exactly how B41 happened.

Revocation belongs to the person whose credential it is, on this page. Not to
journal owners: an identity spans journals, so revoking it from one owner's
page would sign the reader out of another owner's journal. Revoking the *grant*
is the right tool there and already exists.

### B412 — an identity-keyed PWA cache

`public/sw.js` keeps everything in two caches keyed by URL and by nothing else.
B330 is already filed about that for `story.json`. The home view makes it
sharper: a URL whose content is the list of private journals one person may
open.

Split private from shared rather than making the shared cache smarter. `/` is a
shell with no personal data and stays cacheable. The personal half is kept in
`personal-<id>`, where `<id>` is the opaque `public_id` — not the token, which
is httpOnly and which a service worker cannot read. The id is mirrored into
IndexedDB so a cold offline open knows which cache to serve. Sign-out and a
`401` both purge every `personal-*`.

Prefetching journal pages for offline reading was considered and deferred: it
would put private content in the shared `runtime` cache and force that to be
identity-keyed too.

Known limit, to be written into the worker's own comment: an offline device
still shows its cached journal list after the identity is revoked elsewhere,
until it next reaches the network. Names only, no content.

## Not in this design

Push notification testing. It is B106, an OPS engagement: no VAPID keys have
ever been generated anywhere, it needs a real phone over HTTPS, and its
deliverable is findings plus B68 and B82 confirmed or contradicted. It cannot
be designed, only run.
