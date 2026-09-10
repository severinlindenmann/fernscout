# The room decisions — owner's round of 2026-09-10

Intent as decided, before the work. Kept as the record; never corrected to
match what ships (docs/plans rule). The owner answered all fifty-two
proposals of the decision artifact ("Room Decisions",
https://claude.ai/code/artifact/9723692f-4d7d-44aa-ac1c-aba1621a2005) plus
one addition made in the same message. Tickets B1207–B1221 carry the work;
each names its decision ids.

## The owner's addition

**D53** — the header must say which journal is being edited, even while
one journal is the common case: the journal's name and its clickable path
("/severin"), linking to the journal.

## The answers, verbatim

D01: B — Clean App art direction (white surfaces, tighter radii,
whitespace, yellow only on the primary action). Room-scoped.
D02: A — own messages right-aligned in a quiet cream bubble; answers plain.
D03: B — text size S/M/L control, persisted.
D04: B — manual dark-mode toggle for the room.
D05: B — proposal fields stay open, two-column grid on desktop, clearer
card header.
D06: A — credit chip always in the header (hidden when the instance
charges for nothing); tap opens the account sheet.
D07: B — conversation ≈ total and month total in the chip's sheet, never
per turn in the thread.
D08: A — early low-credit warning (coral chip + one line with a buy link);
at-zero refusal links to purchase.
D09: B — minimal account sheet (balance + buy + storage); keys stay on
/me. (The D03/D04 display settings live in this same sheet — the only
home the decisions give them.)
D10: A — overflow ⋯ menu: language, account, bring-agent. (Start-over
would have joined it, but see D17.)
D11: A — "Eigenen Agenten anbinden" opens a bottom sheet: sentence, mint
button, ready prompt, link to /me.
D12: A — the sheet hands over a complete paste-ready prompt with one copy
button.
D13: A — auto-growing textarea; Enter sends, Shift+Enter breaks; on
phones return breaks and the button sends.
D14: A — filled yellow circular send button; "Ask" as text goes.
D15: A — full-size mic; recording turns the composer into a level meter
with time and stop.
D16: A — unsent text persists across reload (localStorage per journal).
D17: B — "Start over" removed entirely; the + covers it.
D18: A — server-curated situation chips (after save: publish / photo;
after publish: next day). Deterministic, no model call.
D19: A — streaming status lines from real tool activity while the model
works; the answer still arrives whole.
D20: A — every failure row carries "Nochmal versuchen" re-sending the
same sentence.
D21: A — simple lists and bold render in answers.
D22: B — a quiet time marker every ~10 minutes of conversation.
D23: A — identical duplicate proposals collapse to one (closes B1202).
D24: B — the desktop preview remembers the person's last open/collapsed
choice.
D25: A — preview title bar: day title + date, "Auf der Seite öffnen" for
published days, collapse control.
D26: A — a draft's preview header carries "Auf die Seite stellen",
opening the normal confirmation card in the conversation. Never a direct
publish.
D27: A — an accepted write scrolls to and briefly highlights the changed
passage in the preview.
D28: A — where a sheet remains on the phone it opens tall (≈92%). (The
tab bar of D39 covers files and preview; this applies to the sheets that
survive: bring-agent, account.)
D29: A — the whole room is a desktop drop target into the inbox, with a
full-window overlay while dragging.
D30: A — ⌘V pastes an image into the inbox.
D31: A — per-file thumbnails with progress rings during upload.
D32: A — after an upload while a day is under discussion, one chip: "Die
neuen auf den Tag legen?" — through the ordinary confirm.
D33: A — a camera button (capture) beside the picker on phones.
D34: A — tile long-press/right-click menu: attach to the current day,
discard — each opening the same confirmation proposals the conversation
uses, never a direct write.
D35: A — conversation titles cleaned server-side, falling back to the
day/trip touched.
D36: A — a search field in the history panel matching stored turns.
D37: none — no conversation delete.
D38: none — history stays a right modal on desktop.
D39: A — the phone gets a bottom tab bar: Chat · Dateien · Vorschau.
D40: A — a dismissible add-to-homescreen hint after the second visit.
D41: A — short vibration on an accepted write and record start/stop.
D42: A — ⌘K new conversation, ⌘/ focus field, Esc closes panes, a "?"
cheatsheet.
D43: A — the whole app caps at ~1680px, centered.
D44: A — a "Tage" tab in the history panel: the current trip's days with
Entwurf/online badges, each opening the preview.
D45: A — the opening shows trip progress with missing-date chips during a
running trip.
D46: A — opt-in evening WhatsApp/mail reminder on days with no entry
(supersedes B673's open question with a decision).
D47: A — a "Rückgängig" chip after each accepted text write; the server
keeps one prior version per day.
D48: A — a saved day with coordinates offers one "Wetter nachschlagen
lassen" chip — the documented server lookup, never a guess.
D49: A — a "+ Ausgabe" chip on the day context opening a prefilled cost
proposal.
D50: C — a 30-second scripted demo conversation viewable from the door.
D51: A — after publishing, the done-card carries the system share sheet.
D52: A — the old wizard page retires; add_photos points at the room's own
files pane; /agent/<user> redirects to /agent.

## Ticket map

| Wave | Tickets | Decisions |
| --- | --- | --- |
| 1 | B1207, B1208 | D01 D05 · D53 D06 D07 D08 D10 D17 D43 |
| 2 | B1209, B1210 | D09 D03 D04 · D11 D12 |
| 3 | B1211, B1212 | D13 D14 D15 D16 D33 · D02 D21 D22 D20 D18 D23 |
| 4 | B1214, B1215 | D24 D25 D26 D27 · D39 D28 |
| 5 | B1216, B1217 | D29 D30 D31 D32 D34 · D35 D36 D44 |
| 6 | B1213, B1218 | D19 · D45 D47 D48 D49 D51 |
| 7 | B1219, B1220, B1221 | D46 · D40 D41 D42 D52 · D50 |

Conflicts resolved at capture time: D17 B (remove start-over) wins over
D10's mention of it in the ⋯ menu; D39's tab bar supersedes the phone
sheets for files and preview, so D28's 92% applies to the sheets that
remain.
