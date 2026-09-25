---
id: BS02
title: A security ticket that has moved to completed and has no security path segment at all
type: SECURITY
priority: high
complexity: low
completed: "2026-09-01T00:00:00Z"
---

Body nobody should see. This is the trap the ticket names: `completed/` and
`testing/` are flat, so a SECURITY ticket here carries no `security` folder
in its path — only its `type:` says what it is.
