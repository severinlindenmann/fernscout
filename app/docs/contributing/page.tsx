import type { Metadata } from "next";
import Link from "next/link";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Contributing" };

/**
 * Changing the software itself — B470. Was `#contribute` on the docs index.
 *
 * Read from `CONTRIBUTING.md` at request time, so the file a pull-request
 * author is told to follow and the page describing it cannot drift apart
 * (B23). `section()` throws on a missing heading rather than rendering empty,
 * and `test/docs.test.ts` is the tripwire for that.
 *
 * The workbenches (`/docs/branding`) are linked from here rather than from the
 * hub: they are for whoever is changing what this software draws, which is a
 * contributor, and the hub's reader has no use for a bench.
 */
export default async function ContributingPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const contributing = readRepoFile("CONTRIBUTING.md");
  // "Working with an agent" links `AGENTS.md` and `CLAUDE.md` relative to the
  // repository root, for GitHub's renderer. Here they would be dead links, so
  // they go to the repository instead — or lose the link where there is none.
  const fix = (markdown: string) =>
    markdown.replace(/\[([^\]]+)\]\((?!https?:|\/|#)([\w./-]+)\)/g, (_, text: string, file: string) =>
      site.repository ? `[${text}](${site.repository}/blob/main/${file})` : text,
    );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">
        Contributing
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-body">
        How to run the code, and what a change has to clear before it is merged.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/contributing" />
      </div>

      <div className="mt-8 border-t border-line-quiet pt-8">
        <h2 className="font-display text-2xl font-semibold text-ink-strong">Getting started</h2>
        <div className="mt-2">
          <EntryContent markdown={section(contributing, "Getting started")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
          Working with an agent
        </h2>
        <div className="mt-2">
          <EntryContent markdown={fix(section(contributing, "Working with an agent"))} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
          Before you open a PR
        </h2>
        <div className="mt-2">
          <EntryContent markdown={section(contributing, "Before you open a PR")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">Workbenches</h2>
        <p className="mt-2 text-ink-body">
          For the parts this software draws rather than writes — the mark, the
          travel scene, the travellers, the day card and the print pieces. Each bench isolates one
          of them so a fault can be seen and traced to its file. Not indexed.
        </p>
        <Link
          href="/docs/branding"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-quiet
                     bg-surface-raised px-4 py-3 font-mono text-sm font-medium text-ink-strong transition-colors
                     hover:border-line-ink
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          /docs/branding
        </Link>

        {site.repository && (
          <p className="mt-8 text-sm text-ink-secondary">
            The whole file, and the licence terms, are{" "}
            <a
              href={`${site.repository}/blob/main/CONTRIBUTING.md`}
              className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              in the repository
            </a>
            .
          </p>
        )}
      </div>
    </main>
  );
}
