# Persona: guest-established

**Role-lifecycle axis.** An approved guest, holding either a session cookie
or a year-long identity cookie (AGENTS.md: `fs_identity`). Reads the
journal's `guest` trips; never writes.

**Wants:** to check for a new update — a fresh day, a new photograph — and
to read it in their own language if the journal ships one. Good persona for
proving locale switching and the reader-facing weather/reaction UI, since
they touch nothing an owner or buddy would.

**Knows:** how to sign back in (identity cookie or a fresh code) and which
trips they were let into. Nothing about the owner's editing surface.
