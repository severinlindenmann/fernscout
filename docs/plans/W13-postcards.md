# W13 — Postcard renderer + provider preparation

**Roadmap:** H6, H9, H10, H11 · **Depends on:** W06, W10 · **Wave G**

## Goal
Turn a photo and a message into a print-correct postcard, addressed from the
contacts list. **Go as far as possible without a provider account**, then stop
at a documented boundary.

## Why this comes before the photobook
A postcard is 148×105 mm at 300 DPI with bleed — **the photobook's print
pipeline at 1/50th the size**. Getting it right de-risks W14 on a surface small
enough to actually proof by post.

## Scope

### 1. Renderer + `dry-run` backend — the whole job, no network
- Front: photo, full bleed. Back: message, address block, stamp area, divider.
- Correct **trim, 3 mm bleed, safe area**; 300 DPI; CMYK where the target wants it.
- Output PNG + PDF to `./out/postcards/` so you can inspect and print a proof.
- Address block placed to postal spec (position matters — it's machine-read).

### 2. Send command (H11)
`npm run postcard -- --photo <p> --text "…" --to <contact|all-with-address>
--backend dry-run|stannp|swisspost`

### 3. Provider preparation — document, don't call
For **Stannp** and **Swiss Post PostCard Creator**: read the API docs, write the
request builders, the payload types, the error handling and the tests **against
recorded fixtures**. Everything except the credentialed call.
`docs/providers/postcards.md` records: endpoints, auth, payload shape, pricing,
limits, and exactly what account is needed to go live.

### 4. H10 — the Swiss Post spike, timeboxed
`abertschi/postcard_creator_wrapper` is **reverse-engineered, last commit Aug
2023**, does not support 2FA, and SwissID has hardened since. Establish whether
it can work at all in 2026 and what the free allowance is. **Abandon rather than
fix someone else's auth.** Stannp is the one that will still work from a hostel.

## Stop line
Stop when a real API key is the only thing missing. Do not create accounts.

## Acceptance
- [ ] Dry-run produces a print-correct PDF + PNG; bleed and safe area verified
- [ ] Batch over 5–10 contacts, each with the right address
- [ ] Provider request builders unit-tested against fixtures, no network
- [ ] `docs/providers/postcards.md` states exactly what's needed to go live
- [ ] H10 spike concluded either way, in writing
