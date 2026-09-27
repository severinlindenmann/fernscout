import type { Metadata } from "next";
import { notFound } from "next/navigation";
import InviteRequestForm from "@/components/InviteRequestForm";
import UpLink from "@/components/UpLink";
import { inviteRequestAvailable } from "@/lib/inviteRequest";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

// Depends only on server capability, not on anything cacheable.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "inviteRequest.metaTitle", { name: serverSite().name }) },
    robots: { index: false, follow: false },
  };
}

/**
 * A stranger asking to be let in — B2507.
 *
 * `inviteRequestAvailable()` (`lib/inviteRequest.ts`) is a ceiling, not a
 * setting: the instance has to actually be invite-only, with mail and a
 * database, or there is nothing this page could do. Off, the route 404s
 * exactly like a self-hosted clone with no `iosApp.storeUrl` renders no
 * waitlist form — closed by default, absent rather than broken.
 */
export default async function InvitePage() {
  if (!inviteRequestAvailable()) notFound();
  const locale = await requestLocale();
  const name = serverSite().name;

  return (
    <div className="min-h-full bg-surface-subtle">
      <header className="border-b border-line-quiet bg-surface-subtle/95 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-lg items-center">
          <UpLink
            href="/"
            label={name}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body
                       transition-colors hover:text-ink-strong
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          />
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-10 sm:py-16">
        <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">
          {translateIn(locale, "inviteRequest.title")}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-body">
          {translateIn(locale, "inviteRequest.intro", { name })}
        </p>
        <InviteRequestForm />
      </main>
    </div>
  );
}
