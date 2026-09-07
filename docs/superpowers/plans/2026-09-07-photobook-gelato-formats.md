# Photobook Formats From Gelato's Catalogue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three invented book sizes with the three Gelato actually
prints, and replace two invented binding profiles with the one real page-count
rule, so that a generated book is orderable.

**Architecture:** `lib/photobook/spec.ts` is the single source of print
geometry; every other module reads it. The change is therefore concentrated
there, plus the size ids that appear as string literals in the CLI, the order
routes and the settings panel. Nothing about the page planner's logic changes —
only the numbers it is handed.

**Tech Stack:** TypeScript, Next.js (App Router), vitest, `tsx` for the CLI.

**Spec:** `docs/superpowers/specs/2026-09-07-gelato-print-design.md`

## Global Constraints

- Page-count rule for **every** Gelato photobook product: **minimum 28, maximum
  200, step 2**. Verified against the live API on 2026-09-07 — the error body
  from `GET /v3/products/{uid}/prices?pageCount=31` enumerates every valid value.
- `BindingType` at Gelato is `glued-left` only. **Saddle stitch does not exist**
  and is removed rather than left as an unprintable option.
- Size ids become semantic (`square`, `portrait`, `large-square`), never a
  measurement, so a millimetre change cannot make an id lie again.
- Every `productUid` is copied verbatim from the catalogue; none is constructed
  by string concatenation. `pageCount` is a sibling field and never part of the uid.
- `npm run verify` must pass. It runs build → tsc → eslint → vitest → knip.
- Work in a worktree on its own branch (AGENTS.md). The main checkout stays on `main`.

---

### Task 1: The sizes and the page-count rule

**Files:**
- Modify: `lib/photobook/spec.ts:24-140`
- Test: `test/photobook.test.ts:130-200`

**Interfaces:**
- Consumes: nothing.
- Produces: `BOOK_SIZES` keyed `"square" | "portrait" | "large-square"`, each a
  `BookSize` gaining two fields: `productUid: string` and `cover: "soft" | "hard"`.
  `GELATO_PAGE_RULE: PageCountRule`. `portableRule()` and `SADDLE_STITCH` are
  deleted; `BINDING_PROFILES` is deleted.

- [ ] **Step 1: Write the failing test**

Replace the `portableRule` and saddle-stitch blocks in `test/photobook.test.ts`
with:

```ts
import { BOOK_SIZES, GELATO_PAGE_RULE, fitsRule, normalisePageCount } from "@/lib/photobook/spec";

describe("Gelato's real page-count rule", () => {
  it("is 28 to 200 in steps of 2", () => {
    expect(GELATO_PAGE_RULE).toEqual({ min: 28, max: 200, multipleOf: 2 });
  });

  it("accepts what the API accepts and refuses what it refuses", () => {
    for (const ok of [28, 30, 52, 160, 200]) expect(fitsRule(ok, GELATO_PAGE_RULE)).toBe(true);
    for (const no of [4, 20, 24, 27, 31, 33, 202]) expect(fitsRule(no, GELATO_PAGE_RULE)).toBe(false);
  });

  it("rounds a short trip up to the floor rather than below it", () => {
    expect(normalisePageCount(9, GELATO_PAGE_RULE)).toBe(28);
    expect(normalisePageCount(53, GELATO_PAGE_RULE)).toBe(54);
  });
});

describe("the sizes are the ones Gelato prints", () => {
  it("offers three, all with a real productUid", () => {
    expect(Object.keys(BOOK_SIZES)).toEqual(["square", "portrait", "large-square"]);
    for (const size of Object.values(BOOK_SIZES)) {
      expect(size.productUid).toMatch(/^photobooks-(soft|hard)cover_pf_/);
      expect(size.productUid).not.toMatch(/pages/);
    }
  });

  it("is 200 mm square by default, not 210", () => {
    expect(BOOK_SIZES.square.trimWidthMm).toBe(200);
    expect(BOOK_SIZES.square.trimHeightMm).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook.test.ts`
Expected: FAIL — `GELATO_PAGE_RULE` is not exported, `BOOK_SIZES.square` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `lib/photobook/spec.ts`, replace `BOOK_SIZES`, `BINDING_PROFILES`,
`SADDLE_STITCH` and `portableRule` with:

```ts
/** A finished book size. Every one of these is a product Gelato prints, and
 * `productUid` is copied from its catalogue rather than constructed — the uid
 * that used to be built by concatenation was never a real product. */
export type BookSize = {
  id: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  /** Verbatim from `POST /v3/catalogs/{catalog}/products:search`. */
  productUid: string;
  cover: "soft" | "hard";
};

export const BOOK_SIZES: Record<string, BookSize> = {
  /** 20 x 20 cm. The photobook shape: neither photo orientation is a
   * second-class citizen. 210 x 210 is what this used to say and is a size
   * Gelato does not print. */
  square: {
    id: "square",
    name: "Square 200 × 200 mm",
    trimWidthMm: 200,
    trimHeightMm: 200,
    productUid:
      "photobooks-softcover_pf_200x200-mm-8x8-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver",
    cover: "soft",
  },
  /** Portrait, and the cheapest per page for a text-heavy trip. Not A4:
   * Gelato's nearest is 210 x 280. */
  portrait: {
    id: "portrait",
    name: "Portrait 210 × 280 mm",
    trimWidthMm: 210,
    trimHeightMm: 280,
    productUid:
      "photobooks-softcover_pf_210x280-mm-8x11-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_250-gsm-100-lb-cover-coated-silk_ver",
    cover: "soft",
  },
  /** The big one, and the only hardcover. Task 6 is what makes its cover
   * printable; until then it is refused rather than rendered wrongly. */
  "large-square": {
    id: "large-square",
    name: "Large square 280 × 280 mm",
    trimWidthMm: 280,
    trimHeightMm: 280,
    productUid:
      "photobooks-hardcover_pf_280x280-mm-11x11-inch_pt_170-gsm-65lb-coated-silk_cl_4-4_ccl_4-4_bt_glued-left_ct_matt-lamination_prt_1-0_cpt_130-gsm-65-lb-cover-coated-silk_ver",
    cover: "hard",
  },
};

/**
 * The page-count rule, and there is only one.
 *
 * Read from the live API on 2026-09-07: every photobook product, soft and
 * hard, square and portrait, answers with the same list. What stood here
 * before was four providers' published ranges intersected into `multipleOf: 4`,
 * every row of it carrying `verified: false` because none had ever met an
 * account. They were wrong in both directions — 4 is stricter than any binder
 * needs, and 160 is below the 200 Gelato allows.
 */
export const GELATO_PAGE_RULE: PageCountRule = { min: 28, max: 200, multipleOf: 2 };
```

Keep `PageCountRule` as it is. Delete the `BindingProfile` type with its
profiles, `SADDLE_STITCH`, and `portableRule()`.

Change `defaultSpec` to:

```ts
export function defaultSpec(size: BookSize = BOOK_SIZES["square"]): BookSpec {
  return {
    size,
    bleedMm: 3,
    safeMm: 10,
    gutterMm: 16,
    dpi: 300,
    paperCaliperMm: 0.115,
    // A hardcover case adds board to the spine; Task 6 sets this from `size.cover`.
    coverBoardMm: 0,
    coverWrapMm: 15,
    pageCount: GELATO_PAGE_RULE,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook.test.ts`
Expected: the new tests PASS. Other files still fail to compile — Task 2 fixes them.

- [ ] **Step 5: Commit**

```bash
git add lib/photobook/spec.ts test/photobook.test.ts
git commit -m "Photobook: the sizes and page rule Gelato actually prints"
```

---

### Task 2: Every caller follows the new ids

**Files:**
- Modify: `lib/photobook/build.ts:10,31,33`
- Modify: `scripts/photobook.ts:35,96,126-134`
- Modify: `app/[user]/(trip)/photobook/BookShape.tsx:185`
- Modify: `test/photobook-page-dates.test.ts:16`, `test/photobook-source.test.ts:27`,
  `test/photobook-day-plans.test.ts:16`, `test/photobook-options.test.ts:12,157-160`,
  `test/photobook-build.test.ts:14-20`, `test/photobook.test.ts:852`
- Test: `test/photobook-build.test.ts`

**Interfaces:**
- Consumes: `BOOK_SIZES`, `GELATO_PAGE_RULE` from Task 1.
- Produces: `specFor(options)` unchanged in signature, no longer reading `options.binding`.

- [ ] **Step 1: Write the failing test**

Replace the binding assertions in `test/photobook-build.test.ts`:

```ts
import { BOOK_SIZES, GELATO_PAGE_RULE } from "@/lib/photobook/spec";

it("resolves a size id, and falls back to square", () => {
  expect(specFor({ ...DEFAULT_OPTIONS, size: "portrait" }).size).toBe(BOOK_SIZES["portrait"]);
  expect(specFor({ ...DEFAULT_OPTIONS, size: "nonsense" }).size).toBe(BOOK_SIZES["square"]);
});

it("always uses the one page rule, whatever a stored option says", () => {
  expect(specFor({ ...DEFAULT_OPTIONS, binding: "saddle" } as never).pageCount).toEqual(GELATO_PAGE_RULE);
  expect(specFor({ ...DEFAULT_OPTIONS, size: "large-square" }).pageCount).toEqual(GELATO_PAGE_RULE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-build.test.ts`
Expected: FAIL — `specFor` still branches on `options.binding`.

- [ ] **Step 3: Write minimal implementation**

`lib/photobook/build.ts`:

```ts
import { BOOK_SIZES, defaultSpec, type BookSpec } from "./spec";

// ...
const size = BOOK_SIZES[options.size] ?? BOOK_SIZES["square"];
const spec = defaultSpec(size);
return spec;
```

Delete the `SADDLE_STITCH` / `portableRule` import and the binding branch.

`scripts/photobook.ts`: drop the `--binding` flag from the usage text at line 96,
drop the `SADDLE_STITCH` import at line 35, and delete lines 134's
`if (binding === "saddle") spec.pageCount = SADDLE_STITCH;`.

Everywhere a test or component names `"square-210"`, write `"square"`;
`"landscape-a4"` becomes `"portrait"` (the nearest surviving size — the test at
`test/photobook.test.ts:852` only needs a non-square page to prove the layout
adapts, and 210 × 280 is one).

`app/[user]/(trip)/photobook/BookShape.tsx:185`: `BOOK_SIZES[sizeId] ?? BOOK_SIZES["square"]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run`
Expected: the whole photobook suite PASSES.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: callers follow the new size ids, saddle stitch goes"
```

---

### Task 3: `binding` leaves the options, and old orders still read

**Files:**
- Modify: `lib/photobook/options.ts:30,236,454,488,504`
- Modify: `app/[user]/(trip)/photobook/BookSettingsPanel.tsx`
- Test: `test/photobook-options.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BookOptions` without a `binding` field. `parseOptions` ignores a
  `binding` key rather than refusing the object.

**Why this matters:** `BookOptions` is stored in `print_orders.payload` for every
order ever placed. A parser that refuses an object carrying `binding` would make
old orders unreadable, which is a data loss disguised as a validation.

- [ ] **Step 1: Write the failing test**

```ts
it("reads an order stored before binding was removed", () => {
  const stored = { ...DEFAULT_OPTIONS, binding: "saddle" };
  const parsed = parseOptions(stored, Object.keys(BOOK_SIZES));
  expect(parsed).not.toBeNull();
  expect(parsed).not.toHaveProperty("binding");
});

it("still refuses an object missing a field that matters", () => {
  const { locale, ...withoutLocale } = DEFAULT_OPTIONS;
  expect(parseOptions(withoutLocale, Object.keys(BOOK_SIZES))).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-options.test.ts`
Expected: FAIL — the parsed object still has `binding`.

- [ ] **Step 3: Write minimal implementation**

In `lib/photobook/options.ts`: delete the `binding` field from `BookOptions`,
from `DEFAULT_OPTIONS`, from the `const binding = …` line, from the `!binding ||`
guard and from the returned object. Do **not** add a rejection for an unknown
key — the parser already builds its result field by field, so a stray `binding`
is dropped by construction.

Delete the binding radio group from `BookSettingsPanel.tsx` and any locale
strings it alone used.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-options.test.ts && npm run unused`
Expected: PASS, and knip reports no newly-orphaned export.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: binding leaves the options; stored orders still parse"
```

---

### Task 4: Pricing from the measured cost basis

**Files:**
- Modify: `lib/credits/pricing.ts:56,88-109`
- Modify: `components/Pricing.tsx`
- Test: `test/photobook-pricing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PHOTOBOOK_PRICING_VERIFIED === true`; `photobookCredits(pages, size)`
  keeps its existing signature.

**The measured basis, Zurich, CHF, ex-VAT, 2026-09-07:** square softcover
`6.04 + 0.161 × pages`; 52 pages = 14.40. Swiss Post Economy 8.52, Priority 10.64.
Printed in Switzerland. A 52-page square book lands at **CHF 22.92**.

- [ ] **Step 1: Write the failing test**

```ts
import { PHOTOBOOK_PRICING_VERIFIED, photobookCredits, CHF_PER_CREDIT } from "@/lib/credits/pricing";

it("is no longer an estimate", () => {
  expect(PHOTOBOOK_PRICING_VERIFIED).toBe(true);
});

it("covers the measured landed cost of a 52-page square book", () => {
  const landedChf = 6.04 + 0.161 * 52 + 8.52; // 22.92
  const charged = photobookCredits(52) * CHF_PER_CREDIT;
  expect(charged).toBeGreaterThan(landedChf);
  expect(charged).toBeLessThan(landedChf * 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook-pricing.test.ts`
Expected: FAIL — `PHOTOBOOK_PRICING_VERIFIED` is `false`.

- [ ] **Step 3: Write minimal implementation**

Set `PHOTOBOOK_PRICING_VERIFIED = true` and rewrite the comment above it to
record the four quoted figures, the date, and that they are ex-VAT and
Switzerland-only. Leave `PHOTOBOOK_BASE_CREDITS` and `PHOTOBOOK_PAGE_CREDITS`
alone — the second plan is what splits build from print, and changing the
number twice would be a price that moved for no reason a reader can see.

In `components/Pricing.tsx`, drop the word "estimate" from the photobook row and
say instead that a book is printed in Switzerland and posted for CHF 8.52.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/photobook-pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: the price is measured now, not estimated"
```

---

### Task 5: The document catches up

**Files:**
- Modify: `docs/providers/photobook.md`
- Modify: `lib/photobook/providers.ts:150-200` (the Gelato builder)
- Test: `test/photobook.test.ts` (fixture assertion), `test/fixtures/photobook/gelato-request.json`

**Interfaces:**
- Consumes: `BOOK_SIZES[id].productUid` from Task 1.
- Produces: `buildGelatoRequest(order)` where `BookOrder` gains
  `productUid: string` and `shipmentMethodUid: string`, and no longer computes a uid.

- [ ] **Step 1: Write the failing test**

```ts
it("sends the catalogue's own product uid, never one it built", () => {
  const req = buildGelatoRequest({ ...ORDER, productUid: BOOK_SIZES.square.productUid });
  const body = req.body as { items: { productUid: string; pageCount: number }[] };
  expect(body.items[0].productUid).toBe(BOOK_SIZES.square.productUid);
  expect(body.items[0].productUid).not.toContain("-pages_");
  expect(body.items[0].pageCount).toBe(ORDER.pageCount);
});

it("names a real Swiss shipment method", () => {
  const req = buildGelatoRequest({ ...ORDER, shipmentMethodUid: "swiss_post_economy" });
  expect((req.body as { shipmentMethodUid: string }).shipmentMethodUid).toBe("swiss_post_economy");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook.test.ts`
Expected: FAIL — the builder concatenates a uid and hardcodes `"normal"`.

- [ ] **Step 3: Write minimal implementation**

In `lib/photobook/providers.ts`, add `productUid` and `shipmentMethodUid` to
`BookOrder`, delete the `const uid = …` concatenation, and use the two new
fields. Update the header comment: it currently says every field is written
from documentation and unconfirmed — that is no longer true of Gelato, and
saying so is the point of the comment. Regenerate
`test/fixtures/photobook/gelato-request.json` to match.

Rewrite `docs/providers/photobook.md`'s geometry and page-count tables from the
new `spec.ts`, and add the measured price table and the Swiss fulfilment fact.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run verify`
Expected: build, tsc, eslint, vitest and knip all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Photobook: the Gelato request carries a real product, and the doc says so"
```

---

### Task 6: The hardcover case — droppable

**Files:**
- Modify: `lib/photobook/spec.ts` (`defaultSpec`, `spineWidthMm`)
- Modify: `lib/photobook/render.ts:800-885` (the cover page)
- Test: `test/photobook.test.ts`

**Interfaces:**
- Consumes: `BookSize.cover` from Task 1.
- Produces: `defaultSpec` sets `coverBoardMm: 4` and `coverWrapMm: 18` when
  `size.cover === "hard"`; the cover PDF's media box widens by `coverWrapMm × 2`.

**Read this before starting.** `coverBoardMm` and `coverWrapMm` exist in
`BookSpec` today and are used by nothing except the spine sum — a hardcover
cover has never been rendered here. A hardcover case wraps the artwork around
the boards and turns it in, so its cover PDF is materially larger than trim
plus bleed, and getting it wrong is only visible on the finished object.

**This task is optional and independently droppable.** If it is not worth the
work, delete the `large-square` entry from `BOOK_SIZES` in Task 1 and ship two
softcover formats. A third softcover format is available at no rendering cost
at all — 140 × 140 mm, `photobooks-softcover_pf_140x140-mm-5_5x5_5-inch_…_ver`,
CHF 10.68 at 52 pages — if three formats matter more than a large one does.

- [ ] **Step 1: Write the failing test**

```ts
it("gives a hardcover its board and its wrap", () => {
  const hard = defaultSpec(BOOK_SIZES["large-square"]);
  const soft = defaultSpec(BOOK_SIZES["square"]);
  expect(soft.coverBoardMm).toBe(0);
  expect(hard.coverBoardMm).toBeGreaterThan(0);
  expect(hard.coverWrapMm).toBeGreaterThan(soft.coverWrapMm);
});

it("counts the board into the spine", () => {
  const hard = defaultSpec(BOOK_SIZES["large-square"]);
  const soft = { ...hard, coverBoardMm: 0 };
  expect(spineWidthMm(100, hard)).toBeGreaterThan(spineWidthMm(100, soft));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/photobook.test.ts`
Expected: FAIL — `coverBoardMm` is 0 for every size.

- [ ] **Step 3: Write minimal implementation**

```ts
export function defaultSpec(size: BookSize = BOOK_SIZES["square"]): BookSpec {
  const hard = size.cover === "hard";
  return {
    size,
    bleedMm: 3,
    safeMm: 10,
    gutterMm: 16,
    dpi: 300,
    paperCaliperMm: 0.115,
    // Two 2 mm boards. A hardcover spine is wider than its leaves by exactly
    // the board it is glued to, and a front image that creeps onto the spine
    // is invisible until a courier hands you twenty copies.
    coverBoardMm: hard ? 4 : 0,
    // The artwork wraps the boards and turns in behind them.
    coverWrapMm: hard ? 18 : 15,
    pageCount: GELATO_PAGE_RULE,
  };
}
```

In `render.ts`, widen the cover media box by `spec.coverWrapMm` on all four
edges when `spec.coverBoardMm > 0`, and offset the existing draw origin by the
same amount so the front, spine and back land where they already do relative to
trim.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run verify`
Expected: all green.

- [ ] **Step 5: Look at it, because no test can**

Run: `npm run photobook -- --trip <user>/<trip-id> --size large-square --guides`
Open the cover PDF. Trim, bleed and wrap must be distinguishable and the spine
must not carry front-cover artwork. Then open `/docs/branding/print` and check
the same constants render there. This is the `check-a-drawing` skill's job.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Photobook: a hardcover case has board and wrap"
```

---

## Self-review notes

- **Spec coverage.** Phase 0b's five bullets map to Tasks 1, 2, 3 (option
  removal), 5 (doc + uid) and 6 (hardcover). The bleed-box and 2409 px figures
  fall out of Task 1's trim change with no code of their own — `pageMediaBoxMm`
  and `requiredPixels` already compute from `spec`.
- **Not in this plan, on purpose:** the print flow, the signed file URL, the
  credits split. Those are the second plan.
- **Known consequence to state when this ships:** a short trip now pads to 28
  pages instead of stapling at 12. Gelato offers no saddle stitch, so the
  alternative was an option that could not be ordered.
