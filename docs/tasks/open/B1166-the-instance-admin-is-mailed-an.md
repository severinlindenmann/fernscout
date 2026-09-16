---
id: B1166
title: the instance admin is mailed an agent code it can never redeem
type: ISSUE
priority: medium
complexity: low
area: auth, admin
found: "2026-09-09T20:03:00Z"
---

# B1166 — the instance admin is mailed an agent code it can never redeem

## Why

`POST /api/auth/request` accepts the instance admin address for **any**
journal. `app/api/auth/request/route.ts:366` says so in as many words:

```ts
// The instance admin owns every journal here (B480), so a code for any of
// them is theirs to ask for on the same footing as the owner.
const isOwnerOrAdmin = user.owner.email === address || isAdminEmail(address);
```

`POST /api/auth/verify` does not. `agentScope`, at
`app/api/auth/verify/route.ts:204`, asks only:

```ts
const owner = getUser(username)?.owner.email;
if (!owner || owner !== email.trim().toLowerCase()) {
  return { ok: false, why: "an agent code with no trip on it, for an address that is not the owner" };
}
```

`isAdminEmail` is not imported into that file at all. So the admin is issued a
code, the code is mailed, and redeeming it is a `401 invalid_code` — and,
because that refusal is deliberately uniform, the caller is told nothing. The
only place the truth appears is a `console.warn` in the server's journal.

Found driving B1136 against the live instance: `agent@fernscout.ch` is
`FERNSCOUT_ADMIN_EMAIL` on fernscout.ch, a code for `armtest-a` was mailed and
delivered, and the exchange was refused with the line above in
`journalctl -u fernscout`.

Two costs. The smaller one is that B480's promise — one address that answers
`isOwner` on every journal — is half true: it holds for `isOwner` and for
asking for a code, and not for the one step that turns either into something
an agent can use. The larger one is the shape of the failure. `issueCode`
revokes every live code for the address before writing the new one, so an
admin asking for a code on a journal **kills the code the actual owner is
holding** and receives one that will not work. That is a way to lock an owner
out of their own journal for as long as somebody keeps asking.

## Work

- Decide first whether the admin should be able to hold an agent token at all.
  There is a real argument that it should not: `/admin` reads a cookie and
  never a bearer token precisely because an instance-wide question must not be
  answerable by one journal's session, and an admin agent token is an
  instance-wide *write* credential in a clipboard. If that is the answer, the
  fix is at the other end — `request` stops accepting `isAdminEmail`, and the
  admin signs in as a person the way `/admin` already makes them.
- If the admin should hold one, `agentScope` gets `isAdminEmail` beside the
  owner comparison, and the two routes agree. One import and one `||`.
- Either way, the revocation is the sharp edge and is worth its own line:
  `issueCode` revoking the owner's live code on behalf of a request that can
  never be redeemed is wrong under both answers.
- Whichever way it goes, `test/` gets the case — request and verify asked the
  same question about the same address, with the answers required to match.

Not doing here: anything about `/admin` itself, or about `isOwner`.

## Acceptance

- A test that asks `request` and `verify` about the instance admin on a
  journal it does not own by `config.json`, and fails if the two disagree.
- With `FERNSCOUT_ADMIN_EMAIL` set, either the admin can complete
  request → verify → an authenticated call on any journal, or it is refused at
  `request` with a status that says so — not mailed a code that 401s.
- Asking for a code that cannot be redeemed no longer revokes a live code
  belonging to somebody who can redeem it.
