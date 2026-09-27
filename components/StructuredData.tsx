import type { SiteSummary } from "@/lib/site";
import type { Entry } from "@/lib/types";

/** Emits a JSON-LD block. The payload is our own data, never user input from
 * the network, so serialising it into the script tag is safe — we still
 * escape `<` so a stray character in an entry can't close the tag early. */
function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}

/**
 * B2476 — every URL in here has to be one the site answers 200 on. They used
 * to be built as `<journal>/day/<slug>`, which only exists for the current
 * trip, so every past trip's posts (and each past trip's own day page) pointed
 * a crawler at a 404. The caller now hands over the paths its own canonical
 * uses, because the caller is the one that knows which of a day's two
 * addresses this page is.
 */
export function BlogStructuredData({
  entries,
  site,
  authors,
  dayBase,
  inLanguage,
}: {
  entries: Entry[];
  site: SiteSummary;
  /** One traveller per entry — never a joined string. Two people sharing a
   * trip are two `Person`s, not one with an ampersand in their name. */
  authors: string[];
  /** Path the trip's days hang off — `/<user>` for the current trip, else
   * `/<user>/trips/<id>`. The page's own canonical, in other words. */
  dayBase: string;
  /** The language the journal is written in. */
  inLanguage: string;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Blog",
        name: site.title,
        description: site.tagline,
        url: `${site.url}${site.base}`,
        inLanguage,
        author: authors.map((name) => ({ "@type": "Person", name })),
        blogPost: entries.slice(-10).map((entry) => ({
          "@type": "BlogPosting",
          headline: entry.title,
          datePublished: entry.date,
          url: `${site.url}${dayBase}/day/${entry.slug}`,
        })),
      }}
    />
  );
}

export function DayStructuredData({
  entry,
  site,
  authors,
  url,
  trip,
  inLanguage,
}: {
  entry: Entry;
  site: SiteSummary;
  /** One traveller per entry — never a joined string. See `BlogStructuredData`. */
  authors: string[];
  /** The day's canonical path, exactly as the page's metadata declares it. */
  url: string;
  /** The trip's title and its canonical path, for the breadcrumb. */
  trip: { title: string; path: string };
  inLanguage: string;
}) {
  const image = entry.gallery.find((g) => g.type === "image")?.src;
  const journal = `${site.url}${site.base}`;
  const tripUrl = `${site.url}${trip.path}`;
  const crumbs = [
    { name: site.title, item: journal },
    // The current trip lives at the journal's own URL; one crumb, not two
    // pointing at the same page.
    ...(tripUrl === journal ? [] : [{ name: trip.title, item: tripUrl }]),
    { name: entry.title, item: `${site.url}${url}` },
  ];
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: entry.title,
          description: entry.content.replace(/\s+/g, " ").slice(0, 200),
          datePublished: entry.date,
          dateModified: entry.date,
          url: `${site.url}${url}`,
          inLanguage,
          image: image ? `${site.url}${image}` : undefined,
          author: authors.map((name) => ({ "@type": "Person", name })),
          publisher: { "@type": "Organization", name: site.title },
          isPartOf: { "@type": "Blog", name: site.title, url: journal },
          contentLocation: {
            "@type": "Place",
            name: `${entry.location}, ${entry.country}`,
            geo: {
              "@type": "GeoCoordinates",
              latitude: entry.lat,
              longitude: entry.lng,
            },
          },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, ...c })),
        }}
      />
    </>
  );
}

/**
 * What the instance is, for the landing page — B2476: the Organization that
 * runs it, the WebSite, and the software itself. The one offer is the free
 * journal, which is true on every instance; paid extras are priced on the page
 * and are not repeated here, where a number could drift from the till.
 */
export function LandingStructuredData({
  name,
  url,
  description,
  repository,
  languages,
}: {
  name: string;
  url: string;
  description: string;
  repository?: string;
  languages: string[];
}) {
  const organization = {
    "@type": "Organization",
    name,
    url,
    logo: `${url}/apple-icon`,
    ...(repository ? { sameAs: [repository] } : {}),
  };
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@graph": [
          { ...organization, "@id": `${url}/#organization` },
          {
            "@type": "WebSite",
            "@id": `${url}/#website`,
            name,
            url,
            inLanguage: languages,
            publisher: { "@id": `${url}/#organization` },
          },
          {
            "@type": "SoftwareApplication",
            name,
            url,
            description,
            applicationCategory: "TravelApplication",
            operatingSystem: "Web",
            offers: { "@type": "Offer", price: "0", priceCurrency: "CHF" },
            publisher: { "@id": `${url}/#organization` },
          },
        ],
      }}
    />
  );
}
