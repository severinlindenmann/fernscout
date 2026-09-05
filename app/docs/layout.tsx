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
 * guides each built their own header, `/docs` contained no link back to the
 * site at any point, and the language switcher lived inside the guides' own
 * menu — so it read as a property of the guides rather than of the site.
 *
 * Two jobs, and each now belongs to exactly one place: the way home, and the
 * language. The **navigation is deliberately not here** — the pages render it
 * themselves, because the hub's cards *are* its navigation and a row of the
 * same six links above them would be the second menu again, in a new place.
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
          {/* `LocaleProvider` because the switcher is a client component that
              reads its dictionary from context, and nothing above `/docs`
              provides one — the journal layout is a sibling, not a parent. */}
          <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
            <LocaleSwitcher locales={installedLocales()} subtle />
          </LocaleProvider>
        </div>
      </header>
      {children}
    </div>
  );
}
