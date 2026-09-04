---
id: B260
title: The MCP resource advertises no authorization server, so a connector cannot get a token by itself
type: FEATURE
priority: medium
complexity: high
area: mcp
found: "2026-09-04T10:59:16Z"
superseded: B298 removed MCP from the codebase
---

# B260 — The MCP resource advertises no authorization server, so a connector cannot get a token by itself

## Why

> **Superseded, 2026-09-04.** B298 removed MCP entirely — there is no
> `lib/mcp/`, no `app/api/mcp/`, and no `/.well-known/oauth-protected-resource`
> to complete. The reasoning below is kept because the question it answers
> comes back the day MCP does: an RFC 9728 resource that names no authorization
> server leaves a connector with no way to obtain the token it is being asked
> for. Reopen this as a new capture against whatever ships then, rather than
> reviving an id that describes deleted code.

B259 established that the door for a chat client which cannot make arbitrary
HTTP calls is the MCP endpoint added as a connector. That door is half built.

`/.well-known/oauth-protected-resource` answers correctly and names the
resource, its scopes and its documentation — but carries no
`authorization_servers`, and `/.well-known/oauth-authorization-server` is
`404`. `POST /api/mcp` without credentials says:

```json
{"error":"invalid_request",
 "error_description":"Send an agent token as Authorization: Bearer <token>."}
```

So the RFC 9728 metadata tells a client it needs a bearer token and gives it no
way to obtain one. A connector can be made to work only by an owner pasting a
token in by hand — which is a token with seven days of write access to their
journal, travelling through a settings box, and it is the sort of thing people
paste into the wrong window. It also means the recommendation B259 has to give
an agent is "ask your owner to fetch you a credential", which is the shape of
instruction this project has otherwise been careful to avoid.

The reason this is not urgent: pasting a token does work, and an owner who has
Claude Code has a better door already. The reason it is worth capturing: it is
the difference between "add the Fernscout connector and sign in" and a manual
credential handover, for every reader who lives in a chat client.

## Work

Not decided. The shape is an authorization server this instance either hosts or
delegates to, discoverable from the resource metadata, issuing the same
`write:content` scope the endpoint already checks — so the code request and
verification an owner does today by email becomes the consent step of an OAuth
flow instead. Read the current MCP transport in `lib/mcp/` and
`docs/providers/mcp.md` before deciding, and check what the MCP specification
requires of a resource server versus what it leaves to the host.

Consider explicitly whether this instance should be an authorization server at
all. A journal is one person's folder on one VPS; hosting OAuth for it may be
more machinery than the problem deserves, and "paste a token, here is exactly
where to get one and what it can do" may be the honest answer instead. If that
is the conclusion, the outcome of this task is that sentence written down where
a connector's owner reads it, not an implementation.

## Acceptance

Either an MCP client can obtain write access to a journal without the owner
handling a token by hand, or the decision not to build that is recorded with
its reasoning, and the manual path is documented where somebody setting up a
connector will find it.
