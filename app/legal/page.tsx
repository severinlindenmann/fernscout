import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EntryContent from "@/components/EntryContent";
import { readLegal } from "@/lib/legal";
import { requestLocale, translateIn } from "@/lib/locales";

/**
 * Imprint, liability and privacy — one page, linked from the landing footer.
 *
 * A top-level route rather than a card under `/docs`, because `/docs` is for
 * somebody deciding whether to self-host and this is for somebody deciding
 * whether to trust the instance in front of them. `legal` is in the reserved
 * usernames so no journal can take the address.
 *
 * The whole body comes from `content/legal/<locale>.md` — see lib/legal.ts for
 * why it is content and not code. 404 when there is none, which is also what
 * keeps the footer link honest: `hasLegal()` decides whether it is drawn.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: translateIn(locale, "legal.title"),
    description: translateIn(locale, "legal.lede"),
    alternates: { canonical: "/legal" },
  };
}

export default async function LegalPage() {
  const locale = await requestLocale();
  const legal = readLegal(locale);
  if (!legal) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        {translateIn(locale, "legal.title")}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        {translateIn(locale, "legal.lede")}
      </p>

      {/* Said out loud when the reader asked for a language this instance has
          not written its imprint in — the same bargain the reader guides make,
          and it matters more here: somebody reading a liability sentence in a
          second language should know that is what they are doing. */}
      {legal.locale !== locale && (
        <p className="mt-6 rounded-xl border border-navy-200 bg-cream-100 px-4 py-3 text-sm text-navy-700">
          {translateIn(locale, "legal.notTranslated")}
        </p>
      )}

      <div className="mt-8 border-t border-navy-200 pt-8">
        <EntryContent markdown={legal.markdown} />
      </div>
    </main>
  );
}
