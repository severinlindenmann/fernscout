import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LocaleProvider from "@/components/LocaleProvider";
import PageHeader from "@/components/PageHeader";
import SmsStopConfirm from "@/components/SmsStopConfirm";
import { getContact } from "@/lib/contacts";
import { pickLocale } from "@/lib/contacts/locale";
import { resolveSmsStopToken } from "@/lib/contacts/smsStop";
import { dictionaryFor } from "@/lib/locales";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The stop link in a news SMS (B2442, review L2): one button, nothing else
 * of the reader's is reachable from here. */
export default async function SmsStopPage({ params }: PageProps<"/[user]/stop/[token]">) {
  const { user: username, token } = await params;
  const user = getUser(username);
  const contactId = user ? resolveSmsStopToken(username, token) : null;
  if (!user || !contactId) notFound();
  const contact = await getContact(username, contactId);
  if (!contact) notFound();

  const locale = pickLocale(contact.locale);
  const dictionary = dictionaryFor(locale, "smsStopPage");

  return (
    <LocaleProvider locale={locale} dictionary={dictionary}>
      <div className="min-h-screen">
        <PageHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md px-6 py-12 sm:py-16">
          <SmsStopConfirm username={username} token={token} journal={user.title} />
        </main>
      </div>
    </LocaleProvider>
  );
}
