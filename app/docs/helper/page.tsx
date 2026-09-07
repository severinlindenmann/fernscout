import type { Metadata } from "next";
import Link from "next/link";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Making content" };

const HELPER_REPO = "https://github.com/severinlindenmann/fernscout-helper";

/**
 * Where content comes from, when there is no CMS.
 *
 * Decision 24 says there is no web form and no CMS, and every other page here
 * states that as a property of the software. It is also the first thing a
 * person hits: they have a folder of holiday photographs and this project
 * offers them a content model. The answer is a separate repository of agent
 * tools, and until now it was written down nowhere a reader would find it.
 *
 * Read from `docs/helper.md` at request time rather than repeated, the same
 * argument B23 makes about the rest of `docs/` — a reference kept in two
 * places disagrees with itself within a month, and this one describes a
 * repository that is not even in this checkout.
 *
 * English, deliberately, like the other technical pages: the source is an
 * English file and the audience is somebody about to run `git clone`.
 */
export default async function HelperPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const doc = readRepoFile("docs/helper.md");

  // Links written for GitHub's own renderer point at sibling files in `docs/`.
  // Only `running-locally.md` is referenced, and it has no page here, so it is
  // sent to the repository rather than left as a dead relative link.
  const repoDocs = site.repository ? `${site.repository}/blob/main/docs/` : "";
  const fix = (markdown: string) =>
    repoDocs ? markdown.replace(/\((?!https?:|\/)([\w-]+\.md)\)/g, `(${repoDocs}$1)`) : markdown;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        Making content
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        There is still no CMS, and there will not be one. Photographs and words
        arrive through an agent — this instance can host one for you at{" "}
        <Link
          href="/agent"
          className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
        >
          /agent
        </Link>
        , or, if you would rather run your own,{" "}
        <a
          href={HELPER_REPO}
          className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
        >
          Fernscout&nbsp;Helper
        </a>{" "}
        is a separate toolbox that gives it something to run.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/helper" />
      </div>

      <div className="mt-8 border-t border-navy-200 pt-8">
        <pre className="overflow-x-auto rounded-xl bg-navy-900 p-4 text-sm text-cream-50">
          <code>{`git clone ${HELPER_REPO}\ncd fernscout-helper\nclaude`}</code>
        </pre>
        <p className="mt-3 text-sm text-navy-600">
          MIT, no dependencies to install, and nothing it produces depends on it
          afterwards.
        </p>
      </div>

      <div className="mt-8">
        <EntryContent markdown={fix(section(doc, "What it is for"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
        Extracting photographs
      </h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "Extracting photographs"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
        Extracting costs
      </h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "Extracting costs"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
        The costs a statement cannot see
      </h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "The costs a statement cannot see"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">What comes out</h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "What comes out"))} />
      </div>

      <div className="mt-8">
        <EntryContent markdown={fix(section(doc, "What it does not do"))} />
      </div>
    </main>
  );
}
