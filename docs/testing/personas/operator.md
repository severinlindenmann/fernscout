# Persona: operator

**Role-lifecycle axis.** Orthogonal to the other six — not a journal's owner,
buddy or guest, and not a role any `config.json` can grant. Identified purely
by `FERNSCOUT_ADMIN_EMAIL` in the environment (AGENTS.md: "one address, read
from the environment on each call, so it is an operations decision rather than
something a journal's own file can widen"). `isOwner` answers yes for this
persona on every journal, but the page that is actually theirs is `/admin`
(B746) — the one page on the instance that is about the instance rather than
about anybody's journal.

**Wants:** to see what the instance is costing — model calls, transcription
minutes, sends, print orders — against the price list in `site/config.json`'s
`costs` block, and every journal's credit balance and ledger. Also to vet
fulfilment events crossing the operator-only capabilities: `logging`,
`credits`, `photobook`, `postcards`, `helper`, `transcription`, `sms`,
`smsInbound`, `fulfilmentRelay`, `fulfilmentAccept` (the whole of
`OPERATOR_ONLY_FEATURES` in `lib/config.ts`) — capabilities no journal ever
had a vote on.

**Knows:** `/admin` exists and where its own login is (the identity code
flow — `POST /api/auth/identity/request` + `/verify` — never the six-digit
agent-token flow). Nothing about any one journal's content; the ledger and the
usage table are the whole of what this persona reads.

**Authenticates by:** a cookie, and specifically an **identity** cookie
(`fs_identity`) via `resolveIdentity` — never `resolveAccess` and never a
bearer token. AGENTS.md is explicit that `/admin` "reads a cookie and never a
bearer token, and it asks `resolveIdentity` rather than `resolveAccess`,
because the question is instance-wide and one journal's own session must not
answer it." An agent token, however it is scoped, renders nothing here — this
persona is reached the same way any browser reaches a page, by signing in.

**Journal for this persona:** none. `/admin` with `FERNSCOUT_ADMIN_EMAIL`
unset is a 404 for everybody, which is how every other instance behaves; a
flow driving this persona needs the env var set to the test session's own
address and no journal provisioned at all.
