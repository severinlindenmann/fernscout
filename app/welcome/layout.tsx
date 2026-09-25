import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale } from "@/lib/locales";

/**
 * The sign-up page under its own strings — the wizard's, which no other page
 * under the root layout needs, so the root's provider does not carry them
 * (`lib/localeScopes.json`). Same language as the root layout, which asks
 * `requestLocale` too.
 */
export default async function WelcomeLayout({ children }: LayoutProps<"/welcome">) {
  const locale = await requestLocale();
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "welcome")}>
      {children}
    </LocaleProvider>
  );
}
