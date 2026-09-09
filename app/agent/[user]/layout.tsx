import BackLink from "@/components/BackLink";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * One thin frame over the wizard and its inbox — `/agent/<user>` and
 * `/agent/<user>/inbox` — B697, narrowed to just these two by B1121.
 *
 * It used to sit over `/agent` as well, at `app/agent/layout.tsx`. B1121 gave
 * the room (`HelperRoom`, drawn by `/agent` when somebody is signed in and
 * owns a journal) its own header — a chevron before the journal name, in one
 * row rather than two — so a second back bar above it would have been the
 * exact wasted vertical space that ticket was about. `/agent/<user>` still
 * needs one: `AgentWizard` and `AgentInbox` draw no header of their own, and
 * B1102 kept this route alive as the first-day wizard `SignupWizard` still
 * lands a brand-new owner on, so it is not going away with the frame moved.
 */
export default async function AgentWizardLayout({
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
