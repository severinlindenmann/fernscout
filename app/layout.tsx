import type { Metadata, Viewport } from "next";
import { Fredoka, Plus_Jakarta_Sans } from "next/font/google";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale, translateIn } from "@/lib/locales";
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
 *
 * `title.default` is this layout's fallback for a page with no title of its
 * own — every real route sets one, except `app/not-found.tsx` (B251). Next
 * never calls a `not-found.js`'s own `generateMetadata` — see the note there —
 * so this is the only place a 404's tab title can come from, and it is why
 * this is `generateMetadata` rather than a static object: the title has to
 * follow the reader's language. `app/welcome/page.tsx` is the other route with
 * no metadata of its own, and never renders this title — it redirects before
 * anything paints.
 *
 * `robots` used to default every untitled page to `index, follow`. It is gone
 * on purpose, not merely untranslated: Next injects its own `noindex` into any
 * response that reaches a not-found boundary (there are ~40 `notFound()` call
 * sites in `app/`, not just unmatched routes), and that injection is additive
 * rather than a metadata merge — the old default meant every one of those
 * responses carried two conflicting `<meta name="robots">` tags. Dropping it
 * costs nothing real: a page with no `robots` meta at all is still indexed by
 * default, which is all the removed block asserted for the pages that relied
 * on it (the landing page, the docs pages, and a public journal's `[user]`
 * layout). The one thing it also carried — `max-image-preview: large` — was
 * never load-bearing for correctness, so it is not being re-added elsewhere;
 * a route that wants that hint back can set it itself.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(serverSite().url),
    title: {
      default: translateIn(await requestLocale(), "err.notFoundTitle"),
      template: `%s · ${serverSite().name}`,
    },
    applicationName: serverSite().name,
  };
}

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
      {/*
        `min-w-0` is load-bearing, not tidying — B431.

        This is a column flex container, so every direct child is a flex item
        with the default `min-width: auto`, which refuses to shrink below its
        **min-content** width. One unbreakable string anywhere inside — and the
        agent instruction carries two, `https://<site>/documentation.txt` and
        `/agent.md` — therefore sets a floor on the width of the whole page.
        `break-words` wraps the rendered line but leaves min-content alone, so
        the symptom is not a stray URL sticking out: it is the entire document
        laid out wider than the phone, every paragraph clipped on the right,
        and a sideways scroll. It appeared on some phones and not others
        because it depends on the viewport and on how long the sentence is in
        the reader's language.
      */}
      <body className="flex min-h-full min-w-0 flex-col bg-background text-foreground">
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
