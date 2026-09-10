---
id: B1397
title: "A busy button draws two loaders at once when the caller gives its own busy label"
type: ISSUE
priority: medium
complexity: low
area: the web helper, components/BusyButton
found: "2026-09-10T21:00:00Z"
---

# B1397 — A busy button draws two loaders at once when the caller gives its own busy label

## Why

Pressing send in the `/agent` composer looks wrong while the turn is in
flight: inside the round yellow button there is a thin spinning ring **and** a
dark bouncing dot, side by side and both off-centre. Two loaders, one button.

`BusyButton` renders both, at `components/BusyButton.tsx:165-166`:

```tsx
{working ? <Spinner /> : null}
{working && busyLabel !== undefined ? busyLabel : children}
```

The `busyLabel` prop is documented one screen above as *"Shown **in place of**
`children` while busy"* (`:59`), and that is exactly what it does — it replaces
the children. It does not replace the spinner, which is emitted
unconditionally beside it. For the fifteen-odd callers that pass a **word**
(*Sende…*, *Wird geschrieben…*) that is the intended design and reads
correctly: a spinner and a label.

The composer's send button is the one caller whose `busyLabel` is itself an
animated graphic — `HelperAsk.tsx:1359`, a `fs-waymark-bounce` dot, the brand's
own loader. So it gets the generic ring plus the brand mark bouncing, and the
button's own `inline-flex … gap-2` (`:162`) lays them out as two items with a
gap inside an `h-11 w-11` circle, which is why neither sits in the middle.

Small, and worth fixing properly rather than by nudging the CSS: the button
that starts every turn in the product's main flow is the wrong place to look
broken.

## Work

The laziest fix is at the caller, and the pattern already exists:
`PushOptIn.tsx:315` passes `busyLabel={null}` to get spinner-only. So decide
which single loader that button should show and use one prop:

- **Spinner only** — drop the `busyLabel` at `HelperAsk.tsx:1359`. One line
  removed, consistent with every other button here.
- **Waymark only** — keep the dot and suppress the spinner. That needs a change
  in `BusyButton`, because there is no way to say it today.

Prefer the first unless the waymark on that button is a deliberate brand
decision somebody made — check with `apply-the-brand` / `check-a-drawing`
before keeping it, since this is a drawing and no test can see it.

If `BusyButton` is touched at all, the honest change is to make the prop mean
what its own comment says: a `busyLabel` that is itself an indicator should not
arrive alongside the spinner. Whatever is decided, say it in the doc comment —
`:56-59` is where the next caller will read it.

Do not change the accessibility half: `disabled` is what stops the second
press, `aria-busy` is what says why, and `motion-reduce:animate-pulse` on the
spinner (`:83`) is deliberate — silence is not the accessible answer.

## Acceptance

- Sending a message in `/agent` shows exactly one loader in the send button,
  centred, at 390px and at desktop width. Seen in a browser
  (`check-a-drawing` / `test-in-a-browser`) — a green suite cannot see this.
- Every other `BusyButton` caller is unchanged: spinner plus its word, as
  today.
- With `prefers-reduced-motion` on, the button still visibly says it is
  working.
- `npm run verify` clean.
