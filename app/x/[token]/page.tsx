import type { Metadata } from "next";
import LocaleProvider from "@/components/LocaleProvider";
import NeverInviteConfirm from "@/components/NeverInviteConfirm";
import PageHeader from "@/components/PageHeader";
import { isNeverInviteToken } from "@/lib/contacts/suppressions";
import { dictionaryFor, requestLocale } from "@/lib/locales";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `/x/<token>` — "never invite this address again" (B2442). Every
 * Fernscout-sent invite's footer carries this link; the token is the
 * address's own `recipientHash` (see lib/contacts/suppressions.ts), so the
 * page never learns, holds or shows the address it suppresses — it can only
 * ever add one row to `invite_suppressions`, checked before every future
 * invite, on any journal this instance hosts.
 *
 * No journal in the URL, no login: this is instance-wide, not per journal
 * (the point is "nobody here invites me", not "this one journal doesn't").
 */
export default async function NeverInvitePage({ params }: PageProps<"/x/[token]">) {
  const { token } = await params;
  if (!isNeverInviteToken(token)) notFound();

  const locale = await requestLocale();
  const dictionary = dictionaryFor(locale, "neverInvitePage");

  return (
    <LocaleProvider locale={locale} dictionary={dictionary}>
      <div className="min-h-screen">
        <PageHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md px-6 py-12 sm:py-16">
          <NeverInviteConfirm token={token} />
        </main>
      </div>
    </LocaleProvider>
  );
}
