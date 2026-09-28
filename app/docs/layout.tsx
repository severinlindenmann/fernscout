import DocsUpLink from "@/components/DocsUpLink";
import LocaleProvider from "@/components/LocaleProvider";
import PageShell from "@/components/landing/PageShell";
import { dictionaryFor, requestLocale, translateIn } from "@/lib/locales";

/**
 * One frame for every documentation page — B470.
 *
 * Before this there was no docs layout at all: `/docs`, `/docs/api` and the
 * guides each built their own header, `/docs` contained no link back to the
 * site at any point, and the language switcher lived inside the guides' own
 * menu — so it read as a property of the guides rather than of the site.
 *
 * Two jobs, and each now belongs to exactly one place: the way home, and the
 * language. Both are `PageShell`'s since B2531 — the site's header — and the
 * layout adds only the step up from a guide to the hub. The **navigation is deliberately not here** — the pages render it
 * themselves, because the hub's cards *are* its navigation and a row of the
 * same six links above them would be the second menu again, in a new place.
 */
export default async function DocsLayout({ children }: LayoutProps<"/docs">) {
  const locale = await requestLocale();

  // One provider over the whole of `/docs`, with its own strings: the API
  // reference reaches the helper's whole vocabulary on the server, and
  // without this every page under the root layout would carry it
  // (`lib/localeScopes.json`). Same language as the root layout's — both ask
  // `requestLocale`.
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "docs")}>
      {/* B2531: the site's own frame, like every page outside the journal;
          the way up to the hub stays above an inner page's text. */}
      <PageShell>
        <DocsUpLink
          hubHref="/docs"
          hubLabel={translateIn(locale, "docs.title")}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body
                     transition-colors hover:text-ink-strong
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        />
        {children}
      </PageShell>
    </LocaleProvider>
  );
}
