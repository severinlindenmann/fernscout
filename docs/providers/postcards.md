# Postcard providers

What is built, what is deliberately not, and exactly what is needed to go live.

**Status: everything up to the account boundary is done.** The renderer, the
batch CLI and the Stannp request builder all work with no credentials. Nothing
calls a provider, because calling one needs an account — and that is where this
work package was told to stop.

---

## What works today, with no account

```bash
npm run postcard -- --providers
npm run postcard -- --photo <file.jpg> --message "..." --to recipients.json --from "Us"
npm run postcard -- ... --guides     # adds trim guides, for proofing only
```

Writes to `out/postcards/` (gitignored), per recipient:

| File | For |
| --- | --- |
| `<name>.pdf` | Two pages, front and back — the print-ready card |
| `<name>-front.pdf` | Front only — Stannp takes the sides as separate files |
| `<name>-back.pdf` | Back only |
| `<name>-stannp-request.json` | The request that *would* be sent |

### The print geometry, and why it is what it is

| | |
| --- | --- |
| Size | A6 landscape, 148 × 105 mm — the European standard, printed by everyone |
| Bleed | 3 mm on all four edges → media box 154 × 111 mm (436.54 × 314.65 pt) |
| Safe area | 5 mm inside the trim |
| Resolution | 300 DPI → a full-bleed photo must be **1819 × 1312 px** |
| Colour | RGB. See the CMYK note below |
| Boxes | `TrimBox` and `BleedBox` are declared — this is what makes a PDF *print-ready* rather than merely correct |

The back follows postal convention rather than taste: message left of a divider
at 72 mm, address block at the lower right where sorting machines read it,
stamp area upper right. Getting that wrong does not look wrong — it just gets
the card delivered late.

### Two warnings the renderer raises

Both describe failures that are invisible on a screen and obvious on paper:

- **`low-resolution`** — the photo cannot hit 300 DPI at this size. The demo
  photos are 1200 px, which prints at about 197 DPI and will look soft. Use the
  camera original, not a web-sized copy.
- **`message-truncated`** — the message is longer than the card. It says how
  many lines fit rather than silently cutting.

### On CMYK

The postcard pipeline emits **RGB**, which Stannp accepts. CMYK conversion is a
photobook problem (W14), where providers demand PDF/X with an embedded ICC
profile and reject RGB outright. A CMYK photo passed in here is embedded
unchanged and flagged.

---

## Stannp — the one to actually use

Official, documented, self-serve, international, and it will still work from a
hostel in month four.

- **Endpoint:** `POST https://eu.stannp.com/api/v1/postcards/create`
  (use the EU region for Swiss and European recipients — postage and data
  residency both point that way; a US region exists)
- **Auth:** API key
- **Built:** `buildStannpRequest()` in `lib/postcard/providers.ts`, unit-tested
  against fixtures with no network

### To go live

1. Create a Stannp account and add credit.
2. Set `STANNP_API_KEY`.
3. **Confirm the field names against Stannp's current API documentation.** The
   builder is written from their published API, but field names are the kind of
   thing that drifts, and the first send is the wrong moment to find out.
4. Send one card to yourself with `test: true`, then with `test: false`.
5. **Look at the printed card before sending any to family.** Colour, crop and
   the address position cannot be checked on screen.

---

## Swiss Post PostCard Creator — investigated, not used

Free postcards for Swiss customers, which is why it was worth looking at.

**Conclusion: not usable, and not worth fixing.**

- There is no official self-serve API. The only route is
  `abertschi/postcard_creator_wrapper`, a reverse-engineered client.
- **Last code commit August 2023**; repository untouched since November 2023.
- It does not support two-factor authentication, and SwissID has pushed 2FA
  hard since. Its issue history is a list of exactly this: anomaly detection on
  the token flow, "Swissid login failed", migrated endpoints.
- Even working, the free allowance is roughly **one card per week per account**.
  That is a pleasant weekly ritual; it is not a way to send ten cards.

Recorded in `swissPostStatus()` so the CLI explains itself rather than failing
mysteriously. Revisit only if Swiss Post ships a real API.

---

## Not built, and why

| | |
| --- | --- |
| Sending | Needs an account. The boundary this stops at. |
| Payments / checkout | Out of scope by decision 8 — this is a tool, not a shop |
| Recipients from the database | Comes with W10 (contacts). Until then, a JSON file, and the file stays as a fallback |
| PNG previews | The PDF is the artefact; rasterising it needs an image library, and every viewer already renders PDFs |
