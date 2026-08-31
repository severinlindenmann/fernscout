import type { Metadata, Viewport } from "next";
import { Fredoka, Plus_Jakarta_Sans } from "next/font/google";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import "./globals.css";

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin", "latin-ext"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
});

/**
 * Instance-level metadata.
 *
 * Deliberately thin: a title, a description and an OG image belong to whoever
 * owns the page, and that is a user — see app/[user]/layout.tsx. What is left
 * here is what is true of the server regardless of whose journal is being read.
 */
export const metadata: Metadata = {
  metadataBase: new URL(serverSite().url),
  title: { default: serverSite().name, template: `%s · ${serverSite().name}` },
  applicationName: serverSite().name,
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#ffd23f",
  colorScheme: "light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The reader's language, if they have picked one. Outside a journal there is
  // no per-journal list to validate against, so any language we maintain
  // chrome for is accepted and anything else falls back — to the language of
  // *this* journal rather than the instance's, which is what `<html lang>` has
  // to say before the inner provider hydrates.
  //
  // `requestLocale` is that rule, now shared: every page's `generateMetadata`
  // needs the same answer for the browser tab, and used to have no answer at
  // all.
  const locale = await requestLocale();

  return (
    <html lang={locale} className={`${fredoka.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ServiceWorkerRegistrar />
        {/* Site identity, the trip list and currency options are all per-user,
            so they are provided by app/[user]/layout.tsx rather than here. */}
        {/* Language belongs to whose journal you are reading, so
            app/[user]/layout.tsx provides its own and wins for that subtree.
            This one covers what sits outside a journal: the landing page, the
            notices, a 404 for an address that names nobody. */}
        <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
