---
id: B1225
title: get-token.sh interpolated its journal argument into an ssh command line running as root on the live instance
type: SECURITY
priority: high
complexity: low
area: .claude/skills/get-a-credential
found: "2026-09-10T05:01:00Z"
merged: "2026-09-10T05:01:21Z"
---

# B1225 — get-token.sh interpolated its journal argument into an ssh command line running as root on the live instance

## Why

Found by the commit security review on the B1206 merge, within the hour, and
fixed in the same session — this file is the record rather than the work.

`.claude/skills/get-a-credential/get-token.sh` took its second argument and
put it, unvalidated, into four places that cannot defend themselves:

```bash
ssh "$VPS_IP" "ls -t /var/lib/fernscout/mail/$JOURNAL/*.eml | head -1 | xargs -r cat"
```

That command runs **as root on fernscout.ch**. `example; rm -rf
/var/lib/fernscout` in the second argument would have run there. The same
argument was also concatenated into two JSON bodies — a `"` breaks out of the
string — and into a `/tmp` path, where `../` traverses.

Severity is bounded by who can call it: a script in this repository, invoked
by an agent or by the operator, not a network surface. It is filed as
`SECURITY` anyway because the blast radius is the whole live instance and the
argument is exactly the kind of value an agent copies out of a list it read
somewhere else.

## Work

Done. One check at the top, against `lib/users.ts`'s own `USERNAME_RE`
(`^[a-z0-9][a-z0-9-]{1,30}$`) — the set of names that can actually exist, so
nothing legitimate is refused and one check covers all four sites rather than
four quotings that each have to stay right forever. The base URL must now be
`live` or `http(s)://…`.

The comment at the `ssh` line says the quoting there is safe *because of* that
check, so the next person to relax it sees what it is holding up. The skill
says the same, in the paragraph a reader meets before the recipes.

## Acceptance

Confirmed by running the payloads rather than by reading the diff:

- `get-token.sh live 'example; touch /tmp/PWNED' agent` → refused, exit 64,
  and `/tmp/PWNED` does not exist.
- `get-token.sh live '../../../etc' agent` → refused.
- `get-token.sh live 'ex"ample' agent` → refused.
- `get-token.sh 'file:///etc/passwd' example agent` → refused.
- `get-token.sh live example agent` and `get-token.sh live test-elena cookie`
  both still return a credential, so the dash and the ordinary case survive.
- `npm run verify` green.
