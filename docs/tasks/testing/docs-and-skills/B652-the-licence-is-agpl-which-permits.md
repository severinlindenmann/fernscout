---
id: B652
title: The licence is AGPL, which permits a commercial competitor
type: DOCS
priority: high
complexity: medium
area: Licensing
found: "2026-09-07T05:08:19Z"
started: "2026-09-07T05:08:44Z"
merged: "2026-09-07T05:17:12Z"
---

# B652 — The licence is AGPL, which permits a commercial competitor

## Why

`LICENSE` is AGPL-3.0 and every statement of it across the repository agrees
(`package.json:5`, `README.md:162`, `CONTRIBUTING.md:66`, `TRADEMARK.md:11`,
`docs/ROADMAP.md` decision 3, `docs/branding/BRAND.md:177`, the
`landing.selfHostBody` string in three locales, and both imprints under
`site/legal/`). Consistent, and it does not do what the owner wants it to do.

AGPL is a copyleft licence, not a non-commercial one. Anyone may take
Fernscout, run a paid hosted service with it, and charge for it; their only
duty is to publish their modified source and not to call it Fernscout. The
owner's intent is the opposite: others self-host free and forever and may
contribute, but may not sell a competing service, while the owner may.

Two further gaps found alongside it:

- **No copyright notice anywhere.** Not in `LICENSE`, not in `README.md`, not
  in a source file. Copyright is automatic, but with nothing asserted,
  ownership is harder to state and infringement harder to pursue.
- **`CONTRIBUTING.md:66` grants the wrong direction.** Inbound-equals-outbound
  under a non-compete licence would license a contributor's code *to the owner*
  under that same non-compete — leaving the owner's own commercial product
  built on code the licence forbids the owner to sell. Under AGPL this is
  harmless; under Shield it is a trap that only surfaces the day somebody
  contributes.

## Work

Relicense to **PolyForm Shield 1.0.0** (polyformproject.org), verbatim, with a
`Required Notice:` line naming the copyright holder and a
`Licensor Line of Business:` line naming the hosted service.

- `LICENSE` — replace the AGPL text with the official Shield plain text.
- `package.json` + `package-lock.json` — `"license": "SEE LICENSE IN LICENSE"`.
  Shield has no SPDX identifier, so no id can be named there.
- `README.md`, `TRADEMARK.md`, `docs/ROADMAP.md`, `docs/branding/BRAND.md` —
  restate the licence and, where they claim it, drop "open source".
- `site/locales/{en,de,hu}.json` (`landing.selfHostBody`) and
  `site/legal/{en,de}.md` — same, and these are user-facing: the German
  imprint currently asserts "Open Source unter der AGPL-3.0" on the one page
  that exists to be legally accurate.
- `CONTRIBUTING.md` — replace the inbound-equals-outbound paragraph with a
  contributor grant to the owner that is unrestricted and relicensable, and
  add the matching line to the PR template.

**Not doing:** registering the trademark, adding a CLA bot, or per-file SPDX
headers (`CONTRIBUTING.md` forbids the last one and should keep forbidding it).

**What this cannot undo:** every commit already published stays AGPL. Anyone
may fork from the last AGPL commit and compete from it, permanently. The
change binds only what is written after it.

## Acceptance

- `grep -ril agpl` over the checkout, excluding `node_modules/`, `content/`,
  `docs/plans/` and `LICENSE`'s own history, returns only the three
  `docs/plans/` files (intent as written, never corrected) and the two
  unrelated Open-Meteo references.
- `LICENSE` matches the official Shield 1.0.0 plain text byte for byte, aside
  from the two appended `Required Notice:` / `Licensor Line of Business:`
  lines.
- No page of the running site describes the software as open source.
- `npm run verify` passes.
