import type { Metadata } from "next";
import { notFound } from "next/navigation";
import InviteRequestForm from "@/components/InviteRequestForm";
import PageShell from "@/components/landing/PageShell";
import { Band, TITLE_H1 } from "@/components/landing/kit";
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
    // B2531: the slim header C and the reading width — mid-task, no menu.
    <PageShell slim>
      <Band width="reading">
        <h1 className={TITLE_H1}>{translateIn(locale, "inviteRequest.title")}</h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-body">
          {translateIn(locale, "inviteRequest.intro", { name })}
        </p>
        <InviteRequestForm />
      </Band>
    </PageShell>
  );
}
