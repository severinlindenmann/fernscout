import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Code2, GitPullRequest, Map, PenLine, Ruler, Server, Users, Wand2 } from "lucide-react";
import Pricing from "@/components/Pricing";
import { isEnabled } from "@/lib/capabilities";
import { DOCS_PAGES, type DocsPageId } from "@/lib/docs";
import { requestLocale, translateIn } from "@/lib/locales";
import { serverSite } from "@/lib/site";

/**
 * The tab title and the description, in the language the page renders in.
 *
 * These were a static `Metadata` object with English literals, which is B225
 * exactly one page over: a German reader got "How to use, host and contribute
 * to this journal" in the browser tab, in the search result and in every link
 * preview, above a page rendered entirely in German. A static `metadata`
 * export cannot see the request, so it cannot see the locale — the fix is the
 * same one `app/page.tsx` uses, and it is `generateMetadata`.
 *
 * `absolute` because the root layout's template appends the site name, and
 * these titles are complete sentences on their own.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { absolute: translateIn(locale, "docs.title") },
    description: translateIn(locale, "docs.lede"),
  };
}

/**
 * The documentation hub — B470.
 *
 * It used to be an index and a document at once: a row of anchors to its own
 * three sections, beside a row of links to the guide pages, with the guides
 * translated and its own headings hardcoded English. A reader met two menus
 * that looked identical and behaved differently, and a page that was half in
 * their language, with no way back to the site from either.
 *
 * Now it answers exactly one question — where are you going — and the cards
 * are its navigation, which is why `DocsNav` is deliberately *not* rendered
 * here. The prose that used to live on this page is at `/docs/hosting` and
 * `/docs/contributing`.
 *
 * **Both group labels are translated, including the one that says its pages
 * are in English.** That sentence is the fix for "it is a mix of German and
 * English": the mix is real and is staying, because those pages are read from
 * `README.md` and `CONTRIBUTING.md` at request time (B23), and what was
 * actually wrong was leaving a reader to conclude the translation had failed.
 */
const ICONS: Record<DocsPageId, typeof BookOpen> = {
  guest: BookOpen,
  creator: PenLine,
  buddy: Users,
  hosting: Server,
  contributing: GitPullRequest,
  api: Code2,
  helper: Wand2,
  roadmap: Map,
};

function Group({
  locale,
  heading,
  note,
  group,
}: {
  locale: string;
  heading: string;
  note: string;
  group: "guides" | "technical";
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-navy-900">{heading}</h2>
      <p className="mt-1 text-navy-600">{note}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {DOCS_PAGES.filter((page) => page.group === group).map((page) => {
          const Icon = ICONS[page.id];
          return (
            <li key={page.id}>
              <Link
                href={page.href}
                className="flex h-full min-h-11 items-center gap-2.5 rounded-xl border border-navy-200
                           bg-white px-4 py-3 text-base font-semibold text-navy-900 transition-colors
                           hover:border-navy-700
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
              >
                <Icon className="h-4 w-4 shrink-0 text-navy-600" aria-hidden strokeWidth={2.2} />
                {translateIn(locale, page.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function DocsPage() {
  const locale = await requestLocale();
  const site = serverSite();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        {translateIn(locale, "docs.title")}
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        {translateIn(locale, "docs.lede")}
      </p>

      <Group
        locale={locale}
        heading={translateIn(locale, "docs.guidesGroup")}
        note={translateIn(locale, "docs.guidesGroupNote")}
        group="guides"
      />
      <Group
        locale={locale}
        heading={translateIn(locale, "docs.technicalGroup")}
        note={translateIn(locale, "docs.technicalGroupNote")}
        group="technical"
      />

      {/*
        The same table the landing page carries, and deliberately the same
        component rather than a second page under `DOCS_PAGES` — one price
        list, two places it is asked for. Absent where credits are off. B840.
      */}
      {isEnabled("credits") && <Pricing locale={locale} />}

      {/*
        The two agent-facing documents, at the foot rather than in a card
        beside "Für Lesende": they are not pages a person reads, and putting
        them in that row is how the old page came to address two audiences
        with one control.

        Two bare URLs and no sentence around them, deliberately. A sentence
        would have to be translated or it reintroduces the mix this ticket
        removes — and a translated sentence wrapping two English filenames
        reads worse than the filenames alone.
      */}
      {/*
        The workbenches, above the two agent documents and below the cards.

        Not a card among the guides: those answer "who are you", and this
        answers "you are working on the drawing", which is a third audience of
        roughly one person at a time. Not in `DOCS_PAGES` either — that list is
        also the nav on every inner page, and a reader following the guides has
        no use for a bench.
      */}
      <section className="mt-12 border-t border-navy-200 pt-6">
        <h2 className="font-display text-lg font-semibold text-navy-900">
          {translateIn(locale, "docs.benchesGroup")}
        </h2>
        <p className="mt-1 text-sm text-navy-600">
          {translateIn(locale, "docs.benchesGroupNote")}
        </p>
        <Link
          href="/docs/branding"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-navy-200
                     bg-white px-4 py-3 text-base font-semibold text-navy-900 transition-colors
                     hover:border-navy-700
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <Ruler className="h-4 w-4 shrink-0 text-navy-600" aria-hidden strokeWidth={2.2} />
          /docs/branding
        </Link>
      </section>

      <p className="mt-12 border-t border-navy-200 pt-6 font-mono text-xs text-navy-600">
        <a
          href="/documentation.txt"
          className="underline decoration-navy-200 hover:decoration-navy-500"
        >
          /documentation.txt
        </a>{" "}
        ·{" "}
        <a href="/openapi.json" className="underline decoration-navy-200 hover:decoration-navy-500">
          /openapi.json
        </a>{" "}
        · {site.url}
      </p>
    </main>
  );
}
