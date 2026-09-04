# W23 — The agent is the editor

**Roadmap:** G1, G4, G7, decision 24 · **Depends on:** W02, W06, W22 · **Amends:** W08, W18

> **The frontend has no editing UI, and never will.** Reading happens in a
> browser; writing happens through an agent holding a token. That is not a gap
> to be filled later — it is the product.

## Why this is a decision, not a shortcut

Committing to it removes an enormous surface: no WYSIWYG, no upload widget, no
draft manager, no media library, no permissions UI for editing, no mobile
editor. All of that is where a project like this normally dies.

What replaces it is one markdown document an agent reads, plus an API. The
differentiator in §7 of the roadmap stops being a claim and becomes the only
way the thing works.

## Naming: `documentation.txt` first, `llms.txt` optional

**Decided: the primary document is `/documentation.txt`.** It is named for the
person who reads it, not for the machine class that consumes it, and it is the
link an owner hands to their agent.

◆ **A filename is not a crawling control, and it is worth being blunt about
that.** Anything served at a URL can be fetched by anything that knows the URL.
Renaming away from `llms.txt` avoids being *harvested by convention* — bots that
speculatively probe `/llms.txt` on every domain — but it does not make the
document private. What actually keeps it out of search results:

| Mechanism | Effect |
| --- | --- |
| `X-Robots-Tag: noindex` on the doc routes | Keeps it out of search indexes. **This is the one to use.** |
| `robots.txt` `Disallow` | Stops well-behaved crawlers — but some agents honour robots.txt too, which would block the exact reader this is written for. **Don't.** |
| Filename choice | Avoids speculative probing. Nothing more. |

So: `documentation.txt` served with `noindex`, no `robots.txt` rule, and no
pretence that it is secret. It documents an API whose write path needs a token;
the document being readable costs nothing.

### `llms.txt` as an opt-in alias

`llms.txt` (<https://llmstxt.org>) stays available behind a server-config flag,
default **off**, for anyone who wants convention-based discovery. When on, it is
a thin file whose file list points at `documentation.txt` — one source of truth,
two doors.

## What the convention gives us anyway

Even under a different filename, the llmstxt.org structure is worth following,
and two of its rules fit this project unusually well:

- **Structure**: an H1 with the site name, a blockquote summary, optional
  markdown sections, then H2-delimited *file lists* — each entry a markdown
  link, optionally followed by `:` and a note.
- **Path scoping**: a file covers the URLs beneath it, and the most specific one
  wins. That maps straight onto W22 — an instance-level `/documentation.txt` and
  a per-user `/<username>/documentation.txt`.
- **`.md` alternates**: serve a clean markdown version of each page, advertised
  via `<link rel="alternate" type="text/markdown">`.

◆ **`llms-full.txt` is not in the spec.** It is a habit some documentation sites
picked up. Don't ship it as though it were standard.

◆ **The `.md` alternates are nearly free here, and that is the elegant part.**
The site's content already *is* markdown on disk. Serving
`/<user>/day/<slug>.md` hands back the source file, so the whole site becomes
agent-readable for the cost of a route handler — no rendering, no conversion,
and no drift between what a reader sees and what an agent reads.

## What gets served

| URL | What |
| --- | --- |
| `/documentation.txt` | Instance level: what this is, which users exist, where the API lives |
| `/<username>/documentation.txt` | That user's trips, their `.md` alternates, their write endpoints |
| `/agent.md` | **The guide.** Authenticate, post a day, attach photos, set costs — with worked examples |
| `/<username>/day/<slug>.md` | The entry's markdown source |
| `/<username>/trips/<id>.md` | Trip frontmatter and intro as markdown |
| `/openapi.json` | The machine contract for the same API |
| `/llms.txt` | Optional alias, off by default, pointing at `documentation.txt` |

All doc routes send `X-Robots-Tag: noindex`. Every HTML page gains
`<link rel="alternate" type="text/markdown">`.

`/agent.md` is generated from the live route table and the OpenAPI document, not
hand-written prose kept in a drawer. A guide that drifts from the API is worse
than no guide — it sends an agent confidently down a path that no longer exists.

## Auth: two token classes, deliberately decoupled

The same person can hold both, obtained separately. That decoupling is the
point: the owner reading the site on their phone should not be carrying a
credential that can rewrite it.

| | **Agent token — write** | **Guest token — read** |
| --- | --- | --- |
| Holder | The owner, through an agent | Family and friends |
| Transport | `Authorization: Bearer …`, from an agent or CLI | httpOnly cookie, in a browser |
| Lifetime | **7 days** | **up to 365 days** |
| Scope | `write:content` on **one** username | read, bounded by access grants (W10) and visibility (W09) |
| Obtained | `POST /api/auth/agent/request` → code by email → `POST /api/auth/agent/verify` → token | magic link or one-time code by email |
| Revocation | listed with last-used, revocable instantly | same |

### The flow the guide describes

```
POST /api/auth/agent/request   { "email": "you@example.com" }
  → 202 always. A code goes out only if that address owns content here.

POST /api/auth/agent/verify    { "email": "…", "code": "123456" }
  → { "token": "fs_agent_…", "expires": "…", "scope": ["write:content"],
      "username": "severin" }
```

### Security, because this mails a route to write access

1. **The token is never emailed.** What goes by email is a short-lived
   single-use code (10 minutes), exchanged over HTTPS for the token. Email is
   not a secure channel and should not be asked to carry a bearer credential.
2. **Only existing owners.** There is no self-registration on this endpoint. An
   address that owns no content gets the same `202` and no mail — no
   enumeration.
3. **Scoped to one username** (W22). An agent token can write that user's
   content and nothing else, ever.
4. **Rate limited** on both endpoints, per address and per IP — reuse
   `rateLimitFor()` from `lib/rateLimit.ts`.
5. **Visible and revocable.** Every live agent token appears in the owner's
   admin view with issue time, last use and a revoke button. Seven days is
   short, but "I pasted it somewhere" needs an answer that isn't "wait".
6. **Writes are drafts** (G7). An agent-created entry lands as
   `status: draft` and a human publishes it. One hallucinated memory in front
   of family is unrecoverable, and no token lifetime fixes that.
7. **Never in a browser.** Agent tokens are rejected if presented as a cookie;
   guest cookies are rejected as bearer tokens. Two classes, two channels, no
   crossover.

### The guest side, in the UI

The only auth the frontend itself offers. A small **"Sign in"** control in the
menu bar → email → magic link or one-time code → a long-lived read-only
session. It exists to unlock private trips and guests-only costs (W09), and to
tie a reader to their contact record for digests (W10, W11).

The owner can request one of these for themselves, and it grants exactly the
same read-only rights as anyone else's. Editing is not reachable from a browser
even when the owner is signed in.

## Alternative transport: MCP

Everything above is also exposed over MCP (W18/G5), which for agents that speak
it is a better fit than a markdown guide plus REST. Same auth model, same
scopes, same draft rule. `/documentation.txt` advertises the MCP endpoint so an agent
can discover it and choose.

MCP does not replace `/agent.md`: an agent with only a fetch tool must still be
able to read one document and get to work.

## Acceptance

- [ ] `/documentation.txt` follows the llmstxt.org structure; `/<user>/documentation.txt` resolves and is the more specific one
- [ ] All doc routes send `X-Robots-Tag: noindex`; no `robots.txt` rule blocks them
- [ ] `llms.txt` is absent by default and appears only when the server config enables it
- [ ] `/agent.md` is generated from the route table, and a test fails if it drifts from OpenAPI
- [ ] Every HTML page advertises its `.md` alternate; `/<user>/day/<slug>.md` returns the source
- [ ] `.md` alternates respect visibility — a private trip's markdown is not readable (extends the W09 enumeration test)
- [ ] An agent can go from `/documentation.txt` to a published day using only documented calls, with **no editing UI involved**
- [ ] Agent token: 7 days, one username, `write:content`, rejected as a cookie
- [ ] Guest token: up to 365 days, read-only, rejected as a bearer token
- [ ] Requesting a token for an address that owns nothing returns 202 and sends no mail
- [ ] Both endpoints rate limited; codes single-use and 10-minute
- [ ] Agent-created entries land as drafts and cannot self-publish
- [ ] Revoking a token stops the next request
- [ ] Whole flow testable locally: codes to `./mail/`, `AUTH_DEV_CODE` for tests
