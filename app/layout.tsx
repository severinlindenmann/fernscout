import type { Metadata, Viewport } from "next";
import { Fredoka, IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import NavProgress from "@/components/NavProgress";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor, requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";
import { DARK_THEME_COLOR, LIGHT_THEME_COLOR } from "@/lib/theme";
import ThemeScript from "@/components/ThemeScript";
import "./globals.css";

// B1726 — `preload: false` on the latin half too, and it is the opposite of
// what it looks like: it *removes* a download rather than deferring one.
//
// Asking next/font for a second subset of a family emits that family's
// **latin** face a second time as well, byte-identical but pointing at the
// unpreloaded copy of the same file — and the second rule is the one that
// wins the cascade. So the shipped stylesheet held both
// `<hash>-s.p.<build>.woff2` and `<hash>-s.<build>.woff2`, the preload
// fetched the first and every page rendered from the second. Two files down
// the wire, one of them thrown away, on every cold load.
//
// Nothing is lost by dropping the hint: the @font-face rules live in the
// render-blocking stylesheet the document head already links, so the browser
// still finds them before it paints, and `font-display: swap` covers the gap.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  preload: false,
});

// B1044 — latin-ext carries the glyphs Hungarian prose needs outside latin-1.
// It stays declared (never cut — a silent fallback-glyph regression is not
// cheaply reversible). Combined with `fredoka` in the --font-display stack in
// globals.css: the browser reaches for this family only when a character the
// first one lacks shows up.
const fredokaExt = Fredoka({
  variable: "--font-fredoka-ext",
  subsets: ["latin-ext"],
  preload: false,
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  preload: false,
});

// Same reasoning as fredokaExt above.
const jakartaExt = Plus_Jakarta_Sans({
  variable: "--font-jakarta-ext",
  subsets: ["latin-ext"],
  preload: false,
});

// B733 — the mono voice for kickers, labels, pills, ids and counts. This one
// has no duplicate to lose to, but B1726 unpreloads it for a plainer reason:
// the landing page paints no mono text at all, so on the instance's most
// visited page the preload was a file fetched for nothing.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: "400",
  preload: false,
});

// B1044 — weight 500 is the rare one, so it is not preloaded. It is used,
// though, and not through its own variable: both instances emit their faces
// under the one family name "IBM Plex Mono", so the 500 faces join the 400
// ones in a single family, and every `font-mono` paired with `font-medium`,
// `font-semibold` or `font-bold` (studio kickers, admin pills, the docs'
// endpoint names) is drawn from this file — the nearest real weight the family
// has. Dropping it would not fail anything; it would quietly swap those labels
// for a synthesised bold of the 400.
const plexMonoMedium = IBM_Plex_Mono({
  variable: "--font-plex-mono-medium",
  subsets: ["latin"],
  weight: "500",
  preload: false,
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
 * follow the reader's language.
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: LIGHT_THEME_COLOR },
    { media: "(prefers-color-scheme: dark)", color: DARK_THEME_COLOR },
  ],
  colorScheme: "light dark",
  // Without cover, env(safe-area-inset-*) is 0 in the installed PWA and the
  // room's tab bar sat inside the iPhone's rounded corners — B1351. The body
  // paints its own cream ground, so drawing into the insets shows colour,
  // never black bars.
  viewportFit: "cover",
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
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${fredoka.variable} ${fredokaExt.variable} ${jakarta.variable} ${jakartaExt.variable} ${plexMono.variable} ${plexMonoMedium.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
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
        <NavProgress />
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
