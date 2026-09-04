# W24 — Landing page

**Depends on:** W22 (routing), W23 (the flow it explains) · **Wave F**

## Goal

A stranger arrives at the bare domain and, within a screen, understands what
this is, how writing works, and can click into a live example.

## Who it is actually for

Worth being precise, because it changes the copy: **family never see this page.**
They arrive at `/severin/day/hoi-an` from a link in an email. The landing page
serves the other audience — someone evaluating the project, deciding whether to
self-host it, or working out what "the agent is the editor" means in practice.

So it can assume mild technical literacy, and should not spend its first screen
explaining what a travel blog is.

## Where it lives

Interacts directly with W22's `defaultUser`:

| Server config | `/` | Landing page at |
| --- | --- | --- |
| No `defaultUser` (multi-user default) | the landing page | `/` |
| `defaultUser` set (single-user self-host) | that user's trip site | `/welcome` |

Always reachable at `/welcome`; `/` redirects there when it isn't serving a
user. One canonical URL, so it never competes with a user's site for the root.

## Content

Five blocks, in this order. Everything below the second is skimmable.

### 1. What this is

One sentence, then a short paragraph. The line to beat:

> **A travel journal your agent writes for you.**
> Your trips are markdown and photos in a folder you own. Read it in a browser;
> write it by handing an agent a link and an email address.

### 2. How to work with it — the actual flow

The most important block, and it should be concrete rather than a feature list.
Three steps, with the real URL visible and copyable:

1. **Give your agent this link** — `https://<host>/documentation.txt`
2. **Give it an email address you control** — the one that owns the content
3. **It authenticates and writes on your behalf** — a code arrives by email, you
   pass it back once, and the agent has a 7-day write token

Then the honest sentence that explains the whole design:

> There is no editing interface, and there won't be. The agent is the editor.

Include a short, real, copyable prompt someone can paste into their agent — that
single element will do more work than three paragraphs of explanation.

### 3. See it working

A prominent link to **`/example`** — a real user on this instance, with real
trips, that renders exactly like anyone else's. Not a screenshot, not a video: a
working site. It doubles as the thing a self-hoster copies to start (W22).

### 4. For readers

One line for anyone who followed a link here by accident: family don't need any
of this, and if a trip is private there's a **Sign in** control in the menu bar
(W23's guest session, read-only).

### 5. Self-hosting

Repo link, AGPL-3.0, and the shortest true statement of what it takes — a VPS,
Node and Caddy, one deploy script, and no database required for a public site
(W16, ROADMAP §2.2 and §2.3).

## Design

**Load the `frontend-design` skill before writing this.** It is the only page in
the project with no content of its own to carry it, and a templated-looking
landing page undercuts the claim that the project is worth cloning.

Constraints:
- Reuse the existing palette and type from `app/globals.css` and the W01
  envelope mark. This is not a separate brand.
- Must work with **no content at all** — a fresh clone with an empty `content/`
  still renders it, and that is exactly when someone is most likely to see it.
- Same accessibility bar as the rest of the site (W17/J2): 16px body minimum,
  ≥4.5:1 contrast, real focus states.
- Static. No client JS beyond what a copy-to-clipboard button needs.

## Acceptance

- [ ] Renders on a fresh clone with an empty `content/` directory
- [ ] `/` serves it when no `defaultUser`; `/welcome` when a `defaultUser` owns `/`
- [ ] The documentation URL is correct for the deployed host and copyable
- [ ] `/example` link resolves to a working trip site
- [ ] A copyable agent prompt is present and actually works when pasted
- [ ] Passes axe; readable at 320px wide
- [ ] No personal data — it is instance-level, not user-level (decision 23)
