import BackLink from "@/components/BackLink";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * One thin frame over `/agent/<user>` and `/agent/<user>/inbox` — B697,
 * narrowed to just these two by B1121.
 *
 * It used to sit over `/agent` as well, at `app/agent/layout.tsx`. B1121 gave
 * the room (`HelperRoom`, drawn by `/agent` when somebody is signed in and
 * owns a journal) its own header — a chevron before the journal name, in one
 * row rather than two — so a second back bar above it would have been the
 * exact wasted vertical space that ticket was about. `/agent/<user>` still
 * needs one: `AgentInbox` draws no header of its own, and the page above it
 * is only a redirect to `/agent` now (B1220/B1239 retired the step-wizard
 * this route used to serve) — but the inbox is still real, and this frame is
 * its header.
 */
export default async function AgentLayout({
  children,
}: LayoutProps<"/agent/[user]">) {
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
