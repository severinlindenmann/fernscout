import UpLink from "@/components/UpLink";
import { requestLocale, translateIn } from "@/lib/locales";

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

  return (
    <div className="min-h-full">
      <header className="border-b border-line-quiet bg-surface-subtle/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          {/* Up to the helper, not out to the landing page — B1728. Both
              pages this frame covers sit under `/agent`, and that is what a
              reader on the inbox is one level below. */}
          <UpLink
            href="/agent"
            label={translateIn(locale, "nav.agent")}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body
                       transition-colors hover:text-ink-strong
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          />
        </div>
      </header>
      {children}
    </div>
  );
}
