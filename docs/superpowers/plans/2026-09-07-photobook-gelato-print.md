# Printing a Photobook Through Gelato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a built photobook into a printed one — an owner presses a button,
Gelato prints it in Switzerland and posts it to a contact.

**Architecture:** The postcard pipeline, followed exactly. `providers.ts` builds
a request and stops; a thin client posts it; the only caller of that client is
the owner's own page, never an API route. Order state lives on the existing
`print_orders` row, so there is no migration. Gelato fetches the PDFs from a
signed, short-lived URL on this instance.

**Tech Stack:** TypeScript, Next.js App Router, Kysely (SQLite dev / Postgres
prod), vitest, `node:crypto` HMAC.

**Spec:** `docs/superpowers/specs/2026-09-07-gelato-print-design.md`

**Depends on:** `docs/superpowers/plans/2026-09-07-photobook-gelato-formats.md`
must be merged first. A book laid out at 210 × 210 cannot be ordered.
Also depends on **B108** — a book has to have been built on the deployed
instance — which is held by another session.

## Global Constraints

- **Nothing under `app/api/` may import the submit function.** A test asserts
  it, exactly as `test/postcard-orders.test.ts` does for `sendOrder`. An agent
  proposes; a person presses.
- **Order of operations is claim → spend → submit → refund on refusal.** Not
  spend-first: two presses arriving together would both find a healthy balance
  and the owner would be correctly charged twice, which is the worst available
  failure because it looks fine in the logs.
- **Addresses never reach an agent.** The API takes a `contactId` and nothing else.
- `orderType` is `"order"` only when `features.photobook.live` is true;
  otherwise `"draft"`, which Gelato validates and does not print.
- **The sandbox always reports `Cancelled`.** No test may assert a status is
  not cancelled.
- Every new route goes into `lib/api/openapi.ts` with at least one documented
  refusal, and into `/agent.md`. `npm run verify` enforces the mechanical half.
- `npm run verify` must pass. Work in a worktree on its own branch.

---

### Task 1: The signed file link

**Files:**
- Create: `lib/photobook/fileLink.ts`
- Modify: `app/[user]/photobooks/[id]/[file]/route.ts:29-47`
- Test: `test/photobook-file-link.test.ts`

**Interfaces:**
- Consumes: `accessSecret()` from `lib/access.ts:34`.
- Produces:
  - `signFileLink(owner: string, id: string, file: string, ttlMs?: number): string`
    — returns `"?exp=<ms>&sig=<hex>"`, ttl default 24 h.
  - `verifyFileLink(owner: string, id: string, file: string, exp: string | null, sig: string | null, now?: number): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { signFileLink, verifyFileLink } from "@/lib/photobook/fileLink";

const OWNER = "someone";
const ID = "b-2026-abcdefg";
const FILE = "book-interior.pdf";

function parts(query: string) {
  const p = new URLSearchParams(query.replace(/^\?/, ""));
  return { exp: p.get("exp"), sig: p.get("sig") };
}

describe("the link Gelato is given", () => {
  it("verifies what it signed", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE));
    expect(verifyFileLink(OWNER, ID, FILE, exp, sig)).toBe(true);
  });

  it("refuses a signature for a different file", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE));
    expect(verifyFileLink(OWNER, ID, "book-cover.pdf", exp, sig)).toBe(false);
  });

  it("refuses a signature for a different journal", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE));
    expect(verifyFileLink("someone-else", ID, FILE, exp, sig)).toBe(false);
  });

  it("refuses an expiry that has passed", () => {
    const { exp, sig } = parts(signFileLink(OWNER, ID, FILE, 1000));
    expect(verifyFileLink(OWNER, ID, FILE, exp, sig, Date.now() + 2000)).toBe(false);
  });

  it("refuses a tampered expiry, so the clock cannot simply be moved", () => {
    const { sig } = parts(signFileLink(OWNER, ID, FILE, 1000));
    const far = String(Date.now() + 86_400_000);
    expect(verifyFileLink(OWNER, ID, FILE, far, sig)).toBe(false);
  });

  it("refuses a missing signature outright", () => {
    expect(verifyFileLink(OWNER, ID, FILE, null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-file-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/photobook/fileLink.ts`:

```ts
import crypto from "node:crypto";
import { accessSecret } from "../access";

/**
 * A link to one book file that carries its own permission.
 *
 * Gelato accepts no upload — it fetches the interior and cover PDFs from a URL
 * given in the order — and the owner-cookie route those files sit behind is
 * one no printer can get past. So this signs a URL instead: the same file, the
 * same route, reachable for a day by whoever holds the link.
 *
 * That is a real trade and is stated rather than buried. For those hours the
 * book is readable by anyone with the link, which is the trade the postcard
 * preview URL already makes. What it is not is guessable: the signature covers
 * the journal, the order, the file *and* the expiry, so none of the four can
 * be moved without invalidating it.
 *
 * A day rather than an hour because Gelato retries its own fetch, and a link
 * that expired between submit and retry fails an order that was paid for.
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function mac(owner: string, id: string, file: string, exp: string): string {
  return crypto
    .createHmac("sha256", accessSecret())
    .update(`photobook-file:${owner}:${id}:${file}:${exp}`)
    .digest("hex");
}

export function signFileLink(owner: string, id: string, file: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = String(Date.now() + ttlMs);
  return `?exp=${exp}&sig=${mac(owner, id, file, exp)}`;
}

export function verifyFileLink(
  owner: string,
  id: string,
  file: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): boolean {
  if (!exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < now) return false;
  const expected = mac(owner, id, file, exp);
  // Lengths differ only if the query was mangled; timingSafeEqual throws on
  // a mismatch rather than answering, so the length check comes first.
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-file-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Let the route accept it**

In `app/[user]/photobooks/[id]/[file]/route.ts`, after the `ORDER_ID_RE` and
`FILE_RE` checks and *before* the `isOwner` check:

```ts
const query = new URL(_request.url).searchParams;
const signed = verifyFileLink(user, id, file, query.get("exp"), query.get("sig"));
if (!signed && !(await isOwner(user))) return new Response("Not found", { status: 404 });
```

Rename the unused `_request` parameter to `request`. Replace the header comment's
paragraph about "the provider work that comes next" with what the route now does:
two ways in, one file, and why the signature covers the expiry.

- [ ] **Step 6: Run the suite and commit**

Run: `npm run verify`

```bash
git add -A
git commit -m "Photobook: a signed link a printer can fetch"
```

---

### Task 2: The Gelato client

**Files:**
- Create: `lib/photobook/gelato.ts`
- Modify: `lib/photobook/providers.ts` (`availableProviders`)
- Modify: `lib/capabilities.ts:113,147,251`
- Test: `test/photobook-gelato.test.ts`

**Interfaces:**
- Consumes: `buildGelatoRequest`, `BookOrder` from `providers.ts` (as amended by
  Task 5 of the formats plan: `productUid` and `shipmentMethodUid` are fields).
- Produces:
  - `quoteBook(input: QuoteInput): Promise<QuoteResult | { error: GelatoFailure }>`
    where `QuoteInput = { productUid: string; pageCount: number; country: string; currency: string }`
    and `QuoteResult = { printMinor: number; shipMinor: number; currency: string; shipmentMethodUid: string; expiresAt: string }`
  - `submitBookPrint(order: BookOrder): Promise<{ providerRef: string } | { error: GelatoFailure }>`
  - `type GelatoFailure = "no_key" | "refused" | "unreachable"`

- [ ] **Step 1: Write the failing test**

```ts
import { quoteBook, submitBookPrint } from "@/lib/photobook/gelato";

const QUOTE_BODY = {
  quotes: [
    {
      products: [{ itemReferenceId: "i1", price: 14.4, currency: "CHF" }],
      shipmentMethods: [
        { shipmentMethodUid: "swiss_post_economy", price: 8.52, currency: "CHF", minDeliveryDays: 4 },
        { shipmentMethodUid: "swiss_post_priority", price: 10.64, currency: "CHF", minDeliveryDays: 3 },
      ],
      expirationDateTime: "2026-09-08T17:17:37+00:00",
    },
  ],
  errors: [],
};

beforeEach(() => {
  process.env.GELATO_API_KEY = "test-key";
  vi.restoreAllMocks();
});

it("refuses to call anybody without a key", async () => {
  delete process.env.GELATO_API_KEY;
  expect(await quoteBook(INPUT)).toEqual({ error: "no_key" });
});

it("takes the cheapest shipment method and returns minor units", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(QUOTE_BODY), { status: 200 })));
  const result = await quoteBook(INPUT);
  expect(result).toMatchObject({
    printMinor: 1440,
    shipMinor: 852,
    currency: "CHF",
    shipmentMethodUid: "swiss_post_economy",
  });
});

it("reports a refusal rather than throwing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"BAD_REQUEST"}', { status: 400 })));
  expect(await quoteBook(INPUT)).toEqual({ error: "refused" });
});

it("reports an unreachable provider rather than throwing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
  expect(await quoteBook(INPUT)).toEqual({ error: "unreachable" });
});

it("sends a draft unless the journal is live, and never prints on a draft", async () => {
  const fetchMock = vi.fn(async () => new Response('{"id":"gel-1"}', { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  await submitBookPrint({ ...ORDER, test: true });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.orderType).toBe("draft");
});

it("never puts the key in the body", async () => {
  const fetchMock = vi.fn(async () => new Response('{"id":"gel-1"}', { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  await submitBookPrint(ORDER);
  expect(fetchMock.mock.calls[0][1].body).not.toContain("test-key");
  expect(fetchMock.mock.calls[0][1].headers["X-API-KEY"]).toBe("test-key");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-gelato.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/photobook/gelato.ts`, mirroring `lib/postcard/stannp.ts`: it posts
exactly what `buildGelatoRequest` returns and adds nothing. Prices arrive as
decimal numbers (`14.4`) and are converted to minor units with
`Math.round(price * 100)` — money never stays a float past the boundary.
`quoteBook` picks the cheapest shipment method and returns its uid, so the
order that follows ships by the method that was quoted rather than a different
one. Every failure is a returned value; nothing throws.

In `providers.ts`, change `availableProviders().gelato` to report `ready:
Boolean(process.env.GELATO_API_KEY)` with a note that says whether the key is
set, the same shape Stannp already uses.

In `lib/capabilities.ts`, add `GELATO_API_KEY` to the photobook provider's env
requirements when `features.photobook.provider === "gelato"`, so `/api/health`
explains why printing is off.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-gelato.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: a Gelato client that quotes and submits"
```

---

### Task 3: Print state on the order row

**Files:**
- Modify: `lib/photobook/orders.ts` (`PhotobookPayload`, new `claimForPrint`, `recordPrint`, `markPrintFailed`)
- Test: `test/photobook-print-orders.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `PhotobookPayload.print?: { contactId: string; quotedCredits: number; quotedAt: string; shipmentMethodUid: string; providerRef?: string; failure?: string }`
  - `claimForPrint(owner: string, id: string): Promise<boolean>` — `printed → print_submitted`, rows-affected.
  - `recordPrint(owner, id, payload, providerRef): Promise<void>`
  - `markPrintFailed(owner, id, payload, failure): Promise<void>` — returns the row to `printed` so a person can try again.

**Why no migration:** `print_orders` already carries `provider`, `provider_ref`,
`contact_id`, `cost_minor` and `currency`, none of which the photobook path uses.
One book is at most one print job; a reprint is a new build, which is also the
honest answer because the files may have been pruned (B483).

- [ ] **Step 1: Write the failing test**

```ts
it("lets exactly one of two simultaneous presses claim the print", async () => {
  await claimOrder(OWNER, ID, PAYLOAD);
  await markPrinted(OWNER, ID, PAYLOAD);
  const [a, b] = await Promise.all([claimForPrint(OWNER, ID), claimForPrint(OWNER, ID)]);
  expect([a, b].filter(Boolean)).toHaveLength(1);
});

it("refuses to claim a book that was never built", async () => {
  await claimOrder(OWNER, ID2, PAYLOAD);   // status: submitted
  expect(await claimForPrint(OWNER, ID2)).toBe(false);
});

it("refuses to claim another journal's order", async () => {
  await claimOrder(OWNER, ID3, PAYLOAD);
  await markPrinted(OWNER, ID3, PAYLOAD);
  expect(await claimForPrint("someone-else", ID3)).toBe(false);
});

it("returns a failed print to printed, so it can be tried again", async () => {
  await claimOrder(OWNER, ID4, PAYLOAD);
  await markPrinted(OWNER, ID4, PAYLOAD);
  await claimForPrint(OWNER, ID4);
  await markPrintFailed(OWNER, ID4, PAYLOAD, "refused");
  const row = await getPhotobookOrder(OWNER, ID4);
  expect(row?.status).toBe("printed");
  expect(row?.payload.print?.failure).toBe("refused");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-print-orders.test.ts`
Expected: FAIL — `claimForPrint` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add the `print` block to `PhotobookPayload` with a comment saying why it lives
on the build's row rather than in a table of its own. Add the three functions,
each gated in the `where` clause on both `owner_id` and the status it is meant
to leave, and each returning rows-affected as a boolean the way `setStatus`
already does. Set `provider = 'gelato'` and `provider_ref` in `recordPrint`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-print-orders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: print state on the order that was built"
```

---

### Task 4: Who a book may be posted to

**Files:**
- Modify: `lib/postcard/contacts.ts` (extract the shared eligibility)
- Create: `lib/photobook/recipients.ts`
- Test: `test/photobook-recipients.test.ts`

**Interfaces:**
- Consumes: `listContacts` from `lib/contacts/index.ts`, `isPostable` from `lib/contacts/crypto.ts`.
- Produces: `bookRecipients(owner: string): Promise<{ id: string; name: string; city: string; country: string }[]>`
  and `bookAddressFor(owner: string, contactId: string): Promise<PostalAddress | null>`.

**The one deliberate difference from postcards:** `wantsPostcard` is consent to
receive *postcards* and is not asked for here. A book posted to yourself must
not require having ticked a postcard box. `status === "active"` and `isPostable`
still both apply.

- [ ] **Step 1: Write the failing test**

```ts
it("offers an active contact with an address who never asked for postcards", async () => {
  const rows = await bookRecipients(OWNER);
  expect(rows.map((r) => r.id)).toContain(ACTIVE_NO_POSTCARD_CONSENT.id);
});

it("does not offer a pending or blocked contact", async () => {
  const ids = (await bookRecipients(OWNER)).map((r) => r.id);
  expect(ids).not.toContain(PENDING.id);
  expect(ids).not.toContain(BLOCKED.id);
});

it("does not offer somebody with no postable address", async () => {
  expect((await bookRecipients(OWNER)).map((r) => r.id)).not.toContain(EMAIL_ONLY.id);
});

it("never returns a street to a caller listing recipients", async () => {
  const rows = await bookRecipients(OWNER);
  for (const row of rows) expect(Object.keys(row)).toEqual(["id", "name", "city", "country"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-recipients.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/photobook/recipients.ts`. `bookRecipients` returns only id, name,
town and country — the same shape `GET …/postcards/recipients` answers with, and
for the same reason: an agent may choose a recipient and may never learn an
address. `bookAddressFor` is server-only and is called by the send path alone.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-recipients.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: who a book may be posted to"
```

---

### Task 5: The print itself

**Files:**
- Create: `lib/photobook/print.ts`
- Create: `app/[user]/photobooks/[id]/print/route.ts`
- Modify: `lib/credits.ts` (`SpendReason`)
- Test: `test/photobook-print.test.ts`

**Interfaces:**
- Consumes: `signFileLink` (Task 1), `submitBookPrint` (Task 2), `claimForPrint`
  / `recordPrint` / `markPrintFailed` (Task 3), `bookAddressFor` (Task 4).
- Produces: `printOrder(owner: string, id: string, quotedCredits: number): Promise<PrintOutcome>`
  where `PrintOutcome = { ok: true; providerRef: string; charged: number } | { ok: false; reason: PrintFailure }`
  and `PrintFailure = "unknown_order" | "not_built" | "already_printing" | "no_recipient" | "no_credits" | "stale_quote" | "provider_unavailable" | "refused"`.

- [ ] **Step 1: Write the failing test**

```ts
it("claims before it spends, so two presses cost one book", async () => {
  const [a, b] = await Promise.all([
    printOrder(OWNER, ID, QUOTED),
    printOrder(OWNER, ID, QUOTED),
  ]);
  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  expect(await balanceOf(OWNER)).toBe(START - QUOTED);
});

it("refuses when the quote it was shown is not the quote now", async () => {
  const result = await printOrder(OWNER, ID, QUOTED + 1);
  expect(result).toEqual({ ok: false, reason: "stale_quote" });
  expect(await balanceOf(OWNER)).toBe(START);
});

it("gives the credits back when the provider refuses", async () => {
  vi.mocked(submitBookPrint).mockResolvedValue({ error: "refused" });
  const result = await printOrder(OWNER, ID, QUOTED);
  expect(result).toEqual({ ok: false, reason: "refused" });
  expect(await balanceOf(OWNER)).toBe(START);
  expect((await getPhotobookOrder(OWNER, ID))?.status).toBe("printed");
});

it("spends nothing when there are not enough credits", async () => {
  const result = await printOrder(POOR_OWNER, ID, QUOTED);
  expect(result).toEqual({ ok: false, reason: "no_credits" });
});

it("hands Gelato a signed URL and not a bare one", async () => {
  await printOrder(OWNER, ID, QUOTED);
  const order = vi.mocked(submitBookPrint).mock.calls[0][0];
  expect(order.interiorUrl).toContain("sig=");
  expect(order.coverUrl).toContain("exp=");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-print.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/photobook/print.ts` with a header comment stating the order of
operations and why, in the same words `lib/postcard/send.ts` uses — claim,
spend, submit, refund — and stating that there is no route to this function an
agent can reach.

```
1. getPhotobookOrder            → unknown_order
2. status must be "printed"     → not_built
3. re-quote; compare to the quotedCredits argument → stale_quote
4. bookAddressFor               → no_recipient
5. claimForPrint                → already_printing
6. spend(owner, quotedCredits, "photobook_print", id) → no_credits
7. signFileLink for interior and cover, absolute against the site URL
8. submitBookPrint              → on error: refund, markPrintFailed, return
9. recordPrint(providerRef)
```

Add `"photobook_print"` to `SpendReason` in `lib/credits.ts`, with a comment
saying why it is its own value rather than `photobook`: the ledger is what an
operator reconciles a bill against, and a render and a printed object are two
different suppliers.

Create `app/[user]/photobooks/[id]/print/route.ts` — a `POST` taking the owner
cookie, calling `printOrder`, and redirecting back to the order page with a
state in the query, exactly as `app/[user]/postcards/[id]/send/route.ts` does.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-print.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the door does not exist**

Add to `test/photobook-print.test.ts`:

```ts
it("is reachable from no API route", async () => {
  const files = await glob("app/api/**/*.ts");
  for (const file of files) {
    const source = await readFile(file, "utf8");
    expect(source).not.toContain("photobook/print");
    expect(source).not.toContain("submitBookPrint");
  }
});
```

Copy the glob helper from `test/postcard-orders.test.ts` rather than writing a
second one.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Photobook: claim, spend, print, refund what was refused"
```

---

### Task 6: The panel, and the agent's proposal

**Files:**
- Modify: `app/[user]/photobooks/[id]/page.tsx` (or create it if the order page
  does not yet exist as its own route — check before assuming)
- Create: `components/PhotobookPrintPanel.tsx`
- Create: `app/api/v1/[user]/photobooks/[id]/print/route.ts`
- Create: `app/api/v1/[user]/photobooks/[id]/route.ts`
- Modify: `lib/api/openapi.ts`
- Modify: `public/agent.md` (or wherever `/agent.md` is generated — check)
- Test: `test/photobook-print-api.test.ts`, `test/openapi-contract.test.ts`

**Interfaces:**
- Consumes: `bookRecipients` (Task 4), `quoteBook` (Task 2), `PhotobookPayload.print` (Task 3).
- Produces: `POST /api/v1/<user>/photobooks/<id>/print` taking
  `{ contactId: string }`, answering `{ url: string; quotedCredits: number; contactId: string }`;
  `GET /api/v1/<user>/photobooks/<id>` answering the order including its `print` block.

- [ ] **Step 1: Write the failing test**

```ts
it("writes a proposal and charges nothing", async () => {
  const res = await POST(request({ contactId: CONTACT }), ctx);
  expect(res.status).toBe(201);
  expect(await balanceOf(OWNER)).toBe(START);
  expect(submitBookPrint).not.toHaveBeenCalled();
});

it("answers with a URL a person opens, not a confirmation", async () => {
  const body = await (await POST(request({ contactId: CONTACT }), ctx)).json();
  expect(body.url).toContain(`/${OWNER}/photobooks/${ID}`);
});

it("refuses a contact this journal does not have", async () => {
  const res = await POST(request({ contactId: "not-a-contact" }), ctx);
  expect(res.status).toBe(400);
});

it("refuses a trip-scoped token", async () => {
  const res = await POST(request({ contactId: CONTACT }, TRIP_TOKEN), ctx);
  expect(res.status).toBe(403);
});

it("reads the proposal back, so an agent can check its own work", async () => {
  await POST(request({ contactId: CONTACT }), ctx);
  const body = await (await GET(request(), ctx)).json();
  expect(body.print).toMatchObject({ contactId: CONTACT });
});

it("never returns an address", async () => {
  const body = await (await GET(request(), ctx)).json();
  expect(JSON.stringify(body)).not.toContain(CONTACT_STREET);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-print-api.test.ts`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Write minimal implementation**

Both API routes, owner-only. The `POST` validates the `contactId` against
`bookRecipients`, calls `quoteBook`, writes the `print` block with the quote and
the timestamp, and answers with the page URL. It never calls `printOrder`.

`components/PhotobookPrintPanel.tsx` renders: the recipient (or a picker), the
live quote broken into print and postage, the price in credits, the balance,
and one button that says what it does. **No `window.confirm`** — a confirmation
is a panel in the flow (`components/ConfirmPanel.tsx`), and
`test/no-browser-dialogs.test.ts` fails the build otherwise.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-print-api.test.ts test/openapi-contract.test.ts`
Expected: PASS. If `openapi-contract` fails, the route is undocumented — add it
to `lib/api/openapi.ts` with its schema and at least one refusal.

- [ ] **Step 5: Keep the contract**

Run the `keep-the-contract` skill. The mechanical half is a test; what it cannot
check is whether the words are true, which is the half that has been wrong most
often here.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Photobook: an agent proposes a print, a person presses it"
```

---

### Task 7: Status, and the first real order

**Files:**
- Modify: `lib/photobook/gelato.ts` (add `fetchOrderStatus`)
- Modify: `app/[user]/photobooks/[id]/page.tsx`
- Modify: `docs/providers/photobook.md`
- Test: `test/photobook-gelato.test.ts`

**Interfaces:**
- Consumes: `submitBookPrint`'s `providerRef`.
- Produces: `fetchOrderStatus(providerRef: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing test**

```ts
it("reads a status back", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"fulfillmentStatus":"printed"}', { status: 200 })));
  expect(await fetchOrderStatus("gel-1")).toBe("printed");
});

it("answers null rather than throwing when the provider is unreachable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
  expect(await fetchOrderStatus("gel-1")).toBeNull();
});
```

**Do not** write a test asserting the status is not `"cancelled"`. The sandbox
returns `Cancelled` for every order it accepts; such a test would pass in
production and fail in the only environment it can be run in.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-gelato.test.ts`
Expected: FAIL — `fetchOrderStatus` is not exported.

- [ ] **Step 3: Write minimal implementation**

`GET https://order.gelatoapis.com/v4/orders/{id}`, returning
`fulfillmentStatus` or null. Called from the order page's server render when a
`providerRef` is present, and shown beside the order. No webhook — that is a
separate capture.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run verify`
Expected: all green.

- [ ] **Step 5: Drive it against the sandbox**

This cannot be done from a local checkout: Gelato has to reach the signed URL.
Deploy with a **sandbox** key in `/etc/fernscout/env` and
`features.photobook.live` false, then from the deployed instance:

1. Build a book on a real trip.
2. Propose a print through the API with a real `contactId`.
3. Press the button.
4. Confirm: an order id came back, the credits moved, `provider_ref` is set,
   and the status reads `Cancelled` — which is what the sandbox always says and
   is the proof it worked, not a failure.

Record what came back in `docs/providers/photobook.md`, including any field
Gelato refused. **This is where the create-order request shape is finally
confirmed** — everything before it is written from the quote endpoint and from
documentation.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Photobook: read a print's status back"
```

---

## Self-review notes

- **Spec coverage.** Phases 1–5 map to Tasks 1, 2, 3+5, 6 and 7. Phase 3's
  recipient rule is Task 4. The pricing split is Task 5's `photobook_print`
  spend reason plus the formats plan's Task 4.
- **Interface consistency.** `submitBookPrint` is named identically in Tasks 2,
  5 and 6's guard test. `claimForPrint` returns a boolean everywhere.
  `PrintFailure` values are the same list in Task 5's implementation and its tests.
- **What no test can check:** whether the printed object is right. Task 7 step 5
  is the only place that finds out, and it needs a deployed instance.
- **Left for a capture, not built here:** a status webhook; reprinting an
  existing order; delivery outside Switzerland priced ahead of time rather than
  quoted live.
