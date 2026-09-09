---
id: B755
title: A fresh clone gets this instance's costs and an env example missing six keys
type: CHORE
priority: high
complexity: low
area: config, docs
found: "2026-09-07T15:40:00Z"
merged: "2026-09-07T13:48:09Z"
completed: "2026-09-09T16:47:49Z"
---

# B755 — A fresh clone gets this instance's costs and an env example missing six keys

## Why

Two shipped files have drifted from the code, and both are read by somebody
who has just cloned this repository and has nothing else to go on.

**1. `site/config.json` ships this instance's own bill.** B746 added a `costs`
block and put real figures in it — `Hetzner VPS` at 5000 rappen and a line
naming `fernscout.ch` at 167. That is this machine's expense, in the file every
fork inherits, and it is wrong twice over: a fork has a different server or
none, and the label names a domain that is not theirs. The deployed instance
does not even read it (`FERNSCOUT_CONFIG` points at
`/var/lib/fernscout/config.json`, where the real numbers now live), so the
committed copy is *only* ever read by somebody else.

The per-model prices are the opposite case and should stay: Anthropic's
published rates are a fact about the provider, not about this instance, and a
fork calling the same model is billed the same.

**2. `site/config.json` lists 7 of the 17 capabilities.** `FEATURE_NAMES` in
`lib/config.ts` has seventeen; the shipped file names `mail`, `whatsapp`,
`auth`, `contacts`, `postcards`, `photobook`, `credits`. The ten missing —
`reactions`, `costs`, `push`, `signup`, `logging`, `addressLookup`, `weather`,
`analytics`, `helper`, `transcription` — default to off, so nothing is broken.
What is missing is the *menu*: the shipped config is the only place a
self-hoster discovers what this software can be asked to do, and ten of them
are invisible there.

**3. `.env.example` is missing six keys the code reads.** Diffed against
`lib/capabilities.ts`:

| Missing | Wanted by |
| --- | --- |
| `ANTHROPIC_API_KEY` | `features.helper` — B684 |
| `DEEPGRAM_API_KEY` | `features.transcription` — B686 |
| `ADDRESS_LOOKUP_API_KEY` | `features.addressLookup` |
| `CLOUDPRINTER_API_KEY` | postcards provider |
| `LULU_CLIENT_KEY`, `LULU_CLIENT_SECRET` | photobook provider |

Two more are read by the code and documented nowhere: `SITE_DIR`
(`lib/siteRoot.ts`, for a packaging layout that moves `site/`) and
`AUTH_DEV_CODE` (`lib/auth/index.ts:200`, which fixes the six-digit code for
end-to-end tests — a thing worth knowing about and worth warning about).

The helper key is the sharpest omission: `features.helper` is the capability
`/agent` runs on, and a self-hoster switching it on has no way to learn from
this file what to set.

## Work

- Replace the real `fixedMonthly` rows with placeholders that read as
  placeholders, and keep the model prices.
- Add the ten absent capabilities to the shipped `features` block, each
  `enabled: false`, carrying the options each one takes so the shape is
  discoverable.
- Add the six keys above to `.env.example`, in the sections they belong to,
  with the same "what it is for and why it is not in config.json" voice the
  file already uses. Add `SITE_DIR` and `AUTH_DEV_CODE` beside them.

**Not doing:** `site.credit`, `site.banner` and `defaultUser`. Those are also
this instance's own, and unlike the costs they are arguably what this
repository should ship — it is Fernscout's repository, `test/depersonalised.test.ts`
deliberately exempts `site/`, and changing them is a call for the owner rather
than a drift to correct. Raised here so the decision is recorded, not taken.

## Acceptance

- No line in `site/config.json` names this instance's server, domain or bill.
- Every name in `FEATURE_NAMES` appears in the shipped `features` block.
- Every variable in `lib/capabilities.ts`'s env lists appears in `.env.example`.
- `npm run verify` passes.
