# MCP — what is implemented, and what is not

The Model Context Protocol server at `/api/mcp`. This document exists because
the interesting part of an MCP deployment is not the tools — it is the
authorisation story, and ours is deliberately not the one the specification
describes. **Read the compliance section before you claim this server is
spec-compliant, because in one named respect it is not.**

Implemented against protocol revision **2025-06-18**.

---

## What it is

One HTTP endpoint. JSON-RPC 2.0 over POST. Five tools.

| | |
| --- | --- |
| Endpoint | `POST /api/mcp` |
| Transport | **Streamable HTTP** (SSE-as-a-transport is the legacy 2024-11-05 shape and is not implemented) |
| Protocol version | `2025-06-18`; the `MCP-Protocol-Version` header is also accepted as `2025-03-26` or `2024-11-05` |
| Session | **None.** No `Mcp-Session-Id` is issued, so there is nothing to resume, expire or DELETE |
| Auth | Bearer token — the same agent token `/api/auth/*` issues |
| Metadata | `GET /.well-known/oauth-protected-resource` (RFC 9728) |

Turned off with the rest of the `auth` capability. With it off the endpoint
answers `404 auth_disabled` rather than a permanent `401`: off means absent,
not broken (ROADMAP §1.1).

### The tools

| Tool | Reads | Writes |
| --- | --- | --- |
| `list_trips` | every trip in the journal, private ones included | |
| `get_day` | one published day, as its markdown | |
| `search_entries` | full text across the journal, private trips included | |
| `list_drafts` | what is waiting for a person, and which of it nobody lived | |
| `create_day` | | **one draft** |
| `set_journal_features` | | **the journal's capability switches** |
| `set_journal_profile` | | **what the journal says about itself** — title, tagline, languages, display currencies, whether it is listed. Never `owner.email`, never `baseCurrency` |

Read tools were built first, which is the order the roadmap asks for and the
order that makes sense: an agent that cannot read the journal has no business
writing to it. The table is the shape of the surface rather than a complete
list — `lib/mcp/tools.ts` is, and it is the only place that cannot go stale.

**`tools/list` is filtered by capability.** A tool whose feature is switched
off for this journal is absent from the list rather than offered and then
refused — the invite tools were advertised to journals with contacts off until
B183. The handler's own check stays, because a client may hold a list it
fetched earlier; the filter is honesty, not enforcement.

### `create_day` writes a draft. There is no second tool.

There is no `publish` tool, no `status` argument, and no header that changes
this. The file gets `status: draft` in its frontmatter and every reading path
in `lib/entries.ts` filters it out. A person removes the line.

This is not a default that can be overridden; it is the only behaviour that
exists. One hallucinated memory in front of somebody's family is unrecoverable,
and no token lifetime, prompt or review process substitutes for a human hand on
the last step.

### Idempotency, because agents retry

`create_day` accepts an `idempotency_key`. The first success under a key is
replayed for every repeat, with `replayed: true` in the structured result.

**It is in-memory and per process.** It survives the retry that happens seconds
after a dropped response — which is the case it exists for — and it does not
survive a restart, and on a multi-process deployment each process keeps its
own. That is stated rather than hidden because the durable guarantee underneath
it is the one that actually matters: `createDraft` refuses to overwrite an
existing file, so the worst a lost idempotency record can produce is a
`409`-shaped tool error, never a silently replaced entry.

---

## Compliance, honestly

### What the specification says about authorisation

MCP's authorisation specification makes an MCP server an **OAuth 2.1 resource
server**. A client discovers the resource's metadata (RFC 9728), finds the
`authorization_servers` it names, discovers *those* (RFC 8414), registers
dynamically if it must (RFC 7591), and runs an authorization code flow with
PKCE in the user's browser. The token the client ends up with is audience-bound
to this resource, and the resource server validates that binding.

### What this server actually does

It validates bearer tokens **it issued itself**, through `/api/auth/request`
and `/api/auth/verify`: a six-digit code to the address that owns the journal,
exchanged over HTTPS for a token that writes for seven days and is scoped to
exactly one journal.

| Requirement | Status |
| --- | --- |
| Streamable HTTP transport | ✅ implemented |
| `Origin` validated against DNS rebinding | ✅ same-origin, localhost, or no `Origin` at all |
| RFC 9728 protected-resource metadata published | ✅ at both URL forms the RFC constructs |
| `WWW-Authenticate` on `401` names the metadata URL | ✅ per RFC 9728 §5.1 |
| Token validated as issued **for this server** | ✅ trivially — it is a row in this server's own table, hashed, with an owner and an expiry |
| Tokens are never accepted from another issuer | ✅ there is no other issuer |
| **Client tokens never forwarded downstream** | ✅ — see below |
| **A separate OAuth 2.1 authorization server** | ❌ **not implemented** |
| Authorization code flow + PKCE | ❌ not implemented |
| Dynamic client registration (RFC 7591) | ❌ not implemented |
| `/.well-known/oauth-authorization-server` | ❌ not published, because there is nothing to describe |

**So: this is a compliant Streamable HTTP MCP server with a non-standard
credential.** It is not an OAuth 2.1 deployment and it does not claim to be.
`authorization_servers` is *absent* from the metadata document rather than
pointed at something invented — a client that requires the OAuth flow learns
that from a document before it starts, instead of failing halfway through a
dance that was never going to finish.

### Why it is built this way

The token infrastructure already existed and is the thing decision 24 is built
on: two session classes, obtained separately, not interchangeable. An agent
token arrives in `Authorization: Bearer` and nowhere else; a guest session
arrives in a cookie and nowhere else, and `resolveSession(token, "agent")`
refuses the wrong class before asking what it can reach. Bolting an
authorization server onto that would add a browser redirect flow, a client
registry and a second issuer to a system whose entire premise is that one
person hands one credential to one agent.

It is the right trade for a self-hosted journal and the wrong one for a
multi-tenant product. **If this ever becomes a hosted service, the authorization
server is the first thing to build**, and the seam is already in the right
place: `lib/mcp/http.ts` has exactly one function that turns a request into a
`Session`, and everything downstream of it is written against that type.

### The rule that is not negotiable

> The MCP server **MUST NOT** pass through the token it received from the MCP
> client to any downstream API.

Honoured, and cheaply: **there is no downstream.** Every tool in
`lib/mcp/tools.ts` reads or writes the filesystem. No handler makes an outbound
HTTP request, so there is nothing a token could be attached to. If a tool ever
needs a third-party API, it must obtain its own credential from the environment
and must not see the caller's — the token never leaves `http.ts`, which is the
structural reason this stays true rather than a comment asking someone to be
careful.

### Scoping

A tool's arguments never include a username. The journal is decided entirely by
the token's `owner`, and a `trip` argument shaped like another journal's ref is
refused by name rather than resolved. That is why "a token for one journal
cannot reach another" is a property of the design and not of the validation:
there is no expressible request that asks for someone else's content.

---

## Connecting a client

```
Endpoint:  https://<your-domain>/api/mcp
Transport: Streamable HTTP
Header:    Authorization: Bearer fs_agent_…
```

Get the token first, as a person:

```bash
curl -X POST https://<domain>/api/auth/request \
  -H 'Content-Type: application/json' \
  -d '{"user":"<username>","email":"<the owner address>","kind":"agent"}'
# a six-digit code arrives by email; it lasts ten minutes

curl -X POST https://<domain>/api/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"user":"<username>","email":"…","code":"123456","kind":"agent"}'
```

A client that insists on completing OAuth discovery will not be able to connect,
by construction. Clients that accept a manually supplied bearer token will.

### Exercising it by hand

```bash
TOKEN=fs_agent_…
POST() { curl -sS -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d "$1"; }

POST '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
POST '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
POST '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_trips","arguments":{}}}'
```

### Local development, with no accounts anywhere

```bash
DATABASE_URL=sqlite:./dev.db \
SESSION_SECRET=dev-secret \
AUTH_DEV_CODE=123456 \
npm run dev
```

with `features.auth.enabled` and `features.mail.enabled` (transport `file`) on
in `content/config.json`. The code is fixed at `123456` and the mail is written
to `content/<user>/mail/`, so the whole flow runs on a laptop on a train.

---

## Deliberately not built

- **`attach_media`.** Photographs do not arrive through an API. They arrive
  through `npm run ingest`, which reads EXIF for time and place, resizes, strips
  every scrap of metadata from what gets served, and writes the gallery
  frontmatter. An upload tool would be a worse version of that, and it would
  quietly publish GPS coordinates of people's front doors.
- **`set_costs`.** Costs live in entry frontmatter and in `costs.md`. Editing an
  existing file through an agent is a different and much sharper risk than
  adding a new one — it can destroy writing rather than merely add to it — and
  it needs a review path of its own before it gets a tool.
- **A server-initiated SSE stream.** Nothing here is long-running and nothing
  pushes. `GET /api/mcp` answers `405`, which is what the transport
  specification says a server with no such stream must do.
- **JSON-RPC batching.** Removed in 2025-06-18. An array is refused by name
  rather than half-answered.
