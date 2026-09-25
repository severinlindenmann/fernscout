import type { Metadata } from "next";
import { notFound } from "next/navigation";
import EntryContent from "@/components/EntryContent";
import LocaleProvider from "@/components/LocaleProvider";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import UpLink from "@/components/UpLink";
import { legalSections, readLegal } from "@/lib/legal";
import { dictionaryFor, installedLocales, requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * Imprint, liability and privacy — one page, linked from the landing footer.
 *
 * A top-level route rather than a card under `/docs`, because `/docs` is for
 * somebody deciding whether to self-host and this is for somebody deciding
 * whether to trust the instance in front of them. `legal` is in the reserved
 * usernames so no journal can take the address.
 *
 * The whole body comes from `site/legal/<locale>.md` — see lib/legal.ts for
 * why it is content and not code. 404 when there is none, which is also what
 * keeps the footer link honest: `hasLegal()` decides whether it is drawn.
 *
 * One page rather than an imprint and a privacy page, with an anchor on every
 * section, so `/legal#privacy` can be the App Store's privacy-policy URL.
 * The date and the "In short" list come from the file's front matter and are
 * simply absent when the operator wrote none — B2313.
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
  const { markdown, sections } = legalSections(legal.markdown);
  const idAtLine = new Map(sections.map((s) => [s.line, s.id]));
  const updated =
    legal.updated &&
    new Intl.DateTimeFormat(legal.locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${legal.updated}T00:00:00Z`),
    );

  return (
    <div className="min-h-full">
      {/* The docs pages' bar — B2312. Nothing else on this page links out, and
          in the iPhone app there is no browser Back to fall back on. */}
      <header className="border-b border-line-quiet bg-surface-subtle/95 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <UpLink
            href="/"
            label={serverSite().name}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body
                       transition-colors hover:text-ink-strong
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          />
          <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
            <LocaleSwitcher locales={installedLocales()} subtle />
          </LocaleProvider>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">
          {translateIn(locale, "legal.title")}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-body">
          {translateIn(locale, "legal.lede")}
        </p>
        {updated && (
          <p className="mt-2 text-sm text-ink-secondary">{translateIn(locale, "legal.updated", { date: updated })}</p>
        )}

        {/* Said out loud when the reader asked for a language this instance has
            not written its imprint in — the same bargain the reader guides make,
            and it matters more here: somebody reading a liability sentence in a
            second language should know that is what they are doing. */}
        {legal.locale !== locale && (
          <p className="mt-6 rounded-xl border border-line-quiet bg-surface-subtle px-4 py-3 text-sm text-ink-body">
            {translateIn(locale, "legal.notTranslated")}
          </p>
        )}

        {legal.summary && (
          <section className="mt-8 rounded-r-xl border-l-4 border-yellow-400 bg-surface-subtle px-5 py-4">
            <h2 className="font-display text-lg font-semibold text-ink-strong">
              {translateIn(locale, "legal.inShort")}
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-body marker:text-ink-secondary">
              {legal.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {sections.length > 1 && (
          <nav aria-labelledby="legal-contents" className="mt-8">
            <h2 id="legal-contents" className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
              {translateIn(locale, "legal.contents")}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="inline-flex min-h-11 items-center text-ink-strong underline decoration-blue-500
                               decoration-2 underline-offset-2 hover:decoration-coral-600 sm:min-h-0"
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="mt-8 border-t border-line-quiet pt-8">
          <EntryContent
            markdown={markdown}
            components={{
              h2: ({ node, ...props }) => (
                <h2 {...props} id={idAtLine.get(node?.position?.start.line ?? 0)} className="scroll-mt-6" />
              ),
            }}
          />
        </div>
      </main>
    </div>
  );
}
