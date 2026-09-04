# W30 — Uploading photographs and video

## Where we are

**There is no upload endpoint.** Not REST, not MCP. Media enters exactly one
way: `npm run ingest`, reading a folder on the same machine. An agent working
over the network cannot add a photograph at all.

Ingest accepts `.jpg .jpeg .png .heic .heif .webp` and video, so **HEIC works**
— sharp's libvips reads it, with a documented fallback when the prebuilt binary
cannot. It writes **one derivative at 2000px** and **keeps no original**.

That last part is the problem. A photobook page at 300 dpi needs roughly
2500×3500 for a full-page image; 2000px on the long edge is already short, and
the source is gone.

## What this adds

### 1. Keep the original

```
media/<day-slug>/01.jpg          the web derivative (unchanged)
media/<day-slug>/01.webp         a smaller modern one for browsers
originals/<day-slug>/01.heic     the file as it arrived, untouched
```

`originals/` is excluded from `export.zip`'s anonymous scope, served by no
route, and used by the photobook and postcard pipelines. A trip whose
originals have been deleted still renders; the book warns.

### 2. An upload endpoint

```
POST /api/v1/<user>/trips/<trip>/media
Content-Type: multipart/form-data
→ { "items": [ { "src": "/media/…/01.jpg", "width": …, "height": …,
                 "bytes": …, "original": true } ] }
```

Validated by W29 before a byte is written. Returns exactly the gallery block
the entry needs, so the agent pastes rather than composes.

### 3. Tell the agent what is accepted

`/agent.md` and `/documentation.txt` gain a table of formats and limits, and a
sentence that says plainly: **send the largest file you have**. The web only
ever sees a derivative; the original is what a printed book is made from, and
it cannot be recovered later.

## Work

1. `originals/` written by ingest and by the upload route.
2. The multipart route, with W29 validation and W28's size limits.
3. An MCP `add_media` tool taking base64 for small files and a URL for large.
4. WebP alongside JPEG, with `<picture>` in the gallery.
5. Photobook and postcard sources prefer `originals/`, fall back, and say so.

## Acceptance

- An agent with a token can upload a HEIC and get a gallery block back.
- The original survives; the derivative is ≤2000px; both are byte-identical
  across two runs of the same input.
- Uploading a 60 MB file is refused with the limit and the size.
- The photobook uses the original when it is there.

## Stop line

No image editing. No cropping, no filters, no re-encoding of the original.
