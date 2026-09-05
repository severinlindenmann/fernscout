import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NoticeShell from "@/components/NoticeShell";
import PageHeader from "@/components/PageHeader";
import { tierFor } from "@/lib/credits/pricing";
import { requestLocale, translateIn } from "@/lib/locales";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `/{user}/credits/pay/<tier>` — where the purchase mail's button lands.
 *
 * Deliberately dead: B368 builds the front half of buying credits — the
 * button, the tiers, the mail — with no payment provider behind it yet.
 * This page takes no money, sets no cookie and grants nothing. It only says
 * so, and points back at the journal. A real provider is a later ticket and
 * gets its own page when it exists.
 */
export default async function CreditsPayPage({
  params,
}: PageProps<"/[user]/credits/pay/[tier]">) {
  const { user: username, tier: tierId } = await params;
  const user = getUser(username);
  if (!user) notFound();

  const tier = tierFor(tierId);
  const locale = await requestLocale();

  return (
    <div className="min-h-screen">
      <PageHeader />
      <NoticeShell
        lang={locale}
        title={translateIn(locale, "creditsPay.title")}
        body={
          tier
            ? translateIn(locale, "creditsPay.body", { credits: String(tier.credits) })
            : translateIn(locale, "creditsPay.bodyUnknown")
        }
        actions={[
          { href: `/${username}/me`, label: translateIn(locale, "creditsPay.back") },
        ]}
      />
    </div>
  );
}
