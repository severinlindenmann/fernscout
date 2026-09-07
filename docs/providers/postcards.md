# Postcard providers

What is built, what is deliberately not, and exactly what is needed to go live.

**Status: Stannp is wired and posts — but only when told to twice.** The
renderer, the batch CLI and the request builder all still work with no
credentials, and `dry-run` remains the default so a fresh clone needs no
account. B435 connected the client.

---

## What works today, with no account

```bash
npm run postcard -- --providers
npm run postcard -- --user <username> --photo <file.jpg> --message "..." --to recipients.json --from "Us"
npm run postcard -- --user <username> --photo <file.jpg> --message "..." --from-contacts --from "Us"
npm run postcard -- ... --guides     # adds trim guides, for proofing only
```

`--from-contacts` (B273) reads recipients from the contacts table instead of a
file: every `active` contact who ticked "send me a real postcard" and has
enough of an address to reach. It needs `CONTACTS_ENCRYPTION_KEY` set, the
same key the site decrypts postal addresses with.

Writes to `content/<user>/postcards/` (gitignored), per recipient:

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

### The two switches, and why there are two

```json
"postcards": { "enabled": true, "provider": "stannp", "live": false }
```

`provider` says who prints. `live` says whether anything is actually posted,
and **absent means no**. Every request Stannp receives carries `test=true`
until an operator sets it, which makes the card render for real — same
composition, same trim, a sample PDF you can open and inspect — and dispatches
none of them. It is free.

That is deliberately not a per-request argument. A caller who *can* ask for a
live send is a caller who can ask for one by mistake, and the whole shape of
`lib/postcard/send.ts` is about making the expensive thing unreachable rather
than merely discouraged. The ledger ref records which happened: a test render
is `stannp-test:<id>`, and only a real dispatch is `stannp:<id>`.

`/api/health` prints which of the three states the instance is in — dry-run,
stannp-in-test, stannp-live — beside the Stripe note that exists for exactly
the same reason.

**An order still spends the journal's own credits in test mode.** Branching the
money code so that test sends are free would be putting a condition on the one
path in this codebase that must not have a surprising one; the operator refunds
their own instance's play money instead.

### The corrected field table — B435

Three things had drifted in the eighteen months nobody was calling the builder.
Each has a first symptom that is a ruined card rather than an error:

| Was | Is | What the mistake costs |
| --- | --- | --- |
| `https://eu.stannp.com/api/v1/postcards/create` | `https://api-eu1.stannp.com/v1/postcards/create` | Nothing sends at all |
| `recipient[town]` | `recipient[city]` | An unrecognised field is dropped in silence — the card posts with no city on it |
| *(unset)* | `padding=0` | They lay a white border over art rendered to the bleed |

- **Auth:** HTTP basic, the key as the username and an empty password
- **Files:** `front` and `back` as two separate PDF parts, never the two-page
  card — Stannp composes it and has no way to be told which page is which side
- **Response:** `{ success, data: { id, pdf, cost, status } }`. `pdf` is the
  sample to look at

### To go live

1. Create a Stannp account and add credit. `STANNP_PUBLIC_KEY` is for their
   client-side preview widget and is not used here.
2. Set `STANNP_API_KEY` in the environment. Never in a config file — it can
   spend money.
3. Set `provider: "stannp"`, leave `live` alone, and order a card to yourself.
   Open the sample PDF the response carries: check the trim, the address block
   position and the photograph's sharpness. `GET
   https://api-eu1.stannp.com/v1/accounts/balance` before and after is the
   honest proof that nothing was charged.
4. Only then `"live": true`, and send one card to yourself.
5. **Look at the printed card before sending any to family.** Colour, crop and
   the address position cannot be checked on screen. That engagement is B437.

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
| Recipients from the database | Done — `--from-contacts` (B273). A JSON file (`--to`) stays as the fallback |
| PNG previews | The PDF is the artefact; rasterising it needs an image library, and every viewer already renders PDFs |
