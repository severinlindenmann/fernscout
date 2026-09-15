---
id: B1798
title: Green and coral text fail the contrast floor in dark mode, across thirty-five components
type: ISSUE
priority: high
complexity: low
area: brand, dark mode, accessibility
found: "2026-09-15T13:43:09Z"
started: "2026-09-15T13:43:45Z"
session: 0e7f2abd-d7ef-4dd2-9733-1fd412b78b47
claimed: "2026-09-15T13:43:45Z"
---

# B1798 — Green and coral text fail the contrast floor in dark mode, across thirty-five components

## Why

`app/globals.css`'s `:root[data-theme="dark"]` block redefines every ink,
surface and line token — and does not redefine the palette hues. So
`--color-green-700`, `--color-coral-600` and Tailwind's own `red-600` keep their
light-theme values on the dark ground, where they were never meant to sit.

Measured against the dark background `#171d29`:

| Token | Ratio | |
| --- | --- | --- |
| `green-700` `#15803d` | 3.37:1 | fails AA (4.5 needed) |
| `coral-600` `#c2334a` | 3.11:1 | fails AA |
| `red-600` `#dc2626` | 3.49:1 | fails AA |

**Thirty-five components use one of these as a text colour** —
`grep -rl "text-green-700\|text-coral-600" components/ | wc -l`. Every success
line, every error line, every "approved" and "refused" word in the product is
below the readable floor for anyone in dark mode.

Found when the owner said dark mode looked bad on a phone and sent a screenshot
of the camera-roll import's upload list: rows of red "fehlgeschlagen" and green
"hochgeladen" against dark navy. The import is where it was noticed; it is not
where the bug lives.

`apply-the-brand` already warns that two palette tokens lie about whether they
may carry words — `yellow-600` is a fill, `green-500` is a dot. This is the same
class of trap one theme further on: a token that is a legitimate text colour on
cream and is not one on navy, with nothing in the name to say so.

## Work

Give the dark block its own values for the hues that carry text. The light
values were chosen against cream; the dark ones need choosing against
`#171d29`, not derived by a formula.

`red-600` is raw Tailwind rather than a brand token and appears where a brand
colour should be — `components/extract/UploadStep.tsx:212` is one. Those want
`coral` so that fixing the token fixes them too.

Check the whole set while in there, not only the three measured: any hue used
for words in either theme needs a ratio taken on both grounds. The bench at
`/docs/branding/identity` computes contrast from the hexes already, so extend
what it shows rather than measuring by hand a second time.

## Acceptance

- Every hue used as a text colour clears 4.5:1 on the ground it is rendered on,
  in both themes, and the identity bench shows the figures for both.
- No component uses a raw Tailwind colour where a brand token exists.
- Checked in a real browser at 390px in both themes, captures kept — the report
  that found this was a phone screenshot, and that is the case to reproduce.

## Related

Noticed while testing B1751/B1797. Not caused by either: the token gap predates
both and the import merely renders text in the colours the palette hands it.
