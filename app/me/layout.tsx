import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale } from "@/lib/locales";

/**
 * `/me` in the reader's language, with only the strings its own files ask
 * for — the `account` scope in `scripts/locale-scopes-lib.mjs`. No journal
 * owns this page, so the language is the reader's choice (`requestLocale`),
 * the same rule as the landing page it is reached from.
 */
export default async function AccountLayout({ children }: LayoutProps<"/me">) {
  const locale = await requestLocale();
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "account")}>
      {children}
    </LocaleProvider>
  );
}
