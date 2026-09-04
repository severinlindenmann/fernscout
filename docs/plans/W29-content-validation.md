# W29 — Validate what comes in, and say what is wrong

## Why

`create_day` today accepts a title, a date and prose. Everything else — a
malformed cost line, a gallery item with no dimensions, a 40 MB photograph, a
video nobody will wait for — is either silently dropped at read time or
written and then rendered badly.

An agent cannot fix what it is not told.

## Frontmatter

One schema, in `lib/validate/entry.ts`, used by the REST route, the MCP tool
and `npm run ingest`. Errors are a **list**, not the first failure, and each
names the field, what arrived, and what was expected:

```json
{ "error": "invalid_entry", "problems": [
  { "field": "date", "got": "26-08-2026", "expected": "YYYY-MM-DD" },
  { "field": "costs[1].amount", "got": "\"twelve\"", "expected": "a number" },
  { "field": "lat", "got": 195, "expected": "-90 to 90" }
]}
```

Rules worth stating: `date` is a real calendar date; `time` is `HH:mm`;
`lat`/`lng` are in range and are both present or both absent;
`transportMode` is one of the seven; every cost has a label, a number and a
known category; `tags` are short and slug-like; the body is not empty.

## Media

| | Limit | Why |
| --- | --- | --- |
| image formats | JPEG, PNG, HEIC/HEIF, WebP | what sharp reads today |
| image size | 50 MB in, 8000px longest edge | a 100-megapixel scan is a mistake, not a photo |
| video formats | MP4/H.264, MOV, WebM | what ffmpeg is asked for |
| video length | 90 s | a travel journal, not a channel |
| video size | 200 MB in | |
| per day | 40 items | |

Rejections say the limit and the actual value, in that order.

## Work

1. `lib/validate/entry.ts` and `lib/validate/media.ts`, pure and tested.
2. Wired into the v1 route, the MCP tool and ingest.
3. `/agent.md` and `/documentation.txt` publish the limits, so an agent can
   check before uploading rather than after.

## Acceptance

- Every rule has a test with a bad value and a readable message.
- A valid entry is unchanged by validation.
- The limits in the documentation are generated from the constants, not typed
  a second time.
