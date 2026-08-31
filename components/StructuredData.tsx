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

export function BlogStructuredData({
  entries,
  site,
}: {
  entries: Entry[];
  site: SiteSummary;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Blog",
        name: site.title,
        description: site.tagline,
        url: site.url,
        
        author: [{ "@type": "Person", name: site.travellerNames }],
        blogPost: entries.slice(-10).map((entry) => ({
          "@type": "BlogPosting",
          headline: entry.title,
          datePublished: entry.date,
          url: `${site.url}${site.base}/day/${entry.slug}`,
        })),
      }}
    />
  );
}

export function DayStructuredData({ entry, site }: { entry: Entry; site: SiteSummary }) {
  const image = entry.gallery.find((g) => g.type === "image")?.src;
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: entry.title,
        description: entry.content.replace(/\s+/g, " ").slice(0, 200),
        datePublished: entry.date,
        dateModified: entry.date,
        url: `${site.url}${site.base}/day/${entry.slug}`,
        image: image ? `${site.url}${image}` : undefined,
        author: [{ "@type": "Person", name: site.travellerNames }],
        publisher: { "@type": "Organization", name: site.title },
        isPartOf: { "@type": "Blog", name: site.title, url: `${site.url}${site.base}` },
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
  );
}
