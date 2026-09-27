import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale } from "@/lib/locales";

/**
 * `/invite`'s own strings, under its own scope — the root layout's provider
 * does not need to carry them (`lib/localeScopes.json`), the same reasoning
 * as `app/welcome/layout.tsx`.
 */
export default async function InviteLayout({ children }: LayoutProps<"/invite">) {
  const locale = await requestLocale();
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "invite")}>
      {children}
    </LocaleProvider>
  );
}
