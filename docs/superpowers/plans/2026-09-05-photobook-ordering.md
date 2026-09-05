# Photobook Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The journal's owner opens the gallery, presses *Fotobuch erstellen*, configures a book with a live preview, pays with credits, and receives a mail linking to the print-ready PDFs — with no provider called.

**Architecture:** Six modules that already exist are joined by four new ones. `buildBookSource` → `planBook` → `renderPreview` produces the live preview; the same plan through `renderVolume`/`renderCover` produces the PDFs at pay time. Options are a plain data object threaded into the source builder and the planner. Money and orders reuse `lib/credits.ts` and the `print_orders` table. Both HTTP entry points sit outside `/api/v1/` and take the owner's cookie only.

**Tech Stack:** Next.js (app router, RSC), TypeScript, Kysely over SQLite/Postgres, vitest, the project's own PDF writer (`lib/postcard/pdf.ts`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-photobook-ordering-design.md`

## Global Constraints

- **Work in the worktree `.claude/worktrees/photobook-order`, branch `photobook-order`.** Never edit the shared checkout. Run `npm ci` in the worktree before the first `npm run build`.
- **Verify with `npm run verify`** (build → tsc → eslint → vitest). While iterating, run the single test file: `npx vitest run test/<file>.test.ts`.
- **Take task ids from `npm run tasks -- new`.** Never invent one. Anything noticed and not fixed goes to `backlog/`, referenced by id.
- **No new dependencies.**
- **Nothing personal in code.** `test/depersonalised.test.ts` fails the build if a real name or trip id appears outside `content/`. Fixtures use `alex/asia-2026`.
- **Every new i18n key goes in four places:** the union in `lib/i18n.ts`, and `content/locales/en.json`, `de.json`, `hu.json`. `test/locales.test.ts` enforces parity.
- **Money is integer credits.** Never a float, never a price computed in a component.
- **`lib/credits/pricing.ts` must stay client-safe** — no `server-only`, no database import. Same for `lib/photobook/options.ts`.
- **Placeholder prices must be able to say so.** Follow the `verified: false` discipline already used by `BINDING_PROFILES`.

---

## File Structure

**New:**

| File | Responsibility |
| --- | --- |
| `lib/photobook/options.ts` | `BookOptions` type, defaults, parsing from a form body. Client-safe. |
| `lib/photobook/entry.ts` | `photobookEntryFor(trip)` — may this reader order, and nothing else. |
| `lib/photobook/orders.ts` | `print_orders` rows with `kind: "photobook"`. |
| `lib/photobook/build.ts` | options → source → plan → PDFs on disk. |
| `lib/photobook/receipt.ts` | the thanks mail. |
| `app/[user]/(trip)/photobook/page.tsx` | current-trip options page (server). |
| `app/[user]/(trip)/photobook/PhotobookPageContent.tsx` | the form and the preview (client). |
| `app/[user]/trips/[trip]/photobook/page.tsx` | past-trip route, delegating to the same content. |
| `app/[user]/photobook/preview/route.ts` | POST options → preview HTML + page count + price. |
| `app/[user]/photobook/order/route.ts` | POST → spend, build, mail. |
| `app/[user]/photobooks/[id]/[file]/route.ts` | owner-gated PDF download. |

**Modified:** `lib/photobook/plan.ts` (options), `lib/photobook/source.ts` (options), `lib/photobook/preview.ts` (`srcFor`), `lib/credits/pricing.ts` (price), `lib/credits.ts` (`SpendReason`), `lib/capabilities.ts` (`db: true`), `lib/i18n.ts` + three locale files, `app/[user]/(trip)/gallery/GalleryPageContent.tsx` + `page.tsx`, `lib/types.ts` (`PhotobookEntry`).

---

### Task 1: Prove Next can bundle the planner

`lib/photobook/*` imports with explicit `.ts` specifiers (`from "./spec.ts"`), written for `tsx`. `tsconfig.json` sets `allowImportingTsExtensions: true` and `moduleResolution: "bundler"`, and vitest already resolves them — but **no file under `app/` has ever imported these modules**, so the bundler has never been asked. Every later task assumes it works. Find out in five minutes rather than at Task 10.

**Files:**
- Create (temporarily, deleted in step 4): `app/api/_photobook-probe/route.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the knowledge that `import { planBook } from "@/lib/photobook/plan"` compiles under Next. No code survives this task.

- [ ] **Step 1: Write the probe route**

```ts
// app/api/_photobook-probe/route.ts — temporary, deleted in this same task.
import { planBook } from "@/lib/photobook/plan";
import { defaultSpec } from "@/lib/photobook/spec";
import { buildBookSource } from "@/lib/photobook/source";

export async function GET() {
  return Response.json({
    ok: typeof planBook === "function" && typeof buildBookSource === "function",
    min: defaultSpec().pageCount.min,
  });
}
```

- [ ] **Step 2: Build**

Run: `npm ci && npm run build`
Expected: the build completes. If it fails with a module-resolution error naming `./spec.ts`, `./plan.ts` or `../postcard/pdf.ts`, apply the fallback in step 3; otherwise skip it.

- [ ] **Step 3: Fallback, only if step 2 failed**

Drop the extension from every relative import inside `lib/photobook/*.ts` and `lib/postcard/pdf.ts` — `from "./spec.ts"` becomes `from "./spec"`. Then run both consumers to prove neither broke:

```bash
npm run build
npx tsx --conditions=react-server scripts/photobook.ts --providers
```

Expected: the build passes and the CLI prints the provider list.

- [ ] **Step 4: Delete the probe and commit**

```bash
rm -rf app/api/_photobook-probe
git add -A
git commit -m "chore: confirm Next bundles the photobook modules"
```

If step 3 was needed, the commit carries the extension changes and the message becomes `fix: drop .ts import specifiers so Next can bundle the photobook modules`.

---

### Task 2: `BookOptions` and the planner's four toggles

**Files:**
- Create: `lib/photobook/options.ts`
- Modify: `lib/photobook/plan.ts` (`planBook`, `draftsForFront`, `draftsForChapter`, `draftsForBack`)
- Test: `test/photobook-options.test.ts`

**Interfaces:**
- Consumes: `planBook(source: BookSource, spec: BookSpec)` as it is today.
- Produces:
  - `type BookOptions = { size: string; binding: "perfect" | "saddle"; excludePhotos: readonly string[]; includeText: boolean; includeMap: boolean; includeChapters: boolean; includeNames: boolean; includeCosts: boolean }`
  - `const DEFAULT_OPTIONS: BookOptions`
  - `planBook(source: BookSource, spec: BookSpec, options?: BookOptions): Photobook` — the third parameter is optional and defaults to `DEFAULT_OPTIONS`, so the CLI and every existing test are untouched.

- [ ] **Step 1: Write the options module**

```ts
// lib/photobook/options.ts
/**
 * What is in the book, as opposed to how it is laid out.
 *
 * `plan.ts` says at its top that there is no template system and no theme
 * layer, and that stands: none of these is a style. They are answers to
 * "should the book contain my writing / the route map / the country dividers
 * / the cost summary", which is a question the person paying is entitled to,
 * and which the CLI answered by assuming yes.
 *
 * Client-safe on purpose — the options form renders these defaults before any
 * request is made, so this module must import nothing server-only.
 */

export type BookOptions = {
  /** A key of `BOOK_SIZES`. */
  size: string;
  binding: "perfect" | "saddle";
  /** `MediaTile.src` values left out of the book. */
  excludePhotos: readonly string[];
  /** The days' prose and the photo captions. Off gives a photo album with dates. */
  includeText: boolean;
  /** The two-page route spread. */
  includeMap: boolean;
  /** The chapter divider that opens each country. */
  includeChapters: boolean;
  /** Who travelled, on the title page and in the colophon. */
  includeNames: boolean;
  /** The cost summary page. */
  includeCosts: boolean;
};

export const DEFAULT_OPTIONS: BookOptions = {
  size: "square-210",
  binding: "perfect",
  excludePhotos: [],
  includeText: true,
  includeMap: true,
  includeChapters: true,
  includeNames: true,
  includeCosts: true,
};
```

- [ ] **Step 2: Write the failing test**

```ts
// test/photobook-options.test.ts
import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { BOOK_SIZES, defaultSpec, SADDLE_STITCH, fitsRule } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS, type BookOptions } from "@/lib/photobook/options";

const SPEC = defaultSpec(BOOK_SIZES["square-210"]);

function photo(over: Partial<BookPhoto> = {}): BookPhoto {
  return { file: "a.jpg", width: 4000, height: 3000, ...over };
}

function day(index: number, over: Partial<BookDay> = {}): BookDay {
  const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    date,
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: index > 2 ? "Laos" : "Thailand",
    countryCode: index > 2 ? "LA" : "TH",
    lat: 13.7 + index * 0.01,
    lng: 100.5 + index * 0.01,
    paragraphs: ["We walked a long way and ate something we could not name."],
    photos: [photo({ file: `p${index}-a.jpg`, caption: "A caption" }), photo({ file: `p${index}-b.jpg` })],
    ...over,
  };
}

function source(days: BookDay[]): BookSource {
  return {
    trip: {
      id: "test-trip",
      title: "A test trip",
      tagline: "Somewhere and back",
      start: days[0].date,
      end: days[days.length - 1].date,
      intro: "The plan was simple and it stayed simple.",
    },
    travellers: ["A", "B"],
    days,
    route: days.map((d) => ({ location: d.location, country: d.country, lat: d.lat, lng: d.lng })),
    madeOn: "2026-12-24",
    siteUrl: "https://example.test",
    costs: { total: "CHF 1200", rows: [{ label: "Food", amount: "CHF 400" }] },
  };
}

const DAYS = [day(0), day(1), day(2), day(3), day(4)];
const kinds = (options: BookOptions) =>
  planBook(source(DAYS), SPEC, options).volumes.flatMap((v) => v.pages.map((p) => p.kind));

describe("BookOptions", () => {
  test("the defaults plan the same book the CLI plans", () => {
    const withOptions = planBook(source(DAYS), SPEC, DEFAULT_OPTIONS);
    const without = planBook(source(DAYS), SPEC);
    expect(JSON.stringify(withOptions)).toBe(JSON.stringify(without));
  });

  test("includeMap: false removes the route spread and nothing else", () => {
    expect(kinds(DEFAULT_OPTIONS)).toContain("route");
    expect(kinds({ ...DEFAULT_OPTIONS, includeMap: false })).not.toContain("route");
  });

  test("includeChapters: false removes the dividers but keeps the days", () => {
    const off = kinds({ ...DEFAULT_OPTIONS, includeChapters: false });
    expect(off).not.toContain("chapter");
    expect(off).toContain("day");
  });

  test("includeCosts: false removes the cost page", () => {
    expect(kinds(DEFAULT_OPTIONS)).toContain("costs");
    expect(kinds({ ...DEFAULT_OPTIONS, includeCosts: false })).not.toContain("costs");
  });

  test("includeText: false keeps the day page but empties its prose and captions", () => {
    const book = planBook(source(DAYS), SPEC, { ...DEFAULT_OPTIONS, includeText: false });
    const days = book.volumes.flatMap((v) => v.pages).filter((p) => p.kind === "day");
    expect(days.length).toBeGreaterThan(0);
    for (const page of days) {
      expect(page.day.paragraphs).toEqual([]);
      expect(page.captions).toEqual([]);
    }
  });

  test("every toggle still yields a plan the binder accepts", () => {
    const combinations: BookOptions[] = [
      DEFAULT_OPTIONS,
      { ...DEFAULT_OPTIONS, includeText: false, includeMap: false },
      { ...DEFAULT_OPTIONS, includeChapters: false, includeCosts: false },
      { ...DEFAULT_OPTIONS, includeText: false, includeMap: false, includeChapters: false, includeCosts: false },
    ];
    for (const options of combinations) {
      const book = planBook(source(DAYS), SPEC, options);
      for (const volume of book.volumes) {
        expect(fitsRule(volume.interiorPages, SPEC.pageCount)).toBe(true);
      }
    }
  });

  test("saddle stitch plans a legal short book", () => {
    const spec = { ...defaultSpec(BOOK_SIZES["square-210"]), pageCount: SADDLE_STITCH };
    const book = planBook(source([day(0)]), spec, DEFAULT_OPTIONS);
    for (const volume of book.volumes) {
      expect(fitsRule(volume.interiorPages, SADDLE_STITCH)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/photobook-options.test.ts`
Expected: FAIL — `planBook` takes two arguments, and `@/lib/photobook/options` does not resolve.

- [ ] **Step 4: Thread the options through the planner**

In `lib/photobook/plan.ts`, import the type and give the three draft builders an options parameter:

```ts
import { DEFAULT_OPTIONS, type BookOptions } from "./options.ts";

function draftsForFront(source: BookSource, options: BookOptions): Draft[] {
  const drafts: Draft[] = [{ kind: "title", align: "recto" }];
  if (source.trip.intro.trim() && options.includeText) drafts.push({ kind: "intro" });
  if (options.includeMap && source.route.length >= 2) {
    drafts.push({ kind: "route", half: "left", align: "verso" });
    drafts.push({ kind: "route", half: "right" });
  }
  return drafts;
}

function draftsForBack(source: BookSource, options: BookOptions): Draft[] {
  const drafts: Draft[] = [];
  if (source.costs && options.includeCosts) drafts.push({ kind: "costs", align: "recto" });
  drafts.push({ kind: "colophon" });
  return drafts;
}

function draftsForChapter(
  chapter: Chapter,
  index: number,
  of: number,
  options: BookOptions,
): Draft[] {
  const drafts: Draft[] = options.includeChapters
    ? [{ kind: "chapter", chapter, index, of, align: "recto" }]
    : [];
  for (const day of chapter.days) {
    const [lead, ...rest] = day.photos;
    // The lead photo runs full bleed, so its caption has nowhere to live on
    // its own page. It joins the day's opening page instead.
    const captions = options.includeText
      ? day.photos.map((p) => p.caption).filter((c): c is string => Boolean(c))
      : [];
    // Text off still leaves a dated page in front of each day: a photo album
    // that cannot say when it was is worse than one with a heading.
    const written = options.includeText ? day : { ...day, paragraphs: [] };
    if (written.paragraphs.length > 0 || day.photos.length > 0) {
      drafts.push({ kind: "day", day: written, captions });
    }
    if (lead) drafts.push({ kind: "photos", layout: "full-bleed", photos: [lead] });
    for (const group of groupPhotos(rest)) {
      drafts.push({ kind: "photos", layout: group.layout, photos: group.photos });
    }
  }
  return drafts;
}
```

Then change `planBook`'s signature and its three call sites:

```ts
export function planBook(
  source: BookSource,
  spec: BookSpec,
  options: BookOptions = DEFAULT_OPTIONS,
): Photobook {
  // …unchanged…
  const front = draftsForFront(source, options);
  const back = draftsForBack(source, options);
  const blocks = chapters.map((ch, i) => draftsForChapter(ch, i + 1, chapters.length, options));
  // …unchanged…
}
```

`source.travellers` is left alone here — `includeNames` belongs to the source and is Task 3.

- [ ] **Step 5: Run the new test and the existing ones**

Run: `npx vitest run test/photobook-options.test.ts test/photobook.test.ts test/photobook-source.test.ts`
Expected: PASS, all three files. The "defaults plan the same book" test is the guard that the CLI's output has not moved.

- [ ] **Step 6: Commit**

```bash
git add lib/photobook/options.ts lib/photobook/plan.ts test/photobook-options.test.ts
git commit -m "feat: BookOptions — text, map, chapters and costs are choices"
```

---

### Task 3: Photo exclusion and traveller names in the source

**Files:**
- Modify: `lib/photobook/source.ts` (`SourceOptions`, `buildBookSource`)
- Test: `test/photobook-source.test.ts` (append)

**Interfaces:**
- Consumes: `buildBookSource(tripId: string, options?: SourceOptions): BookSource`.
- Produces: `SourceOptions` gains `excludePhotos?: readonly string[]` (matched against the entry's gallery `src`, which is what `MediaTile.src` carries) and `includeNames?: boolean` (default `true`; `false` empties `travellers`).

- [ ] **Step 1: Write the failing test**

Append to `test/photobook-source.test.ts`, reusing that file's `dir`, `REF` and `write` helpers:

```ts
describe("what the source leaves out", () => {
  test("excludePhotos drops exactly the named photographs", async () => {
    const all = buildBookSource(REF);
    const files = all.days.flatMap((d) => d.photos.map((p) => p.file));
    expect(files.length).toBeGreaterThan(1);

    const firstSrc = "01.jpg"; // the gallery src, not the print file
    const fewer = buildBookSource(REF, { excludePhotos: [firstSrc] });
    expect(fewer.days.flatMap((d) => d.photos).length).toBe(files.length - 1);
  });

  test("includeNames: false leaves the travellers out", () => {
    expect(buildBookSource(REF).travellers.length).toBeGreaterThan(0);
    expect(buildBookSource(REF, { includeNames: false }).travellers).toEqual([]);
  });

  test("excluding everything is a book with no photographs, not a crash", () => {
    const srcs = ["01.jpg", "02.jpg", "03.jpg", "04.jpg"];
    const empty = buildBookSource(REF, { excludePhotos: srcs });
    expect(empty.days.flatMap((d) => d.photos)).toEqual([]);
  });
});
```

Adjust the literal `src` values to whatever the fixture in that file writes into its entries' galleries — read the fixture at the top of the file first and use its real filenames.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-source.test.ts`
Expected: FAIL — `excludePhotos` is not a known property of `SourceOptions`.

- [ ] **Step 3: Implement**

```ts
export type SourceOptions = {
  /** Printed in the colophon. Defaults to today; passed in by tests. */
  madeOn?: string;
  /** Skip photographs below this pixel width entirely rather than printing
   * them soft. Off by default — a soft photo of something that happened once
   * still beats a gap. */
  minPixelWidth?: number;
  /**
   * Gallery `src` values to leave out, as chosen in the browser.
   *
   * Keyed on the entry's own `src` rather than on the resolved print file,
   * because that is the string the page has: `MediaTile.src` is what the
   * gallery renders and what the form posts back. The print file is derived
   * from it a line later and is not knowable to a browser.
   */
  excludePhotos?: readonly string[];
  /** Who travelled. `false` leaves the byline off. */
  includeNames?: boolean;
};
```

In `buildBookSource`, one line in the photo loop, before `printSourceFor` so an excluded photo costs no filesystem work:

```ts
  const excluded = new Set(options.excludePhotos ?? []);
  // …
      for (const item of entry.gallery) {
        if (item.type !== "image") continue;
        if (excluded.has(item.src)) continue;
        const print = printSourceFor(tripId, item.src);
```

and for the names:

```ts
  const travellers =
    options.includeNames === false
      ? []
      : travellersOf(config, trip)
          .map((p) => p.nickname || p.name)
          .filter(Boolean);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/photobook-source.test.ts test/photobook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/photobook/source.ts test/photobook-source.test.ts
git commit -m "feat: leave photographs and names out of a book on request"
```

---

### Task 4: What a book costs

**Files:**
- Modify: `lib/credits/pricing.ts`, `lib/credits.ts` (`SpendReason`)
- Test: `test/photobook-pricing.test.ts`

**Interfaces:**
- Produces:
  - `PHOTOBOOK_BASE_CREDITS: number`, `PHOTOBOOK_PAGE_CREDITS: number`, `PHOTOBOOK_PRICING_VERIFIED: false`
  - `photobookCredits(pages: number, sizeId: string): number`
  - `SpendReason` gains `"photobook"`.

- [ ] **Step 1: Write the failing test**

```ts
// test/photobook-pricing.test.ts
import { describe, expect, test } from "vitest";
import {
  PHOTOBOOK_BASE_CREDITS,
  PHOTOBOOK_PAGE_CREDITS,
  PHOTOBOOK_PRICING_VERIFIED,
  photobookCredits,
} from "@/lib/credits/pricing";

describe("what a photobook costs", () => {
  test("nobody has confirmed these numbers against a provider", () => {
    // They came from nowhere but arithmetic. When Gelato's price endpoint has
    // answered for a real productUid, change this to true in the same commit
    // that puts the real numbers in — this test is the reminder.
    expect(PHOTOBOOK_PRICING_VERIFIED).toBe(false);
  });

  test("a base plus a page term, always a whole number of credits", () => {
    const price = photobookCredits(52, "square-210");
    expect(price).toBe(PHOTOBOOK_BASE_CREDITS + PHOTOBOOK_PAGE_CREDITS * 52);
    expect(Number.isInteger(price)).toBe(true);
  });

  test("a wider page costs more paper", () => {
    expect(photobookCredits(52, "landscape-a4")).toBeGreaterThan(photobookCredits(52, "square-210"));
    expect(Number.isInteger(photobookCredits(52, "landscape-a4"))).toBe(true);
  });

  test("an unknown size is priced as the square, not as free", () => {
    expect(photobookCredits(52, "not-a-size")).toBe(photobookCredits(52, "square-210"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-pricing.test.ts`
Expected: FAIL — none of the four symbols exists.

- [ ] **Step 3: Implement**

Append to `lib/credits/pricing.ts`:

```ts
/**
 * What one printed photobook costs the owner — and every number here is a
 * guess.
 *
 * A postcard's fifteen credits came from a known unit cost. This one cannot,
 * because no photobook has ever been ordered from this instance and Gelato's
 * price endpoint needs an account and a real `productUid`. So the shape is
 * right — a fixed cost for the cover, binding and postage, plus a per-page
 * cost for paper and ink, times a factor for the larger sheet — and the
 * magnitudes are arithmetic against `docs/providers/photobook.md`'s
 * order-of-magnitude figures.
 *
 * `PHOTOBOOK_PRICING_VERIFIED` is how that is said in the data rather than
 * only in a comment, the same discipline `BINDING_PROFILES` uses.
 * `test/photobook-pricing.test.ts` asserts it, so the day somebody puts a real
 * quote in is a day they have to change a test on purpose.
 */
export const PHOTOBOOK_BASE_CREDITS = 90;
export const PHOTOBOOK_PAGE_CREDITS = 2;
export const PHOTOBOOK_PRICING_VERIFIED = false;

/** A4 is 1.4× the sheet area of the 210mm square, and paper is most of the
 * marginal cost. Rounded down to something defensible rather than modelled. */
const SIZE_FACTOR: Record<string, number> = {
  "square-210": 1,
  "landscape-a4": 1.25,
  "portrait-a4": 1.25,
};

/** One volume, one copy. A book split into volumes is priced per volume by the
 * caller, because each is a separate object with its own cover and postage. */
export function photobookCredits(pages: number, sizeId: string): number {
  const factor = SIZE_FACTOR[sizeId] ?? 1;
  return Math.ceil((PHOTOBOOK_BASE_CREDITS + PHOTOBOOK_PAGE_CREDITS * pages) * factor);
}
```

In `lib/credits.ts`, one word:

```ts
export type SpendReason = "day_mail" | "day_whatsapp" | "digest" | "postcard" | "photobook";
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/photobook-pricing.test.ts test/credits.test.ts`
Expected: PASS. (If `test/credits.test.ts` does not exist under that name, run `npx vitest run test/ --reporter dot` for the whole suite instead — it is fifty seconds.)

- [ ] **Step 5: Commit**

```bash
git add lib/credits/pricing.ts lib/credits.ts test/photobook-pricing.test.ts
git commit -m "feat: price a photobook in credits, and say the price is a guess"
```

---

### Task 5: The preview learns web URLs

**Files:**
- Modify: `lib/photobook/preview.ts` (`renderPreview`, `pageHtml`)
- Test: `test/photobook-preview.test.ts`

**Interfaces:**
- Consumes: `renderPreview(book: Photobook, outDir: string, resolveFile?: (file: string) => string): string`.
- Produces: an optional fourth parameter `srcFor?: (photo: BookPhoto) => string`. When given, it supplies the `<img src>` directly and `outDir`/`resolveFile` are not consulted for images. Default output is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// test/photobook-preview.test.ts
import { describe, expect, test } from "vitest";
import { planBook, type BookDay, type BookPhoto, type BookSource } from "@/lib/photobook/plan";
import { defaultSpec } from "@/lib/photobook/spec";
import { renderPreview } from "@/lib/photobook/preview";

function photo(file: string): BookPhoto {
  return { file, width: 4000, height: 3000 };
}

function day(index: number): BookDay {
  return {
    date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
    title: `Day ${index + 1}`,
    location: "Somewhere",
    country: "Thailand",
    countryCode: "TH",
    lat: 13.7,
    lng: 100.5,
    paragraphs: ["A short day."],
    photos: [photo(`p${index}.jpg`)],
  };
}

const SOURCE: BookSource = {
  trip: {
    id: "test-trip",
    title: "A test trip",
    tagline: "Somewhere and back",
    start: "2026-01-01",
    end: "2026-01-03",
    intro: "The plan was simple.",
  },
  travellers: ["A"],
  days: [day(0), day(1), day(2)],
  route: [],
  madeOn: "2026-12-24",
  siteUrl: "https://example.test",
};

const BOOK = planBook(SOURCE, defaultSpec());

describe("the preview's image sources", () => {
  test("srcFor replaces every img src and changes nothing else", () => {
    const relative = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    const web = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`, (p) => `/alex/media/${p.file}`);

    expect(web).toContain('src="/alex/media/p0.jpg"');
    expect(web).not.toContain('src="p0.jpg"');
    // Strip both files' src attributes: what is left must be identical, which
    // is how we know the layout did not move.
    const strip = (html: string) => html.replace(/src="[^"]*"/g, 'src="X"');
    expect(strip(web)).toBe(strip(relative));
  });

  test("without srcFor the output is the relative-path form the CLI writes", () => {
    const html = renderPreview(BOOK, "/tmp/out", (file) => `/tmp/out/${file}`);
    expect(html).toContain('src="p0.jpg"');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-preview.test.ts`
Expected: FAIL — `renderPreview` takes three arguments.

- [ ] **Step 3: Implement**

In `lib/photobook/preview.ts`, add the parameter to `pageHtml` and to `renderPreview`, and use it at the one place the `src` is computed (currently line 218):

```ts
export type SrcFor = (photo: BookPhoto) => string;

// inside pageHtml, replacing the existing `const src = …`:
        const src = srcFor
          ? srcFor(p.photo)
          : path.relative(outDir, resolveFile(p.photo.file)).split(path.sep).join("/");
```

```ts
export function renderPreview(
  book: Photobook,
  outDir: string,
  resolveFile: (file: string) => string = (file) => file,
  /**
   * Where the browser should fetch each photograph from.
   *
   * The CLI writes a folder and wants relative paths; the site serves
   * `/<user>/media/…` and has no folder. One callback rather than two
   * renderers — this file exists precisely so there is one layout, and a
   * second copy of it for the web would be the drift it was written to avoid.
   */
  srcFor?: SrcFor,
): string {
```

Thread `srcFor` down through the `volume.pages.map` call into `pageHtml`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/photobook-preview.test.ts test/photobook.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/photobook/preview.ts test/photobook-preview.test.ts
git commit -m "feat: the preview can point at web media instead of a folder"
```

---

### Task 6: Orders

**Files:**
- Create: `lib/photobook/orders.ts`
- Modify: `lib/capabilities.ts` (`photobook: { env: [], db: true }`)
- Test: `test/photobook-orders.test.ts`

**Interfaces:**
- Consumes: `getDatabaseOrNull`, `newId`, `nowIso` from `@/lib/db`; `BookOptions`.
- Produces:
  - `type PhotobookOrder = { id: string; owner: string; status: string; payload: PhotobookPayload; createdAt: string; updatedAt: string }`
  - `type PhotobookPayload = { trip: string; options: BookOptions; pages: number; volumes: number; credits: number; files?: string[]; failure?: string }`
  - `claimOrder(owner: string, id: string, payload: PhotobookPayload): Promise<boolean>` — inserts `status: "submitted"`; `false` when the id is already taken.
  - `getPhotobookOrder(owner: string, id: string): Promise<PhotobookOrder | null>`
  - `markPrinted(owner: string, id: string, payload: PhotobookPayload): Promise<void>`
  - `markFailed(owner: string, id: string, payload: PhotobookPayload, failure: string): Promise<void>`
  - `ORDER_ID_RE: RegExp`

- [ ] **Step 1: Write the failing test**

```ts
// test/photobook-orders.test.ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import {
  ORDER_ID_RE,
  claimOrder,
  getPhotobookOrder,
  markFailed,
  markPrinted,
  type PhotobookPayload,
} from "@/lib/photobook/orders";

// Follow test/postcard-orders.test.ts for database setup — copy its
// beforeEach/afterEach verbatim (temporary SQLite file, migrateToLatest,
// closeDatabase) rather than inventing a second harness.

const OWNER = "alex";
const PAYLOAD: PhotobookPayload = {
  trip: "alex/asia-2026",
  options: DEFAULT_OPTIONS,
  pages: 52,
  volumes: 1,
  credits: 194,
};

describe("photobook orders", () => {
  test("an order id is a plain token", () => {
    expect(ORDER_ID_RE.test("abc12345")).toBe(true);
    expect(ORDER_ID_RE.test("../../etc/passwd")).toBe(false);
    expect(ORDER_ID_RE.test("a")).toBe(false);
  });

  test("claiming writes a submitted order the owner can read back", async () => {
    expect(await claimOrder(OWNER, "order-one-1234", PAYLOAD)).toBe(true);
    const order = await getPhotobookOrder(OWNER, "order-one-1234");
    expect(order?.status).toBe("submitted");
    expect(order?.payload.credits).toBe(194);
  });

  test("a second press of the same button claims nothing", async () => {
    expect(await claimOrder(OWNER, "order-two-1234", PAYLOAD)).toBe(true);
    expect(await claimOrder(OWNER, "order-two-1234", PAYLOAD)).toBe(false);
  });

  test("another journal cannot read the order by guessing its id", async () => {
    await claimOrder(OWNER, "order-three-123", PAYLOAD);
    expect(await getPhotobookOrder("sam", "order-three-123")).toBeNull();
  });

  test("printed and failed are recorded with the payload", async () => {
    await claimOrder(OWNER, "order-four-1234", PAYLOAD);
    await markPrinted(OWNER, "order-four-1234", { ...PAYLOAD, files: ["interior.pdf", "cover.pdf"] });
    expect((await getPhotobookOrder(OWNER, "order-four-1234"))?.status).toBe("printed");

    await claimOrder(OWNER, "order-five-1234", PAYLOAD);
    await markFailed(OWNER, "order-five-1234", PAYLOAD, "render threw");
    const failed = await getPhotobookOrder(OWNER, "order-five-1234");
    expect(failed?.status).toBe("failed");
    expect(failed?.payload.failure).toBe("render threw");
  });

  test("nothing under app/api can reach the order builder", () => {
    // The same guarantee test/postcard-orders.test.ts makes about sendOrder,
    // for the same reason: an agent must not be able to spend credits.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) walk(full);
        else if (item.name.endsWith(".ts") || item.name.endsWith(".tsx")) {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes("photobook/build") || text.includes("photobook/orders")) {
            offenders.push(full);
          }
        }
      }
    };
    walk("app/api");
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-orders.test.ts`
Expected: FAIL — `@/lib/photobook/orders` does not resolve.

- [ ] **Step 3: Implement**

```ts
// lib/photobook/orders.ts
import "server-only";
import { getDatabaseOrNull, nowIso } from "../db";
import type { BookOptions } from "./options";

/**
 * A photobook order: a row that says money moved and paper was planned.
 *
 * ## Why the row appears at pay and not before
 *
 * A postcard order is a *proposal*: an agent composes it and a person looks at
 * it later, so the row has to exist before anybody presses anything. Nothing
 * of that applies here. The person configuring the book and the person paying
 * for it are one person looking at one screen, and a row per abandoned
 * configuration would be a table of half-imagined books nobody will ever open.
 *
 * ## What replaces `claimForSend`
 *
 * The double-press guard is still rows-affected rather than read-then-write,
 * but the statement is the insert: the page renders an id, the form posts it,
 * and `id` is the primary key. Two presses race to insert the same key and
 * exactly one of them wins. The second is told the book is already being
 * made, which is true.
 *
 * That id arrives from a browser, so it is validated rather than trusted —
 * it names a directory under `content/<user>/photobooks/` a moment later.
 */

/** Long enough not to collide, plain enough to be a directory name. */
export const ORDER_ID_RE = /^[a-z0-9][a-z0-9-]{6,63}$/;

export type PhotobookPayload = {
  /** `<username>/<trip-id>`. */
  trip: string;
  options: BookOptions;
  /** Interior pages, summed over the volumes. */
  pages: number;
  volumes: number;
  /** What was charged, in credits. Frozen here: the price table may change. */
  credits: number;
  /** File names under the order's directory, written when the render finishes. */
  files?: string[];
  /** Why nothing was made. Set with `failed`, and the credits are back. */
  failure?: string;
};

export type PhotobookOrder = {
  id: string;
  owner: string;
  status: string;
  payload: PhotobookPayload;
  createdAt: string;
  updatedAt: string;
};

export async function claimOrder(
  owner: string,
  id: string,
  payload: PhotobookPayload,
): Promise<boolean> {
  if (!ORDER_ID_RE.test(id)) return false;
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const now = nowIso();
  try {
    await handle.db
      .insertInto("print_orders")
      .values({
        id,
        owner_id: owner,
        kind: "photobook",
        // No provider has been called and none will be by this code path.
        // `dry-run` is what the postcard pipeline calls the same honesty.
        provider: "dry-run",
        provider_ref: null,
        contact_id: null,
        trip_id: payload.trip,
        status: "submitted",
        payload: JSON.stringify(payload),
        cost_minor: null,
        currency: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return true;
  } catch {
    // A primary-key conflict is the second press, and it is the expected
    // outcome rather than an error worth surfacing. Any other insert failure
    // reaches the caller the same way, as "somebody already has this", which
    // is the safe reading: it charges nothing.
    return false;
  }
}

export async function getPhotobookOrder(owner: string, id: string): Promise<PhotobookOrder | null> {
  if (!ORDER_ID_RE.test(id)) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("print_orders")
    .select(["id", "owner_id", "status", "payload", "created_at", "updated_at"])
    .where("id", "=", id)
    // Scoped in the query, never compared afterwards — a caller cannot forget
    // a check it was never handed the material for.
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner_id,
    status: row.status,
    payload: JSON.parse(row.payload) as PhotobookPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function setStatus(
  owner: string,
  id: string,
  status: string,
  payload: PhotobookPayload,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("print_orders")
    .set({ status, payload: JSON.stringify(payload), updated_at: nowIso() })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .execute();
}

export async function markPrinted(
  owner: string,
  id: string,
  payload: PhotobookPayload,
): Promise<void> {
  await setStatus(owner, id, "printed", payload);
}

export async function markFailed(
  owner: string,
  id: string,
  payload: PhotobookPayload,
  failure: string,
): Promise<void> {
  await setStatus(owner, id, "failed", { ...payload, failure });
}
```

And in `lib/capabilities.ts`:

```ts
  // Orders are rows and so is the balance that pays for them, so a journal
  // with no database has no photobook button — /api/health says which.
  photobook: { env: [], db: true },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/photobook-orders.test.ts test/capabilities.test.ts`
Expected: PASS. If `test/capabilities.test.ts` asserts the old `db: false`, update that assertion in this commit — it is the same fact.

- [ ] **Step 5: Commit**

```bash
git add lib/photobook/orders.ts lib/capabilities.ts test/photobook-orders.test.ts
git commit -m "feat: photobook orders, claimed by their primary key"
```

---

### Task 7: Building the files

**Files:**
- Create: `lib/photobook/build.ts`
- Test: `test/photobook-build.test.ts`

**Interfaces:**
- Consumes: `buildBookSource`, `planBook`, `renderVolume`, `renderCover`, `resolvePrintFile`, `renderPreview`, `photobookCredits`, `BookOptions`.
- Produces:
  - `specFor(options: BookOptions): BookSpec`
  - `planFor(trip: string, options: BookOptions): Photobook`
  - `priceOf(book: Photobook, options: BookOptions): number`
  - `buildPhotobook(owner: string, orderId: string, trip: string, options: BookOptions): { files: string[]; pages: number; volumes: number }`
  - `orderDir(owner: string, orderId: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/photobook-build.test.ts
import { describe, expect, test } from "vitest";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";
import { specFor, priceOf } from "@/lib/photobook/build";
import { planBook } from "@/lib/photobook/plan";
import { BOOK_SIZES, SADDLE_STITCH, portableRule } from "@/lib/photobook/spec";
import { photobookCredits } from "@/lib/credits/pricing";

// planFor and buildPhotobook read the filesystem; they are exercised by the
// fixture-backed test in Task 11's manual pass and by photobook-source's
// harness. What is unit-tested here is the two pure decisions.

describe("spec from options", () => {
  test("the size comes from the catalogue and an unknown one falls back to the square", () => {
    expect(specFor({ ...DEFAULT_OPTIONS, size: "landscape-a4" }).size).toBe(BOOK_SIZES["landscape-a4"]);
    expect(specFor({ ...DEFAULT_OPTIONS, size: "nonsense" }).size).toBe(BOOK_SIZES["square-210"]);
  });

  test("saddle stitch changes the page-count rule, perfect binding keeps the portable one", () => {
    expect(specFor({ ...DEFAULT_OPTIONS, binding: "saddle" }).pageCount).toEqual(SADDLE_STITCH);
    expect(specFor({ ...DEFAULT_OPTIONS, binding: "perfect" }).pageCount).toEqual(portableRule());
  });
});

describe("price of a planned book", () => {
  test("a multi-volume book is priced per volume", () => {
    const book = {
      volumes: [{ interiorPages: 40 }, { interiorPages: 60 }],
    } as unknown as ReturnType<typeof planBook>;
    expect(priceOf(book, DEFAULT_OPTIONS)).toBe(
      photobookCredits(40, "square-210") + photobookCredits(60, "square-210"),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-build.test.ts`
Expected: FAIL — `@/lib/photobook/build` does not resolve.

- [ ] **Step 3: Implement**

```ts
// lib/photobook/build.ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import { photobookCredits } from "../credits/pricing";
import { planBook, type Photobook } from "./plan";
import { buildBookSource, resolvePrintFile } from "./source";
import { BOOK_SIZES, SADDLE_STITCH, defaultSpec, portableRule, type BookSpec } from "./spec";
import { renderCover, renderVolume } from "./render";
import type { BookOptions } from "./options";

/**
 * Options in, files out — the same three calls `scripts/photobook.ts` makes.
 *
 * Deliberately the same, and not a second pipeline: if the CLI and the button
 * produced different books, the preview HTML somebody approved would be
 * evidence about neither. This module is the CLI's middle, lifted out so a
 * route can call it, with the page count and the price as its only additions.
 *
 * ponytail: renders synchronously, in the request that pays. A 160-page book
 * is tens of seconds and hundreds of megabytes of JPEG copying. It is one
 * person pressing one button a few times a year, and a job queue is a
 * subsystem to run and recover. When that stops being true, the upgrade is to
 * respond first and mail when the files are on disk — the mail already carries
 * links rather than the PDF, so nothing else changes.
 */

export function specFor(options: BookOptions): BookSpec {
  const size = BOOK_SIZES[options.size] ?? BOOK_SIZES["square-210"];
  const spec = defaultSpec(size);
  return { ...spec, pageCount: options.binding === "saddle" ? SADDLE_STITCH : portableRule() };
}

export function planFor(trip: string, options: BookOptions): Photobook {
  const source = buildBookSource(trip, {
    excludePhotos: options.excludePhotos,
    includeNames: options.includeNames,
  });
  return planBook(source, specFor(options), options);
}

/** Per volume, because each volume is a separate book with its own cover and
 * its own postage. */
export function priceOf(book: Photobook, options: BookOptions): number {
  return book.volumes.reduce((sum, v) => sum + photobookCredits(v.interiorPages, options.size), 0);
}

export function orderDir(owner: string, orderId: string): string {
  return path.join(contentRoot(), owner, "photobooks", orderId);
}

export function buildPhotobook(
  owner: string,
  orderId: string,
  trip: string,
  options: BookOptions,
): { files: string[]; pages: number; volumes: number } {
  const book = planFor(trip, options);
  const spec = book.spec;
  const dir = orderDir(owner, orderId);
  fs.mkdirSync(dir, { recursive: true });

  const loadImage = (file: string) => new Uint8Array(fs.readFileSync(resolvePrintFile(file)));
  const files: string[] = [];

  for (const volume of book.volumes) {
    const stem = book.volumes.length > 1 ? `v${volume.index}` : "book";
    const interior = renderVolume(volume, spec, { loadImage });
    const cover = renderCover(volume, spec, { loadImage });
    fs.writeFileSync(path.join(dir, `${stem}-interior.pdf`), interior.pdf);
    fs.writeFileSync(path.join(dir, `${stem}-cover.pdf`), cover.pdf);
    files.push(`${stem}-interior.pdf`, `${stem}-cover.pdf`);
  }

  return {
    files,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/photobook-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/photobook/build.ts test/photobook-build.test.ts
git commit -m "feat: build a photobook's PDFs from options"
```

---

### Task 8: The receipt mail and its words

**Files:**
- Create: `lib/photobook/receipt.ts`
- Modify: `lib/i18n.ts`, `content/locales/en.json`, `content/locales/de.json`, `content/locales/hu.json`
- Test: `test/photobook-receipt.test.ts`

**Interfaces:**
- Consumes: `sendTransactional`, `renderMail`, `translateIn`, `pickLocale`, `serverSite`, `getUser`.
- Produces: `sendPhotobookReceipt(input: { owner: string; orderId: string; tripTitle: string; pages: number; volumes: number; creditsSpent: number; balance: number | null; files: string[] }): Promise<void>`

- [ ] **Step 1: Add the strings**

Add to the key union in `lib/i18n.ts` (alphabetically among the other `photobook.*` keys, creating that group if it is the first):

```ts
  | "photobook.start"
  | "photobook.title"
  | "photobook.intro"
  | "photobook.option.size"
  | "photobook.option.binding"
  | "photobook.option.bindingPerfect"
  | "photobook.option.bindingSaddle"
  | "photobook.option.text"
  | "photobook.option.map"
  | "photobook.option.chapters"
  | "photobook.option.names"
  | "photobook.option.costs"
  | "photobook.option.photos"
  | "photobook.pages"
  | "photobook.price"
  | "photobook.balance"
  | "photobook.pay"
  | "photobook.tooPoor"
  | "photobook.building"
  | "photobook.done"
  | "photobook.failed"
  | "photobook.receipt.subject"
  | "photobook.receipt.preheader"
  | "photobook.receipt.title"
  | "photobook.receipt.body"
  | "photobook.receipt.cost"
  | "photobook.receipt.costAndBalance"
  | "photobook.receipt.download"
  | "photobook.receipt.notPrinted"
  | "photobook.receipt.footer"
```

`content/locales/en.json`:

```json
  "photobook.start": "Make a photobook",
  "photobook.title": "Photobook",
  "photobook.intro": "Choose what goes in the book. The preview is the printed page — if something is in the wrong place here, it is in the wrong place on paper.",
  "photobook.option.size": "Format",
  "photobook.option.binding": "Binding",
  "photobook.option.bindingPerfect": "Perfect bound (32–160 pages)",
  "photobook.option.bindingSaddle": "Saddle stitch (4–48 pages)",
  "photobook.option.text": "Include the writing",
  "photobook.option.map": "Include the route map",
  "photobook.option.chapters": "Include chapter dividers",
  "photobook.option.names": "Include who travelled",
  "photobook.option.costs": "Include the cost summary",
  "photobook.option.photos": "Photographs",
  "photobook.pages": "{pages} pages in {volumes} volume(s)",
  "photobook.price": "{credits} credits",
  "photobook.balance": "You have {balance} credits",
  "photobook.pay": "Pay with credits",
  "photobook.tooPoor": "This book costs {credits} credits and you have {balance}.",
  "photobook.building": "Building the book — this takes a minute for a long trip.",
  "photobook.done": "Ordered. The files are ready and a mail is on its way.",
  "photobook.failed": "The book could not be built, and your credits are back.",
  "photobook.receipt.subject": "Your photobook of {trip}",
  "photobook.receipt.preheader": "{pages} pages, ready to download",
  "photobook.receipt.title": "Thank you — your photobook is ready",
  "photobook.receipt.body": "{trip}, {pages} pages in {volumes} volume(s). The interior and the cover are separate files, which is how a printer wants them.",
  "photobook.receipt.cost": "{total} credits.",
  "photobook.receipt.costAndBalance": "{total} credits. You have {balance} left.",
  "photobook.receipt.download": "Download",
  "photobook.receipt.notPrinted": "Nothing has been printed and nothing has been posted. This instance has no print account yet — the files are yours to send anywhere.",
  "photobook.receipt.footer": "Fernscout",
```

`content/locales/de.json`:

```json
  "photobook.start": "Fotobuch erstellen",
  "photobook.title": "Fotobuch",
  "photobook.intro": "Wähle, was ins Buch kommt. Die Vorschau ist die gedruckte Seite — was hier falsch sitzt, sitzt auch auf Papier falsch.",
  "photobook.option.size": "Format",
  "photobook.option.binding": "Bindung",
  "photobook.option.bindingPerfect": "Klebebindung (32–160 Seiten)",
  "photobook.option.bindingSaddle": "Rückenstich (4–48 Seiten)",
  "photobook.option.text": "Texte mitdrucken",
  "photobook.option.map": "Routenkarte mitdrucken",
  "photobook.option.chapters": "Kapiteltrenner mitdrucken",
  "photobook.option.names": "Wer unterwegs war",
  "photobook.option.costs": "Kostenübersicht mitdrucken",
  "photobook.option.photos": "Fotos",
  "photobook.pages": "{pages} Seiten in {volumes} Band/Bänden",
  "photobook.price": "{credits} Credits",
  "photobook.balance": "Du hast {balance} Credits",
  "photobook.pay": "Mit Credits bezahlen",
  "photobook.tooPoor": "Dieses Buch kostet {credits} Credits, du hast {balance}.",
  "photobook.building": "Das Buch wird gebaut — bei einer langen Reise dauert das eine Minute.",
  "photobook.done": "Bestellt. Die Dateien sind bereit, eine Mail ist unterwegs.",
  "photobook.failed": "Das Buch konnte nicht gebaut werden, deine Credits sind zurück.",
  "photobook.receipt.subject": "Dein Fotobuch von {trip}",
  "photobook.receipt.preheader": "{pages} Seiten, bereit zum Download",
  "photobook.receipt.title": "Danke — dein Fotobuch ist fertig",
  "photobook.receipt.body": "{trip}, {pages} Seiten in {volumes} Band/Bänden. Inhalt und Umschlag sind getrennte Dateien, so will es eine Druckerei.",
  "photobook.receipt.cost": "{total} Credits.",
  "photobook.receipt.costAndBalance": "{total} Credits. Du hast noch {balance}.",
  "photobook.receipt.download": "Herunterladen",
  "photobook.receipt.notPrinted": "Es wurde nichts gedruckt und nichts verschickt. Diese Instanz hat noch kein Druckkonto — die Dateien gehören dir.",
  "photobook.receipt.footer": "Fernscout",
```

`content/locales/hu.json`:

```json
  "photobook.start": "Fotókönyv készítése",
  "photobook.title": "Fotókönyv",
  "photobook.intro": "Válaszd ki, mi kerüljön a könyvbe. Az előnézet a nyomtatott oldal — ami itt rossz helyen van, a papíron is rossz helyen lesz.",
  "photobook.option.size": "Formátum",
  "photobook.option.binding": "Kötés",
  "photobook.option.bindingPerfect": "Ragasztott (32–160 oldal)",
  "photobook.option.bindingSaddle": "Tűzött (4–48 oldal)",
  "photobook.option.text": "Szövegekkel",
  "photobook.option.map": "Útvonaltérképpel",
  "photobook.option.chapters": "Fejezetelválasztókkal",
  "photobook.option.names": "Kik utaztak",
  "photobook.option.costs": "Költségösszesítővel",
  "photobook.option.photos": "Fényképek",
  "photobook.pages": "{pages} oldal, {volumes} kötetben",
  "photobook.price": "{credits} kredit",
  "photobook.balance": "{balance} kredited van",
  "photobook.pay": "Fizetés kreditből",
  "photobook.tooPoor": "Ez a könyv {credits} kreditbe kerül, neked {balance} van.",
  "photobook.building": "Készül a könyv — hosszú útnál ez eltart egy percig.",
  "photobook.done": "Megrendelve. A fájlok készen állnak, a levél úton van.",
  "photobook.failed": "A könyvet nem sikerült elkészíteni, a kreditek visszakerültek.",
  "photobook.receipt.subject": "A fotókönyved: {trip}",
  "photobook.receipt.preheader": "{pages} oldal, letölthető",
  "photobook.receipt.title": "Köszönjük — a fotókönyved kész",
  "photobook.receipt.body": "{trip}, {pages} oldal {volumes} kötetben. A belív és a borító külön fájl, a nyomda így kéri.",
  "photobook.receipt.cost": "{total} kredit.",
  "photobook.receipt.costAndBalance": "{total} kredit. Maradt {balance}.",
  "photobook.receipt.download": "Letöltés",
  "photobook.receipt.notPrinted": "Semmi nem került nyomtatásra és postázásra. Ennek a példánynak még nincs nyomdai fiókja — a fájlok a tieid.",
  "photobook.receipt.footer": "Fernscout",
```

- [ ] **Step 2: Run the locale parity test**

Run: `npx vitest run test/locales.test.ts`
Expected: PASS. If it fails, a key is missing from one of the three files or from the union — fix it before going on.

- [ ] **Step 3: Write the failing receipt test**

```ts
// test/photobook-receipt.test.ts
import { describe, expect, test } from "vitest";

// Copy the mail harness from test/postcard-receipt.test.ts verbatim: it points
// MAIL_TRANSPORT at the file backend, sets a temporary content root, and reads
// the .eml back. Do not invent a second one.

describe("the photobook receipt", () => {
  test("links to both files and never claims anything was printed", async () => {
    const eml = await sendAndRead({
      owner: "alex",
      orderId: "order-abc12345",
      tripTitle: "Asia 2026",
      pages: 52,
      volumes: 1,
      creditsSpent: 194,
      balance: 306,
      files: ["book-interior.pdf", "book-cover.pdf"],
    });

    expect(eml).toContain("book-interior.pdf");
    expect(eml).toContain("book-cover.pdf");
    expect(eml).toContain("/alex/photobooks/order-abc12345/");
    expect(eml).toContain("194");
    // Links, never the file: a 300-DPI book does not fit in a mailbox.
    expect(eml).not.toContain("Content-Disposition: attachment");
    // The words a reader must not find, because no provider was called.
    expect(eml.toLowerCase()).not.toMatch(/\bposted\b|\bshipped\b/);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run test/photobook-receipt.test.ts`
Expected: FAIL — `@/lib/photobook/receipt` does not resolve.

- [ ] **Step 5: Implement**

```ts
// lib/photobook/receipt.ts
import "server-only";
import { getUser } from "../users";
import { translateIn } from "../locales";
import { pickLocale } from "../contacts/locale";
import { sendTransactional } from "../mail";
import { renderMail } from "../mail/template";
import { serverSite } from "../site";
import type { Locale } from "../types";

/**
 * What was made, what it cost, and where the files are.
 *
 * Links rather than an attachment, and that is not a shortcut: a 60-page book
 * at 300 DPI is hundreds of megabytes and no mailbox takes it. The postcard
 * receipt attaches its card because a card is one sheet.
 *
 * **It must not say the book was printed or posted**, because nothing was.
 * `test/photobook-receipt.test.ts` checks the words. Transactional, free, and
 * best effort — the files exist by the time this runs, so a dead SMTP host
 * must not turn a finished book into a reported failure.
 */

export type PhotobookReceiptInput = {
  owner: string;
  orderId: string;
  tripTitle: string;
  pages: number;
  volumes: number;
  creditsSpent: number;
  balance: number | null;
  files: string[];
};

export async function sendPhotobookReceipt(input: PhotobookReceiptInput): Promise<void> {
  const user = getUser(input.owner);
  const to = user?.owner.email;
  if (!to) return;

  const locale: Locale = pickLocale(user.defaultLocale);
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const base = `${serverSite().url}/${input.owner}/photobooks/${input.orderId}`;
  const numbers = {
    trip: input.tripTitle,
    pages: String(input.pages),
    volumes: String(input.volumes),
  };

  const content = {
    preheader: t("photobook.receipt.preheader", numbers),
    title: t("photobook.receipt.title"),
    blocks: [
      { kind: "paragraph" as const, text: t("photobook.receipt.body", numbers) },
      {
        kind: "paragraph" as const,
        text:
          input.balance === null
            ? t("photobook.receipt.cost", { total: String(input.creditsSpent) })
            : t("photobook.receipt.costAndBalance", {
                total: String(input.creditsSpent),
                balance: String(input.balance),
              }),
      },
      ...input.files.map((file) => ({
        kind: "item" as const,
        title: `${t("photobook.receipt.download")} — ${file}`,
        href: `${base}/${file}`,
      })),
      { kind: "paragraph" as const, text: t("photobook.receipt.notPrinted") },
    ],
    footer: t("photobook.receipt.footer"),
  };

  try {
    await sendTransactional(
      renderMail(to, t("photobook.receipt.subject", numbers), content, input.owner),
      `photobook receipt for ${input.orderId}`,
    );
  } catch (error) {
    console.error(`[photobook] receipt for ${input.orderId} could not be sent:`, error);
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/photobook-receipt.test.ts test/locales.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/photobook/receipt.ts lib/i18n.ts content/locales test/photobook-receipt.test.ts
git commit -m "feat: a receipt that links to the book and does not claim it was printed"
```

---

### Task 9: The gate and the gallery button

**Files:**
- Create: `lib/photobook/entry.ts`
- Modify: `lib/types.ts`, `app/[user]/(trip)/gallery/page.tsx`, `app/[user]/(trip)/gallery/GalleryPageContent.tsx`, `app/[user]/trips/[trip]/gallery/page.tsx`
- Test: `test/photobook-entry.test.ts`

**Interfaces:**
- Consumes: `isEnabled`, `isOwner`, `getUser`, `Trip`.
- Produces:
  - `type PhotobookEntry = { username: string; trip: string }` in `lib/types.ts`
  - `photobookEntryFor(trip: Trip): Promise<PhotobookEntry | undefined>`
  - `GalleryPageContent` gains an optional `photobook?: PhotobookEntry` prop.

- [ ] **Step 1: Write the failing test**

```ts
// test/photobook-entry.test.ts
import { describe, expect, test, vi, beforeEach } from "vitest";

// Mirror test/postcard-entry.test.ts if it exists; otherwise mock the three
// collaborators the gate consults.
vi.mock("@/lib/capabilities", () => ({ isEnabled: vi.fn() }));
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { photobookEntryFor } from "@/lib/photobook/entry";
import type { Trip } from "@/lib/types";

const TRIP = { username: "alex", id: "asia-2026", ref: "alex/asia-2026" } as Trip;

beforeEach(() => {
  vi.mocked(isEnabled).mockReturnValue(true);
  vi.mocked(isOwner).mockResolvedValue(true);
});

describe("who may order a photobook", () => {
  test("the owner of a journal with photobook and credits on", async () => {
    await expect(photobookEntryFor(TRIP)).resolves.toEqual({
      username: "alex",
      trip: "asia-2026",
    });
  });

  test("nobody, when the reader is not the owner", async () => {
    vi.mocked(isOwner).mockResolvedValue(false);
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });

  test("nobody, when credits are off — a button that cannot be paid for is a lie", async () => {
    vi.mocked(isEnabled).mockImplementation((name: string) => name !== "credits");
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });

  test("nobody, when photobook is off", async () => {
    vi.mocked(isEnabled).mockImplementation((name: string) => name !== "photobook");
    await expect(photobookEntryFor(TRIP)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-entry.test.ts`
Expected: FAIL — `@/lib/photobook/entry` does not resolve.

- [ ] **Step 3: Implement the gate**

```ts
// lib/photobook/entry.ts
import "server-only";
import { isEnabled } from "../capabilities";
import { isOwner } from "../contacts/session";
import type { PhotobookEntry, Trip } from "../types";

/**
 * May the person reading this page order a book of it.
 *
 * One question in one file, for the reason `lib/postcard/entry.ts` gives at
 * length: the gallery page decides draft visibility a few lines earlier, and
 * `test/draft-audience.test.ts` fails any file under `app/[user]/` that
 * mentions a draft and calls `isOwner`. The honest way past that rule is to
 * have no `isOwner` call in the page, not to add the page to an allowlist.
 *
 * `undefined` for everybody who may not, so a caller has nothing to render
 * rather than a flag to remember to check. Credits are as load-bearing as the
 * capability named after the feature: a Pay button on a journal that cannot
 * be paid from is a button that lies.
 *
 * This decides what is *shown*. Both routes ask for themselves.
 */
export async function photobookEntryFor(trip: Trip): Promise<PhotobookEntry | undefined> {
  const username = trip.username;
  if (!isEnabled("photobook", username) || !isEnabled("credits", username)) return undefined;
  if (!(await isOwner(username))) return undefined;
  return { username, trip: trip.id };
}
```

In `lib/types.ts`, beside `PostcardEntry`:

```ts
/** What the gallery needs to offer a photobook: who, and of what. The rest of
 * an order is chosen on the photobook page itself. */
export type PhotobookEntry = {
  username: string;
  trip: string;
};
```

- [ ] **Step 4: Add the button**

In `GalleryPageContent.tsx`, extend the props and add the control **before** the postcard button, so the two read left to right as book then card:

```tsx
import { BookOpen, Clapperboard, Send } from "lucide-react";
import type { MediaTile, PhotobookEntry, PostcardEntry } from "@/lib/types";

// props
  photobook?: PhotobookEntry;

// in the button row, first child
            {photobook && media.length > 0 && (
              <a
                href={`/${photobook.username}/trips/${photobook.trip}/photobook`}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-700 transition-colors hover:border-navy-500"
              >
                <BookOpen className="h-4 w-4" />
                {t("photobook.start")}
              </a>
            )}
```

A link and not a picker: a book is the whole trip, so there is nothing to select in the gallery first.

In both gallery `page.tsx` files, one call beside the postcard one:

```ts
import { photobookEntryFor } from "@/lib/photobook/entry";
// …
  const photobook = await photobookEntryFor(trip);
// …
      <GalleryPageContent … photobook={photobook} />
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/photobook-entry.test.ts test/draft-audience.test.ts`
Expected: PASS — the second is the one that fails if the gate got inlined into the page.

- [ ] **Step 6: Commit**

```bash
git add lib/photobook/entry.ts lib/types.ts "app/[user]/(trip)/gallery" "app/[user]/trips/[trip]/gallery" test/photobook-entry.test.ts
git commit -m "feat: a photobook button in the gallery, for the owner only"
```

---

### Task 10: The options page and its preview

**Files:**
- Create: `app/[user]/(trip)/photobook/page.tsx`, `app/[user]/(trip)/photobook/PhotobookPageContent.tsx`, `app/[user]/trips/[trip]/photobook/page.tsx`, `app/[user]/photobook/preview/route.ts`
- Test: `test/photobook-preview-route.test.ts`

**Interfaces:**
- Consumes: `photobookEntryFor`, `planFor`, `priceOf`, `renderPreview`, `DEFAULT_OPTIONS`, `balanceOf`, `getAllMedia`, `mayReadTrip`.
- Produces: `POST /<user>/photobook/preview` taking `{ trip: string; options: BookOptions }` and answering `{ html: string; pages: number; volumes: number; credits: number; warnings: { code: string; detail: string }[] }` — or `{ error }` with 403/404.

- [ ] **Step 1: Write the failing route test**

```ts
// test/photobook-preview-route.test.ts
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
import { POST } from "@/app/[user]/photobook/preview/route";
import { DEFAULT_OPTIONS } from "@/lib/photobook/options";

const params = Promise.resolve({ user: "alex" });

describe("the preview route", () => {
  test("an agent's bearer token is refused outright, not silently ignored", async () => {
    const request = new Request("https://example.test/alex/photobook/preview", {
      method: "POST",
      headers: { authorization: "Bearer whatever", "content-type": "application/json" },
      body: JSON.stringify({ trip: "alex/asia-2026", options: DEFAULT_OPTIONS }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "not_for_agents" });
  });

  test("a body that is not options is refused rather than defaulted", async () => {
    const request = new Request("https://example.test/alex/photobook/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: "../../etc", options: DEFAULT_OPTIONS }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-preview-route.test.ts`
Expected: FAIL — the route module does not exist.

- [ ] **Step 3: Write the options parser**

Append to `lib/photobook/options.ts` — a parser, because the body arrives from a browser and an unknown value must not become a default that quietly prints the wrong book:

```ts
/**
 * Read options off a request body.
 *
 * Every field is checked against what the catalogue actually offers. An
 * unrecognised size is not "probably square", it is a request nobody wrote,
 * and the caller gets `null` rather than a book they did not ask for.
 */
export function parseOptions(input: unknown, sizes: readonly string[]): BookOptions | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const bool = (key: keyof BookOptions) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : null;

  const size = typeof raw.size === "string" && sizes.includes(raw.size) ? raw.size : null;
  const binding = raw.binding === "perfect" || raw.binding === "saddle" ? raw.binding : null;
  const excludePhotos = Array.isArray(raw.excludePhotos)
    ? raw.excludePhotos.filter((s): s is string => typeof s === "string")
    : null;
  const flags = {
    includeText: bool("includeText"),
    includeMap: bool("includeMap"),
    includeChapters: bool("includeChapters"),
    includeNames: bool("includeNames"),
    includeCosts: bool("includeCosts"),
  };
  if (!size || !binding || !excludePhotos || Object.values(flags).some((v) => v === null)) {
    return null;
  }
  return { size, binding, excludePhotos, ...(flags as Record<string, boolean>) } as BookOptions;
}
```

- [ ] **Step 4: Write the preview route**

```ts
// app/[user]/photobook/preview/route.ts
import { isOwner } from "@/lib/contacts/session";
import { isEnabled } from "@/lib/capabilities";
import { parseOptions } from "@/lib/photobook/options";
import { planFor, priceOf } from "@/lib/photobook/build";
import { renderPreview } from "@/lib/photobook/preview";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { parseTripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The preview, planned server-side because the planner lives here.
 *
 * Outside `/api/v1/` and satisfied only by the owner's cookie, for the same
 * three reasons `app/[user]/postcards/[id]/send/route.ts` states: the agent
 * namespace is documented elsewhere, `isOwner` is called *without* the request
 * so a bearer token cannot satisfy it, and a request carrying one is refused
 * with a sentence rather than a bare 403 it might retry around. This route
 * charges nothing, but it plans the same book the paying one does, and the two
 * must not disagree about who is allowed to ask.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/photobook/preview">,
) {
  const { user } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "A photobook is configured and paid for by the person whose journal it is. " +
          "Nothing here answers to a token — run `npm run photobook` instead.",
      },
      { status: 403 },
    );
  }
  if (!isEnabled("photobook", user) || !(await isOwner(user))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { trip?: unknown; options?: unknown }
    | null;
  const trip = typeof body?.trip === "string" ? body.trip : "";
  const parsed = parseTripRef(trip);
  const options = parseOptions(body?.options, Object.keys(BOOK_SIZES));
  if (!parsed || parsed.username !== user || !options) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const book = planFor(trip, options);
  const html = renderPreview(
    book,
    "",
    (file) => file,
    // The site already serves every photograph. `BookPhoto.file` is
    // content-root-relative — `<user>/trips/<trip>/media/…` — and the media
    // route is mounted at the same shape, so this is a prefix and not a
    // lookup.
    (photo) => `/${photo.file.split("/").slice(0).join("/")}`,
  );

  return Response.json({
    html,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    credits: priceOf(book, options),
    warnings: book.warnings,
  });
}
```

**Before finishing this step, check the media URL.** Read `app/[user]/media/` to see the path shape it serves and make the `srcFor` above produce exactly that. If it does not line up, the correct fix is in this callback and nowhere else — do not change `BookPhoto.file`, which `test/photobook-source.test.ts` pins for B25.

- [ ] **Step 5: Write the page**

`app/[user]/(trip)/photobook/page.tsx` — server component, following the gallery page it sits beside:

```tsx
import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { mayReadTrip } from "@/lib/tripGate";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import { notFound } from "next/navigation";
import TripProvider from "@/components/TripProvider";
import { getAllMedia } from "@/lib/entries";
import { balanceOf } from "@/lib/credits";
import { photobookEntryFor } from "@/lib/photobook/entry";
import PhotobookPageContent from "./PhotobookPageContent";

export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  return { title: translateIn(reader, "photobook.title"), robots: { index: false } };
}

export default async function PhotobookPage({ params }: PageProps<"/[user]/photobook">) {
  const { user } = await params;
  const trip = currentTripOrRedirect(user);
  if (!(await mayReadTrip(trip))) return null;

  const entry = await photobookEntryFor(trip);
  if (!entry) notFound();

  return (
    <TripProvider trip={trip} isCurrent canPublish={false}>
      <PhotobookPageContent
        entry={entry}
        tripRef={trip.ref}
        tripTitle={trip.title}
        // Every photograph is in the book until the owner says otherwise, so
        // the grid starts fully selected. Drafts are the owner's own and are
        // included: this page is only ever the owner's.
        media={getAllMedia(trip.ref, { includeDrafts: true }).filter((m) => m.type === "image")}
        balance={await balanceOf(user)}
      />
    </TripProvider>
  );
}
```

`app/[user]/trips/[trip]/photobook/page.tsx` is the same, resolving the trip with `getTrip(tripRef(user, id))` and `notFound()` when it is missing — copy the shape from `app/[user]/trips/[trip]/gallery/page.tsx`, minus `generateStaticParams` (this page is owner-only and must never be prerendered).

- [ ] **Step 6: Write the client component**

`app/[user]/(trip)/photobook/PhotobookPageContent.tsx`, `"use client"`. It holds `BookOptions` in state, posts to the preview route on change (debounced 400 ms), and renders:

- the option controls, one per field, labelled from the `photobook.option.*` keys;
- the photo grid, every tile a toggle writing into `excludePhotos`;
- the preview in `<iframe srcDoc={html} className="h-[70vh] w-full rounded-xl border border-navy-200" title={t("photobook.title")} />`;
- page count, price, balance, the planner's warnings as a list;
- a `<form method="post" action={`/${entry.username}/photobook/order`}>` carrying the options as one JSON hidden input, the trip ref, and a hidden `orderId` generated once with `crypto.randomUUID()` in a `useState` initialiser — **generated once and not per render**, because it is the double-press guard;
- the Pay button, disabled when `balance !== null && balance < credits`, with `t("photobook.tooPoor")` beneath it in that case.

A form post rather than fetch, for the reason the postcard send route gives: it works on a phone with a bad connection, and there is no spinner state to get wrong. Add `disabled` on submit to stop the obvious double press; the primary key stops the rest.

- [ ] **Step 7: Run the tests and the build**

Run: `npx vitest run test/photobook-preview-route.test.ts && npm run build`
Expected: PASS, and the build compiles both new pages.

- [ ] **Step 8: Commit**

```bash
git add "app/[user]/(trip)/photobook" "app/[user]/trips/[trip]/photobook" "app/[user]/photobook/preview" lib/photobook/options.ts test/photobook-preview-route.test.ts
git commit -m "feat: the photobook options page, with the printed page as its preview"
```

---

### Task 11: Paying, building, mailing — and the download

**Files:**
- Create: `app/[user]/photobook/order/route.ts`, `app/[user]/photobooks/[id]/[file]/route.ts`
- Test: `test/photobook-order-route.test.ts`
- Modify: `docs/providers/photobook.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `POST /<user>/photobook/order` (form post → redirect back to the photobook page with a status), and `GET /<user>/photobooks/<id>/<file>` serving a PDF to the owner.

- [ ] **Step 1: Write the failing test**

```ts
// test/photobook-order-route.test.ts
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn().mockResolvedValue(true) }));
import { POST } from "@/app/[user]/photobook/order/route";
import { GET } from "@/app/[user]/photobooks/[id]/[file]/route";

const params = Promise.resolve({ user: "alex" });

describe("the order route", () => {
  test("a bearer token is refused — an agent never spends credits", async () => {
    const request = new Request("https://example.test/alex/photobook/order", {
      method: "POST",
      headers: { authorization: "Bearer whatever" },
      body: new URLSearchParams({ trip: "alex/asia-2026", orderId: "abc12345", options: "{}" }),
    });
    const response = await POST(request, { params });
    expect(response.status).toBe(403);
  });
});

describe("the download route", () => {
  test("a filename cannot climb out of the order's directory", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "../../../etc/passwd" }),
    });
    expect(response.status).toBe(404);
  });

  test("only the two shapes of file this feature writes are served", async () => {
    const response = await GET(new Request("https://example.test/x"), {
      params: Promise.resolve({ user: "alex", id: "abc12345", file: "notes.txt" }),
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/photobook-order-route.test.ts`
Expected: FAIL — neither route module exists.

- [ ] **Step 3: Write the order route**

```ts
// app/[user]/photobook/order/route.ts
import { redirect } from "next/navigation";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, refund, spend } from "@/lib/credits";
import { parseOptions } from "@/lib/photobook/options";
import { buildPhotobook, planFor, priceOf } from "@/lib/photobook/build";
import { ORDER_ID_RE, claimOrder, markFailed, markPrinted } from "@/lib/photobook/orders";
import { sendPhotobookReceipt } from "@/lib/photobook/receipt";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { getTrip, parseTripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The button, and the only place in this codebase that spends credits on a
 * book.
 *
 * Claim, spend, build — in that order, and the order is the whole design.
 * Claiming first is what makes a double press cost one book: the order id
 * comes from the page as the row's primary key, so two presses race to insert
 * it and one loses. Spending before building is `lib/credits.ts`'s
 * all-or-nothing rule. Refunding after a failed build is the other half of it:
 * a book nobody got bought nothing.
 *
 * Not under `/api/v1/`, `isOwner` called without the request, bearer refused
 * outright — see `app/[user]/postcards/[id]/send/route.ts` for why each of the
 * three matters.
 */
export async function POST(request: Request, { params }: RouteContext<"/[user]/photobook/order">) {
  const { user } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Ordering a photobook spends the owner's credits and is done by the owner, from " +
          "their own page. Nothing has been built or charged.",
      },
      { status: 403 },
    );
  }
  if (!isEnabled("photobook", user) || !isEnabled("credits", user) || !(await isOwner(user))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const form = await request.formData();
  const trip = String(form.get("trip") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  const options = parseOptions(
    JSON.parse(String(form.get("options") ?? "null")),
    Object.keys(BOOK_SIZES),
  );
  const parsed = parseTripRef(trip);
  if (!parsed || parsed.username !== user || !options || !ORDER_ID_RE.test(orderId)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const book = planFor(trip, options);
  const credits = priceOf(book, options);
  const payload = {
    trip,
    options,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    credits,
  };

  const back = `/${user}/trips/${parsed.tripId}/photobook`;

  // 1. Claim. A second press finds the key taken and is told so.
  if (!(await claimOrder(user, orderId, payload))) redirect(`${back}?state=duplicate`);

  // 2. Spend, all of it, before a single page is drawn.
  if (!(await spend(user, credits, "photobook", orderId))) {
    await markFailed(user, orderId, payload, "no_credits");
    redirect(`${back}?state=no_credits`);
  }

  // 3. Build. Anything that goes wrong here gives the credits back.
  try {
    const built = buildPhotobook(user, orderId, trip, options);
    await markPrinted(user, orderId, { ...payload, files: built.files });
    await sendPhotobookReceipt({
      owner: user,
      orderId,
      tripTitle: getTrip(trip)?.title ?? parsed.tripId,
      pages: built.pages,
      volumes: built.volumes,
      creditsSpent: credits,
      balance: await balanceOf(user),
      files: built.files,
    });
    redirect(`${back}?state=done&order=${orderId}`);
  } catch (error) {
    console.error(`[photobook] building ${orderId} failed:`, error);
    await refund(user, credits, orderId);
    await markFailed(user, orderId, payload, String(error));
    redirect(`${back}?state=failed`);
  }
}
```

**`redirect()` throws by design in Next**, so it must not sit inside the `try` that catches build failures. Move the success redirect to after the `try/catch` with a flag, or rethrow `isRedirectError(error)` — check how another route in this repo handles it and follow that, rather than inventing a third convention.

- [ ] **Step 4: Write the download route**

```ts
// app/[user]/photobooks/[id]/[file]/route.ts
import fs from "node:fs";
import path from "node:path";
import { isOwner } from "@/lib/contacts/session";
import { orderDir } from "@/lib/photobook/build";
import { ORDER_ID_RE } from "@/lib/photobook/orders";

export const dynamic = "force-dynamic";

/** Only what this feature writes. An allowlist rather than a sanitiser: there
 * are two shapes of file in that directory and no reason to serve a third. */
const FILE_RE = /^(book|v\d{1,2})-(interior|cover)\.pdf$/;

/**
 * The book, to the person who paid for it.
 *
 * Owner cookie only, like everything else in this flow. Worth knowing for the
 * provider work that comes next: **Gelato fetches the PDF from a URL and
 * accepts no upload**, so a reachable, unguessable version of this route is
 * what an order will need. That is a separate change and a separate decision —
 * this one hands the file to a logged-in owner and nobody else.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[user]/photobooks/[id]/[file]">,
) {
  const { user, id, file } = await params;
  if (!ORDER_ID_RE.test(id) || !FILE_RE.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await isOwner(user))) return new Response("Not found", { status: 404 });

  const full = path.join(orderDir(user, id), file);
  if (!fs.existsSync(full)) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(fs.readFileSync(full)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "private, no-store",
    },
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/photobook-order-route.test.ts test/photobook-orders.test.ts`
Expected: PASS — including the "nothing under app/api imports the order builder" assertion from Task 6, which these two routes must not violate (they are under `app/[user]/`, not `app/api/`).

- [ ] **Step 6: Update the provider document**

In `docs/providers/photobook.md`, under "What works today, with no account", add a short section saying a book can now be ordered from the browser, that the order spends credits and calls no provider, that Gelato is the chosen provider, and that `app/[user]/photobooks/[id]/[file]/route.ts` is the beginning of the reachable-URL requirement the comparison section describes. Do not restate the option list — link to the spec.

- [ ] **Step 7: Full verify**

Run: `npm run verify`
Expected: build, tsc, eslint and the whole suite pass.

Then the two things nothing automates:

```bash
# capability on
npm run dev            # gallery shows the button, the page previews, an order mails
# capability off — set features.photobook.enabled false in content/config.json
npm run dev            # the button is absent and /api/health explains why
```

Confirm the `.eml` under `content/<user>/mail/` carries two working links, and that both PDFs open.

- [ ] **Step 8: Commit and merge**

```bash
git add "app/[user]/photobook/order" "app/[user]/photobooks" docs/providers/photobook.md test/photobook-order-route.test.ts
git commit -m "feat: pay for a photobook with credits, build it, and mail the links"
```

Then, from the **shared checkout** (one git command per call):

```bash
git rev-parse --abbrev-ref HEAD     # must print: main
git merge --no-ff photobook-order
git worktree remove .claude/worktrees/photobook-order
git branch -d photobook-order
```

Move the task to `testing/` and say what to look at. **An agent stops at `testing/`.**

---

## Self-Review

**Spec coverage.** Gate → Task 9. Button → Task 9. Options page → Task 10. `BookOptions` → Tasks 2, 3. Price → Task 4. Orders → Task 6. Build and mail → Tasks 7, 8. Download → Task 11. Capability → Task 6. Error table → Tasks 6 (duplicate), 11 (no credits, render failure), 8 (mail failure is caught and logged), 10 (illegal plan surfaces as a warning before Pay). Testing section → Tasks 2, 4, 5, 6, 8, 11.

**One deliberate deviation from the spec**, recorded here rather than left to be discovered: the spec's table puts `includeCosts` in `buildBookSource`, and the plan implements it in `planBook` (Task 2) beside the other three page-level toggles. Reason: the costs page is a *draft*, like the map and the chapter dividers, and putting it where the other three are keeps one options object with one place to read it. `buildBookSource` keeps only the two options that are genuinely about the source — which photographs exist, and whether the travellers are named. Update the spec's table line when Task 2 lands.

**Known gaps, deliberately left:** the client component in Task 10 step 6 is described rather than written out in full, because it is ordinary form state and the repo's existing components are the better model than a copy in a plan. Everything it must do is enumerated. Task 11 step 3 flags the `redirect()`-inside-`try` hazard rather than guessing this repo's convention for it.
