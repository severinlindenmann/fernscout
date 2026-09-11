---
id: B1148
title: A refused print credential is reported to the owner as the printer being unreachable, with advice to try again
type: ISSUE
priority: medium
complexity: low
area: photobook, api, i18n
found: "2026-09-09T18:38:33Z"
started: "2026-09-11T04:23:06Z"
session: 96a5b964-fad1-4616-9124-a01eabbd8a46
claimed: "2026-09-11T04:23:06Z"
---

# B1148 — A refused print credential is reported to the owner as the printer being unreachable, with advice to try again

Found during B108, against fernscout.ch on 2026-09-09.

## Why

`lib/photobook/gelato.ts:37` distinguishes three ways a print provider can fail:

```ts
export type GelatoFailure = "no_key" | "refused" | "unreachable";
```

`lib/photobook/propose.ts:82` throws the distinction away:

```ts
if ("error" in quote) return { ok: false, reason: "provider_unavailable" };
```

and `lib/photobook/print.ts:137` does the same. The owner is then shown, from
`site/locales/en.json:976`:

> The printer could not be reached. Nothing was charged — try again shortly.

For `unreachable` that is true and the advice is right. For the other two it is
false in both halves. On fernscout.ch on 2026-09-09 the printer **was** reached
and answered `401 Unauthorized` (B1147) — so the sentence describes something
that did not happen, and "try again shortly" sends the owner into a retry loop
that cannot succeed, because a rejected credential does not heal with time.

The distinction the code needs is already made one file away and discarded at
the boundary. This is the shape AGENTS.md names as the thing worth guarding:
the server knows what happened and tells the person something else.

There is a second reading worth keeping in mind while fixing it. The owner is
not the operator, and "your instance's printer credential is rejected" is not
their problem to solve — so the answer is probably not to show them the 401. It
is to stop telling them to retry, and to say that this needs the person who
runs the server. `no_key` and `refused` are operator faults; `unreachable` is
weather.

## Work

Carry the failure kind through `propose()` and `printBook()` rather than
collapsing it. Two owner-facing strings, not three:

- `unreachable` — keep the present message, including "try again shortly".
- `no_key` / `refused` — a message saying the printer is not accepting this
  server's account, that nothing was charged, and that this needs whoever runs
  the instance. No retry advice.

`lib/api/errorCodes.ts` gets the same treatment for the API side, where the
current text also says "try the same call again".

Three locales, `npm run i18n:keys`. Real German and real Hungarian.

Not doing: changing what is logged. `console.error("gelato refused:", …)` is
right and is how B1147 was found.

## Acceptance

- With a deliberately wrong `GELATO_API_KEY` on a local instance, the proposal
  page does not tell the owner to try again shortly.
- With the network blocked to `order.gelatoapis.com`, it does.

## Build notes (2026-09-11)

Built per `.claude/runs/2026-09-10-photobook-batch/brief.json`'s validity
verdict and chosen option — the wire code `provider_unavailable` stays single;
only the owner/agent-facing *message* forks on the underlying `GelatoFailure`
kind (`no_key`/`refused` = operator fault, `unreachable` = weather).

Threaded the kind through all four call sites the brief named
(`propose.ts:82`, `print.ts` at both the quote-error and submit-error sites in
`printOrder`, and `submitBuiltBook`'s submit-error site) plus, for internal
consistency within the same function/consumer, the twin submit-error block in
`printOrder` that the brief's four-site list did not separately name (it feeds
the exact same owner page as the named site).

New locale key for the operator-fault case, used at the pre-charge/quote
step (order/route.ts's one-press flow → PhotobookPageContent.tsx):

    photobook.printerRefused

("The printer is not accepting this server's account. Nothing was charged —
this needs whoever runs the instance." / DE per ticket wording.) **B1406
should reuse this exact key** for the pre-press panel's operator-fault
reason, per the run brief.

The existing `photobook.print.result.refused` key (used on the owner's
per-order page, `page.tsx`, for the button-press flow) was repurposed for the
same operator-fault message rather than adding a second new key, since it was
already a distinct state from `provider_unavailable` and its old text ("The
printer refused this order.") was superseded by the more specific wording.

**Hungarian**: could not write a genuine Hungarian translation. Per the
batch's `hungarian` decision, the English text was shipped in `hu.json` for
both `photobook.print.result.refused` and the new `photobook.printerRefused`
key, so the build and `test/locales.test.ts` pass. **Both need a native
Hungarian read before this ticket leaves `testing/`.**

Not touched (documented in the run report, not silently absorbed): the
one-press flow's post-build refusal (`order/route.ts` around
`submitBuiltBook`, outcome `print_refused`) still shows one message
regardless of `GelatoFailure` kind — its existing wording ("the printer would
not accept the order… try again below, or write to agent@fernscout.ch") does
not assert retrying will definitely work, so it does not carry the specific
false claim this ticket is about, and forking it would have required a new
outcome state for a flow already past a refund. Left as a possible follow-up
capture rather than expanded scope.
