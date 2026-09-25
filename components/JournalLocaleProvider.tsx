import { notFound } from "next/navigation";
import LocaleProvider from "./LocaleProvider";
import { dictionaryFor, journalLocale, type LocaleScope } from "@/lib/locales";
import { getUser } from "@/lib/users";

/**
 * A journal's language again, one layout down, with a larger set of strings.
 *
 * `app/[user]/layout.tsx` ships the strings a reader's pages use and no more
 * (see `dictionaryFor`). The two places inside a journal with far more words
 * — the owner's studio and a reader's own `/me` — sit under this instead, which
 * replaces that provider for its subtree with one carrying its own scope. Same
 * language (`journalLocale`, the one the journal layout asks), same
 * `writtenLocale`; only the dictionary differs.
 *
 * `notFound()` for a name that is no journal, as the journal layout does:
 * layouts render side by side, so this one cannot count on that one having
 * stopped the request first.
 */
export default async function JournalLocaleProvider({
  username,
  scope,
  children,
}: {
  username: string;
  scope: LocaleScope;
  children: React.ReactNode;
}) {
  const user = getUser(username);
  if (!user) notFound();
  const locale = await journalLocale(user);
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, scope)} writtenLocale={user.defaultLocale}>
      {children}
    </LocaleProvider>
  );
}
