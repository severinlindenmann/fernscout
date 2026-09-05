import type { Metadata } from "next";
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
 */
export default async function ContributingPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const contributing = readRepoFile("CONTRIBUTING.md");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        Contributing
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        How to run the code, and what a change has to clear before it is merged.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/contributing" />
      </div>

      <div className="mt-8 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">Getting started</h2>
        <div className="mt-2">
          <EntryContent markdown={section(contributing, "Getting started")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
          Before you open a PR
        </h2>
        <div className="mt-2">
          <EntryContent markdown={section(contributing, "Before you open a PR")} />
        </div>

        {site.repository && (
          <p className="mt-8 text-sm text-navy-600">
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
