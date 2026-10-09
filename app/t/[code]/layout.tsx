import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { frameLocale } from "./lookup";

/** `/t/<code>`'s frame: the slim header and footer in the page's own language. */
export default async function TripLinkLayout({ children, params }: LayoutProps<"/t/[code]">) {
  const { code } = await params;
  const locale = await frameLocale(code);
  return (
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale, "tripLinkFrame")}>
      {children}
    </LocaleProvider>
  );
}
