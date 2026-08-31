import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import ContactForm from "@/components/ContactForm";
import { isEnabled } from "@/lib/capabilities";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";
import { getUser } from "@/lib/users";
import { dictionariesFor, localesFor } from "@/lib/locales";

export const dynamic = "force-dynamic";

/** Never indexed. It is a form for people who were handed the link, not a page
 * that should turn up in a search for somebody's name. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The open link — `/{user}/join?lang=de`.
 *
 * The one you paste into a family group chat. It carries no token and grants
 * nothing: everybody who fills it in becomes their own pending row and waits
 * for the owner, which is what makes it safe to paste (decision 19). The abuse
 * guard is a rate limit on the endpoint behind it (C15), not a secret in the
 * URL.
 *
 * Language: the `lang` in the link first — whoever shared it usually knows what
 * the group speaks — then what the browser asked for, then the journal's own.
 */
export default async function JoinPage({ params, searchParams }: PageProps<"/[user]/join">) {
  const { user: username } = await params;
  const user = getUser(username);
  if (!user || !isEnabled("contacts", username)) notFound();

  const query = await searchParams;
  const lang = typeof query.lang === "string" ? query.lang : null;
  const accept = (await headers()).get("accept-language");
  const locale = pickLocale(lang, fromAcceptLanguage(accept), user.defaultLocale);

  return (
    <ContactForm
      locales={localesFor(username)}
      dictionaries={dictionariesFor(username)} username={username} journalTitle={user.title} initialLocale={locale} />
  );
}
