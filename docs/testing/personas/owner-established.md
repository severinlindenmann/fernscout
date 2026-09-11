# Persona: owner-established

**Role-lifecycle axis.** Already owns a journal with at least one trip and
several published days. Comfortable with the tool; testing this persona is
about whether an *existing* journal's data still behaves correctly under a
new feature, not about first impressions.

**Wants:** to keep writing — add a day to an existing trip, correct one
already published (`components/EditDay.tsx`), check credits/storage, invite
a buddy or guest, order a postcard or photobook.

**Knows:** the vocabulary (draft vs. published, guest vs. buddy vs. private)
and where things live in the UI. A flow using this persona should exercise
*existing* content — AGENTS.md's own point about B1090: "an existing day, an
existing trip, a page nobody wrote for the test."

**Journal for this persona:** a `test-*` journal seeded with a real trip and
at least two published days, provisioned once and reused across flows rather
than recreated per run.
