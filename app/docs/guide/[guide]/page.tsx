import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { GUIDES, docsNavEntries, isGuide, readGuide } from "@/lib/docs";
import { requestLocale, translateIn } from "@/lib/locales";

/**
 * One of the three reader guides — B445.
 *
 * A dynamic segment rather than three near-identical files: the pages differ
 * in one markdown file each, and three copies of this frame is three places to
 * forget when the menu or the language fallback changes.
 *
 * `/docs/api` is a static sibling and stays reachable — Next resolves a static
 * segment before a dynamic one — but these live under `/docs/guide/` anyway,
 * so the two cannot collide even in principle.
 */

export async function generateStaticParams() {
  return GUIDES.map((guide) => ({ guide }));
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/guide/[guide]">): Promise<Metadata> {
  const { guide } = await params;
  if (!isGuide(guide)) return {};
  const locale = await requestLocale();
  return {
    title: translateIn(locale, `guides.${guide}.title`),
    description: translateIn(locale, `guides.${guide}.lede`),
  };
}

export default async function GuidePage({ params }: PageProps<"/docs/guide/[guide]">) {
  const { guide } = await params;
  if (!isGuide(guide)) notFound();

  const locale = await requestLocale();
  const { markdown, locale: written } = readGuide(guide, locale);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className=" font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        {translateIn(locale, `guides.${guide}.title`)}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        {translateIn(locale, `guides.${guide}.lede`)}
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current={`/docs/guide/${guide}`} />
      </div>

      {/*
        Said out loud when the reader asked for a language this guide does not
        have yet. Presenting English silently would be presenting it as though
        it were the translation — and the reader who most needs these pages is
        the one least able to tell the difference.
      */}
      {written !== locale && (
        <p className="mt-6 rounded-xl border border-navy-200 bg-cream-100 px-4 py-3 text-sm text-navy-700">
          {translateIn(locale, "guides.inEnglish")}
        </p>
      )}

      <div className="mt-8 border-t border-navy-200 pt-8">
        <EntryContent markdown={markdown} />
      </div>
    </main>
  );
}
