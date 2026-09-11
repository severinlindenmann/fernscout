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
