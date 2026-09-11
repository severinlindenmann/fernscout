---
id: B1401
title: "The helper client's YAML parser stops at the first unsupported line and silently drops every key after it"
type: ISSUE
priority: high
complexity: medium
area: fernscout-helper, frontmatter parser
found: "2026-09-10T21:22:00Z"
merged: "2026-09-11T10:06:26Z"
---

# B1401 — The helper client's YAML parser stops at the first unsupported line and silently drops every key after it

## Why

**The diff lands in `fernscout-helper`.** Captured here because that repository
has no lane of its own.

`.claude/skills/shared/frontmatter.mjs`'s `block()` walks rows while the indent
matches (`:128`). A row it cannot follow — a block scalar (`text: |`), an
indentation shape it does not model — ends the loop, and the only trace is one
problem pushed after the fact (`:153-156`):

```js
if (at < rows.length) {
  problems.push({ line: rows[at].line, text: rows[at].text, why: "unexpected indentation" });
}
```

One row is named. **Every key after it is gone from `data`**, with nothing
saying so. Downstream that reads as absence rather than as a parse failure,
which is how `costs:` and `gallery:` were reported missing from days that
carry both — a validator telling somebody their photographs are not there.

Worse than a crash: a crash is a fact, this is a confident wrong answer about
somebody's own content. It is also the failure mode the client is least able to
detect, because the *shape* it returns is valid — a map with fewer keys.

## Work

In `fernscout-helper`:

- **Recover after a bad row.** Skip it, resync at the last indent that was
  making sense, and carry on — the same "collect problems, keep going" the map
  loop already does for a row with no colon (`:132-136`). One unreadable line
  costs one key, not the rest of the file.
- If full recovery is not cheap, the floor is that the parser must **say it
  stopped**: how many rows were not read, and that keys after line N are
  missing from the result, in the problem itself. A caller must never be able
  to mistake truncation for absence.
- Whoever calls this and reports "no costs / no photos" should distinguish
  *the file does not have it* from *this parser did not get that far* — a
  missing key after a parse problem is not a finding to report as missing
  content.
- Block scalars are the concrete trigger here. Supporting `|` and `>` may be
  the smaller fix than general recovery; check which before choosing.
- One check behind it: a frontmatter with a block scalar in the middle, and an
  assertion that a key after it is either parsed or explicitly reported as
  unread.

Nothing to change in this repository — this parser exists because the client
reads content off disk with no dependencies. Note for whoever picks it up:
`/content-model.json` is the *schema*, not a parser, so nothing on the server
side can substitute for this.

## Acceptance

- A day whose frontmatter contains a block scalar still reports its `costs:`
  and `gallery:`, or says plainly that parsing stopped and which lines were not
  read.
- No case where a key present in the file is reported as absent with no
  problem attached.
