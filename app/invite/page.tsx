import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import InviteRequestForm from "@/components/InviteRequestForm";
import PageShell from "@/components/landing/PageShell";
import { Band, TITLE_H1 } from "@/components/landing/kit";
import { TEXT_LINK } from "@/components/landing/styles";
import Link from "next/link";
import { isEnabled } from "@/lib/capabilities";
import { inviteOnly } from "@/lib/inviteList";
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
 * waitlist form — closed by default, absent rather than broken. With signup
 * open it redirects to `/welcome` instead (B2811).
 */
export default async function InvitePage() {
  if (!inviteRequestAvailable()) {
    // B2811 — an old "request an invite" link once signup is open goes to
    // the door that now exists; anywhere else there is nothing to ask for.
    if (!inviteOnly() && isEnabled("signup")) redirect("/welcome");
    notFound();
  }
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
        {/* B-2773. An approved person lands here from an old habit; /welcome is the door. */}
        <p className="mt-6">
          <Link href="/welcome" className={`text-sm ${TEXT_LINK}`}>
            {translateIn(locale, "inviteRequest.alreadyInvited")}
          </Link>
        </p>
      </Band>
    </PageShell>
  );
}
