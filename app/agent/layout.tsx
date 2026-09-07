import BackLink from "@/components/BackLink";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * One thin frame over `/agent` and `/agent/<user>` — B697.
 *
 * `/agent` used to render its own `<main>` and nothing else: no way back to
 * the journal or the landing page beyond the browser's own back button, which
 * an installed PWA does not always have, and no name for which instance this
 * even is beyond the browser tab. Every other page here carries
 * `components/PageHeader.tsx`, but that component is journal-scoped —
 * `TripSwitcher`, the currency and trip context it reads assume a trip is in
 * play, which is never true on the door and is only sometimes true once the
 * wizard has one selected. So this borrows the lighter frame `/docs` already
 * uses for the same reason (a page that belongs to the instance, not to one
 * trip): a link home and the instance's own name, nothing else. No locale
 * switcher — unlike `/docs`, `LocaleProvider` here already comes from the
 * root layout, and a page mid-wizard is not where a language change belongs.
 */
export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const locale = await requestLocale();
  const site = serverSite();

  return (
    <div className="min-h-full">
      <header className="border-b border-navy-200 bg-cream-100/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <BackLink
            fallbackHref="/"
            fallbackLabel={translateIn(locale, "docs.backToSite", { name: site.name })}
            retraceLabel={translateIn(locale, "nav.back")}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-700
                       transition-colors hover:text-navy-900
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          />
        </div>
      </header>
      {children}
    </div>
  );
}
