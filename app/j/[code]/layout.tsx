import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { frameLocale } from "./lookup";

/**
 * `/j/<code>`'s own frame — B2533: the slim header C and the shared footer
 * (`PageShell`, drawn in `page.tsx`), in the contact's own language rather
 * than the visitor's browser (`frameLocale`, same reasoning as
 * `app/at/[user]/c/[token]/page.tsx`'s nested provider).
 */
export default async function JoinLayout({ children, params }: LayoutProps<"/j/[code]">) {
  const { code } = await params;
  const locale = await frameLocale(code);
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "joinFrame")}>
      {children}
    </LocaleProvider>
  );
}
