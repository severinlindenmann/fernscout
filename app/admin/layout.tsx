import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale } from "@/lib/locales";

/**
 * The operator console under its own strings — it reaches most of the
 * helper's vocabulary, which no other page under the root layout needs, so
 * the root's provider does not carry it (`lib/localeScopes.json`). Same
 * language as the root layout, which asks `requestLocale` too.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const locale = await requestLocale();
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "admin")}>
      {children}
    </LocaleProvider>
  );
}
