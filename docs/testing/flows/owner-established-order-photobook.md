# Flow: owner-established-order-photobook

**Persona:** `owner-established` (docs/testing/personas/owner-established.md)
**Interface:** journal UI (the order button) + agent (the helper's proposal
step only)
**Capabilities exercised:** `photobook`
**Device/locale:** run at the requested viewport for the book preview and
order pages.
**Check type:** technical (an agent can only ever get a link, never place the
order; a build produces the right PDFs) and graphical (the book preview and
order confirmation).

## Setup

1. Local dev server running with `features.photobook` on,
   `provider: "dry-run"` — no printer account needed, matching AGENTS.md's
   rule that no capability requires a paid account to develop or test.
   `photobook` is one of `OPERATOR_ONLY_FEATURES` (`lib/config.ts`), so this
   is the server's own switch and `test-owner-established`'s config has
   nothing to say about it either way.
2. An owner-scoped agent token, for the helper-proposal step, and the
   owner's own browser cookie session, for the actual order.
3. An existing trip with enough published photographs to fill a book.

## Steps

1. As the agent (bearer token), `POST /api/helper/test-owner-established
   /photobook` naming a size and cover from `BOOK_SIZES`/`COVER_TYPES`.
   Confirm the response is only a URL to the order page
   (`app/[user]/photobook/order/route.ts`) — the route's own comment: "There
   is nothing to write... this route's whole job is to check the trip and
   the two choices are real, and hand back the URL of that page." Confirm
   the same bearer token cannot reach the order route itself (it is outside
   `/api/v1`, owner-cookie only).
2. As the owner, open that URL, review the preview, and press the order
   button.
3. Confirm the build runs (`buildPhotobook`), a credit spend is recorded
   (`spend`), and the order is submitted to the dry-run provider
   (`submitBuiltBook`) — which writes the interior and cover PDFs locally and
   calls nobody, per the dry-run discipline every print provider in this
   codebase follows.
4. Confirm the resulting order appears at
   `GET /api/v1/test-owner-established/photobooks/<id>` with its price and
   who it is for.

## Done when

- The helper's own proposal step never spends a credit and never places an
  order — only a link (technical check, matching the route's module
  comment).
- The order route refuses a bearer token outright and only the owner's
  cookie session can press it (technical check).
- The build produces both PDFs on disk under the dry-run provider, the
  credit spend is recorded once, and `GET .../photobooks/<id>` reads back
  the same order (technical check).
- The book preview and the order confirmation page both render correctly at
  the requested viewport (graphical check).
