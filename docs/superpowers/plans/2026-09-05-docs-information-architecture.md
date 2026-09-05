# Docs Information Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the landing page, `/docs` and the guides into one documentation site with a shared shell, one navigation, one language switcher and one way in.

**Architecture:** A new `app/docs/layout.tsx` wraps every docs page with a back link to the site, a single language switcher and a single nav. `/docs` becomes a hub of two labelled groups and nothing else; the prose that lived on it moves to `/docs/hosting` and `/docs/contributing`, joining the three guides and the API reference as six sibling pages that all work the same way.

**Tech Stack:** Next.js 16 App Router (server components), Tailwind v4 tokens from `app/globals.css`, `lib/docs.ts` for reading repo markdown at request time, `lib/locales.ts` (`requestLocale`, `translateIn`, `dictionaryFor`, `installedLocales`) for language.

**Spec:** `docs/superpowers/specs/2026-09-05-docs-information-architecture-design.md`

## Global Constraints

- **Ticket id is B470.** Every commit message starts `B470: `.
- **Work happens in this worktree only** (`.claude/worktrees/b470-docs-ia`), never the shared checkout — AGENTS.md.
- **Translated strings go in all three locale files** — `content/locales/{en,de,hu}.json` — then `npm run i18n:keys` regenerates the `TranslationKey` union in `lib/i18n.ts`. A `t()` call with a key missing from `en.json` fails the typecheck.
- **The technical pages stay English.** They are read from `README.md` and `CONTRIBUTING.md` via `readRepoFile`/`section` at request time (B23: one source, never two). Do not translate them; label them instead.
- **Never redraw brand assets, never use raw hex.** Use the palette tokens. `yellow-600` and `green-500` are fill-only — not text colours. Focus rings stay `blue-500`. — `apply-the-brand`.
- **`section(markdown, heading)` throws** when a heading is missing. That is deliberate: `test/docs.test.ts` is the tripwire for a README heading being renamed. Do not catch it.
- **Verify with `npm run verify`** (build → tsc → eslint → vitest, in that order). While iterating use `npx vitest run test/<file>`.
- The four existing README headings this plan reads are exactly: `What it looks like`, `What a day looks like`, `Getting started`, `Before you open a PR`. The last two are in `CONTRIBUTING.md`.

---

### Task 1: The docs shell

**Files:**
- Create: `app/docs/layout.tsx`
- Create: `components/DocsNav.tsx`
- Modify: `content/locales/en.json`, `content/locales/de.json`, `content/locales/hu.json`
- Modify: `lib/i18n.ts` (generated — run `npm run i18n:keys`, do not hand-edit)
- Test: `test/docs-shell.test.tsx`

**Interfaces:**
- Consumes: `requestLocale()`, `translateIn(locale, key, vars?)`, `dictionaryFor(locale)`, `installedLocales()` from `@/lib/locales`; `serverSite()` from `@/lib/site`.
- Produces:
  - `DOCS_PAGES: readonly DocsPage[]` exported from `lib/docs.ts` in Task 2 — **not yet**; Task 1's nav takes its entries as a prop so this task does not depend on Task 2.
  - `components/DocsNav.tsx` default export: `DocsNav({ locale, current }: { locale: string; current?: string })`.
  - `app/docs/layout.tsx` default export: `DocsLayout({ children }: LayoutProps<"/docs">)`.

- [ ] **Step 1: Add the shell's strings to all three locale files**

Add to `content/locales/en.json`:

```json
"docs.backToSite": "Back to {name}",
"docs.title": "Documentation",
"docs.navLabel": "Documentation pages"
```

`content/locales/de.json`:

```json
"docs.backToSite": "Zurück zu {name}",
"docs.title": "Dokumentation",
"docs.navLabel": "Dokumentationsseiten"
```

`content/locales/hu.json`:

```json
"docs.backToSite": "Vissza ide: {name}",
"docs.title": "Dokumentáció",
"docs.navLabel": "Dokumentációs oldalak"
```

Then run `npm run i18n:keys`.

- [ ] **Step 2: Write the failing test**

Create `test/docs-shell.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B470 — every docs page is wrapped by one shell.
 *
 * The complaint that produced this ticket was that /docs had no way back to
 * the site and two different menus. Both were structural: there was no docs
 * layout at all, so each page built its own header and the guides brought
 * their own switcher. These assertions are on the source rather than on a
 * render, because what matters is that exactly one component owns each of
 * those jobs.
 */
function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("the docs shell", () => {
  test("a layout exists and links back to the site", () => {
    const layout = read("app/docs/layout.tsx");
    expect(layout).toContain('href="/"');
    expect(layout).toContain("docs.backToSite");
  });

  test("the shell owns the only language switcher", () => {
    expect(read("app/docs/layout.tsx")).toContain("LocaleSwitcher");
    // It used to live in the guides' own menu, which is why it read as part
    // of the guides rather than part of the site.
    expect(read("components/GuideNav.tsx")).not.toContain("LocaleSwitcher");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/docs-shell.test.tsx`
Expected: FAIL — `ENOENT ... app/docs/layout.tsx`.

- [ ] **Step 4: Write `components/DocsNav.tsx`**

```tsx
import Link from "next/link";
import { translateIn } from "@/lib/locales";

/**
 * The one navigation every docs page carries — B470.
 *
 * Entries arrive as a prop rather than being read here, so this component has
 * no opinion about which pages exist; `app/docs/layout.tsx` passes the list.
 * That is what lets the hub render the same six destinations as cards without
 * this row appearing above them, which is the whole of the "two menus" fix.
 */
export type DocsNavEntry = {
  /** The path, which is also the identity — `current` is compared to it. */
  href: string;
  /** A `TranslationKey`, resolved here so the caller passes no rendered text. */
  labelKey: string;
  /** Drawn as a separator before this entry, for the group boundary. */
  startsGroup?: boolean;
};

export default function DocsNav({
  locale,
  entries,
  current,
}: {
  locale: string;
  entries: readonly DocsNavEntry[];
  current?: string;
}) {
  return (
    <nav
      aria-label={translateIn(locale, "docs.navLabel")}
      className="flex flex-wrap items-center gap-x-1 gap-y-2"
    >
      {entries.map((entry) => {
        const active = entry.href === current;
        return (
          <span key={entry.href} className="flex items-center gap-1">
            {entry.startsGroup && (
              <span aria-hidden className="mx-1 h-4 w-px bg-navy-200" />
            )}
            <Link
              href={entry.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold
                          transition-colors focus-visible:outline-2 focus-visible:outline-offset-2
                          focus-visible:outline-blue-500 ${
                            active
                              ? "bg-yellow-400 text-yellow-950"
                              : "text-navy-700 hover:bg-cream-100 hover:text-navy-900"
                          }`}
            >
              {translateIn(locale, entry.labelKey as never)}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Write `app/docs/layout.tsx`**

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import LocaleProvider from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { dictionaryFor, installedLocales, requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * One frame for every documentation page — B470.
 *
 * Before this there was no docs layout at all: `/docs`, `/docs/api` and the
 * guides each built their own header, `/docs` had no link back to the site,
 * and the language switcher lived inside the guides' menu — so it read as
 * part of the guides rather than part of the site.
 *
 * Three jobs, and each belongs to exactly one place now: the way home, the
 * language, and the page title. The *navigation* is deliberately not here —
 * it is rendered by the pages, because the hub's cards are its navigation and
 * a row of the same six links above them would be the second menu again.
 */
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const locale = await requestLocale();
  const site = serverSite();

  return (
    <div className="min-h-full">
      <header className="border-b border-navy-200 bg-cream-100/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-700
                       transition-colors hover:text-navy-900
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {translateIn(locale, "docs.backToSite", { name: site.name })}
          </Link>
          <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
            <LocaleSwitcher locales={installedLocales()} subtle />
          </LocaleProvider>
        </div>
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Remove the switcher from `components/GuideNav.tsx`**

Delete the `LocaleProvider`/`LocaleSwitcher` block added in B456 and its comment, and the now-unused imports of `LocaleProvider`, `LocaleSwitcher`, `dictionaryFor` and `installedLocales`. The shell owns it now.

- [ ] **Step 7: Run the test**

Run: `npx vitest run test/docs-shell.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add app/docs/layout.tsx components/DocsNav.tsx components/GuideNav.tsx content/locales lib/i18n.ts test/docs-shell.test.tsx
git commit -m "B470: one shell for every documentation page"
```

---

### Task 2: The page list, in one place

**Files:**
- Modify: `lib/docs.ts`
- Test: `test/docs-pages.test.ts`

**Interfaces:**
- Consumes: `GUIDES`, `Guide`, `isGuide` already exported from `lib/docs.ts`.
- Produces, from `lib/docs.ts`:
  - `type DocsPageId = "guest" | "creator" | "buddy" | "hosting" | "contributing" | "api"`
  - `DOCS_PAGES: readonly { id: DocsPageId; href: string; labelKey: string; group: "guides" | "technical" }[]`
  - `docsNavEntries(): { href: string; labelKey: string; startsGroup: boolean }[]` — the same list shaped for `DocsNav`, with `startsGroup` on the first technical entry. Structurally compatible with `DocsNavEntry`; `lib/` does not import from `components/`.

- [ ] **Step 1: Write the failing test**

Create `test/docs-pages.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { DOCS_PAGES, docsNavEntries } from "@/lib/docs";
import { dictionaryFor } from "@/lib/locales";

/**
 * B470 — the six pages, listed once.
 *
 * The hub's cards, the shell's nav and the pages themselves all have to agree
 * about what exists. Before this they did not: the guides were a list in one
 * component and the technical sections were anchors written by hand in
 * another, which is why they were drawn as the same kind of pill while
 * behaving differently.
 */
describe("the documentation pages", () => {
  test("there are six, in two groups", () => {
    expect(DOCS_PAGES).toHaveLength(6);
    expect(DOCS_PAGES.filter((p) => p.group === "guides")).toHaveLength(3);
    expect(DOCS_PAGES.filter((p) => p.group === "technical")).toHaveLength(3);
  });

  test("every page has a real route and a translated label", () => {
    for (const page of DOCS_PAGES) {
      expect(page.href).toMatch(/^\/docs\//);
      for (const locale of ["en", "de", "hu"]) {
        expect(dictionaryFor(locale)[page.labelKey], `${locale} ${page.labelKey}`).toBeTruthy();
      }
    }
  });

  test("the nav marks where the second group begins, exactly once", () => {
    const entries = docsNavEntries();
    expect(entries).toHaveLength(6);
    expect(entries.filter((e) => e.startsGroup)).toHaveLength(1);
    // And it is the first technical page, not an arbitrary one.
    expect(entries.findIndex((e) => e.startsGroup)).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/docs-pages.test.ts`
Expected: FAIL — `DOCS_PAGES` is not exported from `@/lib/docs`.

- [ ] **Step 3: Add the list to `lib/docs.ts`**

Append:

```ts
/**
 * Every documentation page, once — B470.
 *
 * The hub renders these as cards, the shell's nav renders them as pills, and
 * both read this list. Before it existed the guides were an array in one
 * component and the technical sections were anchors hand-written in another,
 * which is exactly how they came to be drawn as the same kind of control while
 * behaving differently — one navigated, one scrolled.
 *
 * The group is the axis the old page flattened: **who you are** (a reader, an
 * owner, somebody on a trip) against **what you want to build** (host it,
 * change it, call it). Keeping them apart is what lets the hub say, in the
 * reader's own language, that only one of the two halves is translated.
 */
export type DocsPageId = Guide | "hosting" | "contributing" | "api";

export type DocsPage = {
  id: DocsPageId;
  href: string;
  /** A `TranslationKey`. Resolved by whoever renders it, never here. */
  labelKey: string;
  group: "guides" | "technical";
};

export const DOCS_PAGES: readonly DocsPage[] = [
  { id: "guest", href: "/docs/guide/guest", labelKey: "guides.guest.title", group: "guides" },
  { id: "creator", href: "/docs/guide/creator", labelKey: "guides.creator.title", group: "guides" },
  { id: "buddy", href: "/docs/guide/buddy", labelKey: "guides.buddy.title", group: "guides" },
  { id: "hosting", href: "/docs/hosting", labelKey: "docs.hosting.title", group: "technical" },
  {
    id: "contributing",
    href: "/docs/contributing",
    labelKey: "docs.contributing.title",
    group: "technical",
  },
  { id: "api", href: "/docs/api", labelKey: "docs.api.title", group: "technical" },
];

/** The same list, shaped for `DocsNav`, with the group boundary marked. */
export function docsNavEntries() {
  return DOCS_PAGES.map((page, i) => ({
    href: page.href,
    labelKey: page.labelKey,
    startsGroup: page.group === "technical" && DOCS_PAGES[i - 1]?.group !== "technical",
  }));
}
```

- [ ] **Step 4: Add the three new labels to all three locale files**

`en.json`:

```json
"docs.hosting.title": "Hosting",
"docs.contributing.title": "Contributing",
"docs.api.title": "API"
```

`de.json` and `hu.json`: the same three values. These are the *page names* of
English-language pages; translating "Hosting" to "Betrieb" would name a page
whose content is English, which is the confusion this ticket exists to remove.

Run `npm run i18n:keys`.

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/docs-pages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/docs.ts content/locales lib/i18n.ts test/docs-pages.test.ts
git commit -m "B470: the six documentation pages, listed once"
```

---

### Task 3: `/docs/hosting` and `/docs/contributing`

**Files:**
- Create: `app/docs/hosting/page.tsx`
- Create: `app/docs/contributing/page.tsx`
- Test: `test/docs-technical-pages.test.ts`

**Interfaces:**
- Consumes: `readRepoFile`, `section` from `@/lib/docs`; `docsNavEntries` from Task 2; `DocsNav` from Task 1; `requestLocale`, `translateIn` from `@/lib/locales`; `serverSite()` from `@/lib/site`.
- Produces: the two routes the nav in Task 2 already points at.

- [ ] **Step 1: Write the failing test**

Create `test/docs-technical-pages.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readRepoFile, section } from "@/lib/docs";

/**
 * B470 — the prose that used to be anchors on the index.
 *
 * `section()` throws on a missing heading, deliberately, so the useful test is
 * that the headings these pages name still exist in the files they are read
 * from. A renamed heading in README.md then fails here rather than rendering
 * an empty page on the live site.
 */
describe("the technical pages", () => {
  test("the README headings they read still exist", () => {
    const readme = readRepoFile("README.md");
    expect(section(readme, "What it looks like").length).toBeGreaterThan(50);
    expect(section(readme, "What a day looks like").length).toBeGreaterThan(50);
  });

  test("the CONTRIBUTING headings they read still exist", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    expect(section(contributing, "Getting started").length).toBeGreaterThan(50);
    expect(section(contributing, "Before you open a PR").length).toBeGreaterThan(50);
  });

  test("both pages render the shared nav rather than their own", () => {
    for (const file of ["app/docs/hosting/page.tsx", "app/docs/contributing/page.tsx"]) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src, file).toContain("DocsNav");
      expect(src, file).toContain("docsNavEntries");
      // No page builds its own way home or its own switcher; the shell owns both.
      expect(src, file).not.toContain("LocaleSwitcher");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/docs-technical-pages.test.ts`
Expected: FAIL — `ENOENT ... app/docs/hosting/page.tsx`.

- [ ] **Step 3: Write `app/docs/hosting/page.tsx`**

```tsx
import type { Metadata } from "next";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Hosting" };

/**
 * Running your own copy — B470.
 *
 * Was `#host` on the docs index, which made it an anchor sitting in a row of
 * links to pages. It reads from `README.md` at request time rather than
 * repeating it (B23), so the one place this content is maintained stays the
 * repository's front door.
 */
export default async function HostingPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const readme = readRepoFile("README.md");

  // Repo-relative image paths are for GitHub's renderer; rewrite them to the
  // route that actually serves the files here. The closing capture note is for
  // a contributor, not a visitor, so it is dropped rather than left dangling.
  const looks = section(readme, "What it looks like")
    .replace(/\(docs\/screenshots\//g, "(/docs/screenshots/")
    .split("\n\n*Captured at")[0];
  const dayEntry = section(readme, "What a day looks like");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">Hosting</h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        A VPS, Node and Caddy, one deploy script. A public journal needs no
        database, and every optional capability — mail, sign-in, guests, push,
        print — is off by default.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/hosting" />
      </div>

      <div className="mt-8 border-t border-navy-200 pt-8">
        <pre className="overflow-x-auto rounded-xl bg-navy-900 p-4 text-sm text-cream-50">
          <code>{"npm install\nnpm run dev            # http://localhost:3000"}</code>
        </pre>
        {site.repository && (
          <p className="mt-3 text-sm text-navy-600">
            Deploying to a VPS is a longer walk — see{" "}
            <a
              href={`${site.repository}/blob/main/docs/runbook.md`}
              className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              docs/runbook.md
            </a>{" "}
            in the repository.
          </p>
        )}

        <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
          What a day looks like
        </h2>
        <p className="mt-2 text-navy-700">
          One markdown file per update, with whatever fields are actually known.
        </p>
        <div className="mt-2">
          <EntryContent markdown={dayEntry} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
          What you get
        </h2>
        <div className="mt-2">
          <EntryContent markdown={looks} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Write `app/docs/contributing/page.tsx`**

```tsx
import type { Metadata } from "next";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Contributing" };

/**
 * Changing the software itself — B470. Was `#contribute` on the index.
 *
 * Read from `CONTRIBUTING.md` at request time, so the file a pull request
 * author is told to follow and the page describing it cannot drift (B23).
 */
export default async function ContributingPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const contributing = readRepoFile("CONTRIBUTING.md");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        Contributing
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        How to run the code, and what a change has to clear before it is
        merged.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/contributing" />
      </div>

      <div className="mt-8 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">Getting started</h2>
        <div className="mt-2">
          <EntryContent markdown={section(contributing, "Getting started")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
          Before you open a PR
        </h2>
        <div className="mt-2">
          <EntryContent markdown={section(contributing, "Before you open a PR")} />
        </div>

        {site.repository && (
          <p className="mt-8 text-sm text-navy-600">
            The whole file, and the licence terms, are{" "}
            <a
              href={`${site.repository}/blob/main/CONTRIBUTING.md`}
              className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              in the repository
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/docs-technical-pages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/docs/hosting app/docs/contributing test/docs-technical-pages.test.ts
git commit -m "B470: hosting and contributing become pages, not anchors"
```

---

### Task 4: `/docs` becomes a hub

**Files:**
- Modify: `app/docs/page.tsx` (replace wholesale)
- Modify: `content/locales/{en,de,hu}.json`
- Test: `test/docs-hub.test.tsx`

**Interfaces:**
- Consumes: `DOCS_PAGES` from Task 2; `requestLocale`, `translateIn`, `dictionaryFor` from `@/lib/locales`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Add the hub's strings**

`en.json`:

```json
"docs.lede": "How to use this journal, how to run your own, and how to change the software itself.",
"docs.guidesGroup": "Guides",
"docs.guidesGroupNote": "Written for people rather than for agents.",
"docs.technicalGroup": "Technical documentation",
"docs.technicalGroupNote": "Running your own copy, changing the software, and the API — in English."
```

`de.json`:

```json
"docs.lede": "Wie du dieses Reisetagebuch benutzt, wie du dein eigenes betreibst und wie du die Software selbst änderst.",
"docs.guidesGroup": "Anleitungen",
"docs.guidesGroupNote": "Für Menschen geschrieben, nicht für Agenten.",
"docs.technicalGroup": "Technische Dokumentation",
"docs.technicalGroupNote": "Selbst betreiben, mitentwickeln und die API — auf Englisch."
```

`hu.json`:

```json
"docs.lede": "Hogyan használd ezt az útinaplót, hogyan üzemeltesd a sajátodat, és hogyan változtasd meg magát a szoftvert.",
"docs.guidesGroup": "Útmutatók",
"docs.guidesGroupNote": "Embereknek írva, nem ügynököknek.",
"docs.technicalGroup": "Technikai dokumentáció",
"docs.technicalGroupNote": "Saját üzemeltetés, fejlesztés és az API — angolul."
```

Run `npm run i18n:keys`.

- [ ] **Step 2: Write the failing test**

Create `test/docs-hub.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B470 — the hub is a hub.
 *
 * "There are two menus for Anleitungen" was the complaint, and the cause was
 * that `/docs` was an index *and* a document: a row of anchors to its own
 * sections, beside a row of links to pages. A hub answers one question —
 * where are you going — so the test is that it has no sections of its own to
 * scroll to.
 */
describe("the documentation hub", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app/docs/page.tsx"), "utf8");

  test("it has no in-page anchors, so there is only one kind of link on it", () => {
    expect(src).not.toContain('href="#');
    expect(src).not.toContain("scroll-mt");
  });

  test("it renders the six pages from the shared list", () => {
    expect(src).toContain("DOCS_PAGES");
  });

  test("it does not render the nav as well as the cards", () => {
    // The cards *are* the navigation here. A DocsNav above them would be the
    // second menu again, in a new place.
    expect(src).not.toContain("DocsNav");
  });

  test("it names both groups and says which one is English", () => {
    expect(src).toContain("docs.guidesGroup");
    expect(src).toContain("docs.technicalGroup");
    expect(src).toContain("docs.technicalGroupNote");
  });

  test("the German hub carries no English section headings", async () => {
    const { dictionaryFor } = await import("@/lib/locales");
    const de = dictionaryFor("de");
    for (const key of ["docs.title", "docs.guidesGroup", "docs.technicalGroup"]) {
      expect(de[key], key).toBeTruthy();
      expect(de[key]).not.toMatch(/^How to /);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/docs-hub.test.tsx`
Expected: FAIL — the current page contains `href="#use"` and `scroll-mt-6`.

- [ ] **Step 4: Replace `app/docs/page.tsx` entirely**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, PenLine, Users, Server, GitPullRequest, Code2 } from "lucide-react";
import { DOCS_PAGES, type DocsPageId } from "@/lib/docs";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs",
  description: "How to use, host and contribute to this journal.",
};

/**
 * The documentation hub — B470.
 *
 * It was an index and a document at once: a row of anchors to its own three
 * sections, beside a row of links to the guide pages, with the guides
 * translated and its own headings hardcoded English. A reader met two menus
 * that looked identical and behaved differently, and a page that was half in
 * their language.
 *
 * Now it answers exactly one question — where are you going — and the cards
 * are its navigation, which is why the shell's `DocsNav` is deliberately not
 * rendered here. The prose that used to live on this page is at
 * `/docs/hosting` and `/docs/contributing`.
 *
 * Both group labels are translated, including the one that says its pages are
 * in English. That sentence is the fix for "it is a mix of German and
 * English": the mix is real and is staying, because those pages are read from
 * `README.md` and `CONTRIBUTING.md` at request time (B23), and what was wrong
 * was leaving a reader to conclude the translation had failed.
 */
const ICONS: Record<DocsPageId, typeof BookOpen> = {
  guest: BookOpen,
  creator: PenLine,
  buddy: Users,
  hosting: Server,
  contributing: GitPullRequest,
  api: Code2,
};

function Group({
  locale,
  heading,
  note,
  group,
}: {
  locale: string;
  heading: string;
  note: string;
  group: "guides" | "technical";
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-navy-900">{heading}</h2>
      <p className="mt-1 text-navy-600">{note}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {DOCS_PAGES.filter((page) => page.group === group).map((page) => {
          const Icon = ICONS[page.id];
          return (
            <li key={page.id}>
              <Link
                href={page.href}
                className="flex h-full min-h-11 items-center gap-2.5 rounded-xl border border-navy-200
                           bg-white px-4 py-3 text-base font-semibold text-navy-900 transition-colors
                           hover:border-navy-700
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                <Icon className="h-4 w-4 shrink-0 text-navy-600" aria-hidden strokeWidth={2.2} />
                {translateIn(locale, page.labelKey as never)}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function DocsPage() {
  const locale = await requestLocale();
  const site = serverSite();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        {translateIn(locale, "docs.title")}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        {translateIn(locale, "docs.lede")}
      </p>

      <Group
        locale={locale}
        heading={translateIn(locale, "docs.guidesGroup")}
        note={translateIn(locale, "docs.guidesGroupNote")}
        group="guides"
      />
      <Group
        locale={locale}
        heading={translateIn(locale, "docs.technicalGroup")}
        note={translateIn(locale, "docs.technicalGroupNote")}
        group="technical"
      />

      {/* The two agent-facing documents. Named at the foot rather than in a
          card beside "Für Lesende": they are not pages a person reads, and
          putting them in that row is how the old page came to address two
          audiences with one control.

          Two bare URLs and no sentence around them, deliberately. A sentence
          would have to be translated or it reintroduces the mix this ticket
          removes — and it would be a translated sentence wrapping two English
          filenames, which reads worse than the filenames alone. */}
      <p className="mt-12 border-t border-navy-200 pt-6 font-mono text-xs text-navy-600">
        <a href="/agent.md" className="underline decoration-navy-200 hover:decoration-navy-500">
          /agent.md
        </a>{" "}
        ·{" "}
        <a href="/openapi.json" className="underline decoration-navy-200 hover:decoration-navy-500">
          /openapi.json
        </a>{" "}
        · {site.url}
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run test/docs-hub.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/docs/page.tsx content/locales lib/i18n.ts test/docs-hub.test.tsx
git commit -m "B470: /docs becomes a hub and nothing else"
```

---

### Task 5: The guides and the API join the shell

**Files:**
- Modify: `app/docs/guide/[guide]/page.tsx`
- Modify: `app/docs/api/page.tsx`
- Modify: `components/GuideNav.tsx` (delete — replaced by `DocsNav`)
- Test: `test/guides.test.ts` (extend)

**Interfaces:**
- Consumes: `DocsNav`, `docsNavEntries`.
- Produces: nothing new.

- [ ] **Step 1: Replace `GuideNav` with `DocsNav` in the guide page**

In `app/docs/guide/[guide]/page.tsx`: import `DocsNav` and `docsNavEntries`,
replace `<GuideNav locale={locale} current={guide} />` with
`<DocsNav locale={locale} entries={docsNavEntries()} current={`/docs/guide/${guide}`} />`,
and delete the "All docs" back link — the shell's header carries the way out
now, and two back links is the same duplication in miniature.

- [ ] **Step 2: Delete `components/GuideNav.tsx`**

```bash
git rm components/GuideNav.tsx
```

Run `npm run unused` afterwards; knip fails on a file nothing reaches, which
is the check that this deletion was complete.

- [ ] **Step 3: Add the nav to the API page**

In `app/docs/api/page.tsx`, make the component `async`, add
`const locale = await requestLocale();`, and render
`<DocsNav locale={locale} entries={docsNavEntries()} current="/docs/api" />`
under the heading. Remove its own `Link href="/docs"` back link for the same
reason as Step 1.

- [ ] **Step 4: Extend `test/guides.test.ts`**

Add:

```ts
describe("the guides sit in the shared shell", () => {
  test("they render the shared nav and no back link of their own", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "app/docs/guide/[guide]/page.tsx"),
      "utf8",
    );
    expect(src).toContain("DocsNav");
    expect(src).not.toContain("GuideNav");
    // The shell's header is the way out; a second one under it was the
    // "Alle Dokumente" link that led to a page with no way home at all.
    expect(src).not.toContain("guides.backToDocs");
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/guides.test.ts test/docs-shell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "B470: the guides and the API reference join the shell"
```

---

### Task 6: The landing page drops to one door

**Files:**
- Modify: `components/LandingSections.tsx` (the `Colophon` component, around line 344)
- Test: `test/landing.test.tsx` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `test/landing.test.tsx`:

```tsx
test("the landing page has one door to the docs, not three — B470", () => {
  const html = renderLanding();
  const hrefs = [...html.matchAll(/href="(\/docs[^"]*)"/g)].map((m) => m[1]);
  // The hub, and the guest guide inside the reader card — which stays because
  // it is aimed at one person at the moment they are confused, where a docs
  // link is aimed at nobody in particular.
  expect(new Set(hrefs)).toEqual(new Set(["/docs", "/docs/guide/guest"]));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/landing.test.tsx`
Expected: FAIL — `/docs/api` is also present.

- [ ] **Step 3: Remove the API link from the colophon**

In `components/LandingSections.tsx`, delete the `<Link href="/docs/api">`
block and its `BookOpen` icon from the "Selbst betreiben" column, leaving the
GitHub link. Add a comment in its place:

```tsx
{/* One door to the documentation, not three — B470. The API reference is a
    card on `/docs`, one click away; three separate links from here is how
    a visitor came to meet the docs at three different depths depending on
    which one they happened to press. */}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/landing.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/LandingSections.tsx test/landing.test.tsx
git commit -m "B470: one door from the landing page to the documentation"
```

---

### Task 7: Retire "How to Use", and move its one unique paragraph

**Files:**
- Modify: `docs/guides/en/creator.md`, `docs/guides/de/creator.md`, `docs/guides/hu/creator.md`
- Test: `test/guides.test.ts` (extend)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

Add to `test/guides.test.ts`, inside the existing `describe("what the guides have to cover")`:

```ts
/**
 * The one thing "How to Use" said that lives nowhere else. The rest of that
 * section — hand this to your agent — is on the landing page in the dashed
 * box and in this guide's own opening, which is why the section could go.
 */
test("every creator guide explains that photographs need a timestamp", () => {
  for (const locale of LOCALES) {
    expect(read(locale, "creator"), locale).toMatch(
      /timestamp|Zeitstempel|időbélyeg/i,
    );
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/guides.test.ts`
Expected: FAIL for at least one locale.

- [ ] **Step 3: Add the paragraph to `docs/guides/en/creator.md`**

Under "## Writing a day", after the existing first paragraph, insert:

```markdown
**Photographs help most when they carry a timestamp.** Any common format
works. JPEG and HEIC record the capture time — and often the location —
automatically on most phones and cameras, which is what lets an agent put a
day on the right date without being told. If you are exporting, scanning or
renaming files by hand, keep the date in the filename instead:
`2026-08-26-hoi-an-01.jpg`.
```

- [ ] **Step 4: Add the same paragraph to the German guide**

```markdown
**Am meisten helfen Fotos, die einen Zeitstempel tragen.** Jedes übliche
Format geht. JPEG und HEIC speichern die Aufnahmezeit — und oft den Ort —
bei den meisten Handys und Kameras automatisch, und genau das lässt einen
Agenten den Tag auf das richtige Datum legen, ohne dass du es sagst. Wenn du
Dateien von Hand exportierst, scannst oder umbenennst, schreib das Datum
stattdessen in den Dateinamen: `2026-08-26-hoi-an-01.jpg`.
```

- [ ] **Step 5: Add the same paragraph to the Hungarian guide**

```markdown
**A fényképek akkor segítenek a legtöbbet, ha van rajtuk időbélyeg.** Minden
elterjedt formátum megfelel. A JPEG és a HEIC a legtöbb telefonon és
fényképezőgépen automatikusan rögzíti a felvétel idejét — és gyakran a helyet
is —, és épp ez teszi lehetővé, hogy az ügynök a helyes dátumra tegye a napot,
anélkül hogy megmondanád. Ha kézzel exportálsz, szkennelsz vagy nevezel át
fájlokat, írd inkább a dátumot a fájlnévbe: `2026-08-26-hoi-an-01.jpg`.
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/guides.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add docs/guides test/guides.test.ts
git commit -m "B470: the creator guide keeps what How to Use knew about photographs"
```

---

### Task 8: The whole gate, and the live check

**Files:** none changed unless something fails.

- [ ] **Step 1: Confirm no dangling anchors**

Run: `grep -rn "docs#use\|docs#host\|docs#contribute" --include="*.md" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v docs/tasks | grep -v docs/superpowers`
Expected: no output.

- [ ] **Step 2: Run knip**

Run: `npm run unused`
Expected: exit 0. `GuideNav` is deleted, so a "file nothing reaches" failure
here means Step 2 of Task 5 was incomplete.

- [ ] **Step 3: Run the full gate**

Run: `npm run verify`
Expected: `all 4 passed`.

- [ ] **Step 4: Check every docs route answers**

Run, with the dev server or after deploying:

```bash
for p in "" /hosting /contributing /api /guide/guest /guide/creator /guide/buddy; do
  printf "%-22s " "/docs$p"
  curl -s -o /dev/null -w "%{http_code}\n" "https://fernscout.ch/docs$p"
done
```

Expected: `200` for all seven.

- [ ] **Step 5: Check the German hub has no English headings**

```bash
curl -s -H 'cookie: fs.locale=de' https://fernscout.ch/docs | grep -o "How to [A-Za-z]*"
```

Expected: no output.

- [ ] **Step 6: Commit any fixes, then move the ticket**

```bash
npm run tasks -- move B470 testing
```
