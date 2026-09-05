# One documentation site, instead of four pages that link to each other

*2026-09-05. Design for B470. Written before the work.*

## The complaint

> "it feels a bit not aus einem Guss … alle dokumente brings me to /docs where
> it is a mix of german and english and there is no back button to the main
> page there are two menus for anleitungen"

Every part of that is accurate, and none of it is cosmetic.

## What the audit found

Four surfaces, built independently:

| Symptom | Cause |
| --- | --- |
| No way back to the site from `/docs` | `/docs` contains **zero** links to `/`. It is a dead end. |
| `/docs` is half German | The guides section is translated; `Fernscout docs`, `How to Use`, `How to Host`, `How to Contribute` are hardcoded English literals in the page. |
| Two menus | The pill row is **anchors** (`#use`, `#host`, `#contribute`); the guides row is **pages**. Two different kinds of navigation, drawn identically, side by side. |
| Three doors from the landing page | `/docs`, `/docs/api` and `/docs/guide/guest` are all linked from `/`. |
| Nothing feels shared | Each page builds its own header. There is no docs layout. |

Underneath them is one cause: **two orthogonal axes were flattened onto one
page.** *Who are you* — reader, owner, buddy — and *what do you want* — use,
host, contribute, API. Stacking them means "How to Use" and "Für Lesende"
compete for the same person, and neither page can say which one to read.

The guides (B445) made this visible rather than causing it. They were added as
subpages beside a page that was already an index and a document at once.

## The shape

### A shell

`app/docs/layout.tsx`, which does not exist today. Every docs page gets:

- **← Fernscout**, back to the site. The same breadcrumb pattern B433 put above
  a journal's title, for the same reason: a subsection that cannot get home is
  a trap.
- The **language switcher**, once, in the top bar. It is currently inside
  `GuideNav`, which is why it looked like part of the guides rather than part
  of the site.
- **One nav** of the six pages, current highlighted.

The nav renders on inner pages **only**. On the hub the cards are the nav —
which is what removes the second menu structurally rather than tidying it away.

### `/docs` becomes a hub and nothing else

Two groups, named in the reader's language, the English one labelled as such:

```
Anleitungen · für Menschen geschrieben
  [Für Lesende]  [Für Tagebuch-Besitzer]  [Für Mitreisende]

Technische Dokumentation · auf Englisch
  [Hosting]  [Contributing]  [API]
```

Naming the language is the fix for "a mix of German and English". The mix is
real and is staying — the technical pages are read from `README.md` and
`CONTRIBUTING.md` at request time (B23: one source, never two), and their
audience reads English. What was wrong was not saying so, which left a reader
to conclude the translation was broken.

### Six pages, all working the same way

| Page | Source | Language |
| --- | --- | --- |
| `guide/guest`, `guide/creator`, `guide/buddy` | `docs/guides/<locale>/` | translated |
| `hosting` *(new)* | README's "What it looks like", "How to Host", and the day-entry example | English |
| `contributing` *(new)* | `CONTRIBUTING.md` sections, as today | English |
| `api` | the OpenAPI document, as today | English |

**"How to Use" is retired**, and it is the duplication the complaint is
pointing at. It says *hand this to your agent* — which the landing page says in
the dashed box, and which `guide/creator` now says at length. Its one piece of
content that lives nowhere else, the guidance that photographs need timestamps,
moves into the creator guide in all three languages.

### The landing page drops to one door

Today it links `/docs`, `/docs/api` and `/docs/guide/guest`. After: one
**Dokumentation** link to `/docs`, plus the guest-guide link inside the reader
card. That one stays because it is aimed — it is addressed to a particular
person at the moment they are confused, which is the opposite of a generic
docs link. `API-Referenz` leaves the footer; it is one click from the hub.

## Not doing

- `/agent.md` and `/openapi.json` are agent surfaces and do not change.
- The journal pages' own header does not change.
- No translation of the technical pages — see above.
- `/docs/api`'s content is untouched; it only gains the shell.

## Testing

- Every docs page renders the shell: a link to `/`, exactly one language
  switcher, and — on inner pages — exactly one nav.
- The hub renders no `#anchor` links, which is what "hub and nothing else"
  means in a form a test can check.
- `/docs` in German contains no English section headings; the only English on
  it is the group label that says the technical pages are in English.
- The retired `#use`, `#host` and `#contribute` anchors 404 or redirect rather
  than dangling — `test/docs-links.test.ts` already fails on a dead relative
  link, and the README links to `/docs`.
- `test/docs.test.ts` keeps guarding the README/CONTRIBUTING headings the new
  pages read; `section()` throws rather than rendering empty.

## The risk worth naming

`/docs` is linked from `README.md`, from the landing page and from
`documentation.txt`. Moving content off it breaks nothing at those entry
points — they all point at `/docs` itself, which continues to exist — but the
three anchors do disappear. Nothing in the repository links to them; the check
is `grep -rn "docs#use\|docs#host\|docs#contribute"`, run before the work and
again after.
