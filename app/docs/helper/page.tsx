import type { Metadata } from "next";
import Link from "next/link";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Your own agent" };

const HELPER_REPO = "https://github.com/severinlindenmann/fernscout-helper";

/**
 * For somebody who would rather have their own agent do the sorting.
 *
 * Most people write in the studio now, and this page says so first. It used
 * to open with "there is no CMS, and there will not be one" — true of the
 * old Decision 24, and flatly contradicted by the studio a click away. What
 * is left for this page is the other door: a folder of holiday photographs
 * and bank statements, an agent the person runs themselves, and the separate
 * repository of tools that gives that agent something to run.
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
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">
        Your own agent
      </h1>
      {/*
        Used to point at `/agent`, the hosted room — B1905. That door is on
        a retirement path (`docs/plans/2026-09-17-the-studio.md`); most of
        what a reader used to reach by talking to it is now a flow they can
        click through in the studio instead. This page names no journal, so
        it cannot link straight at `/<user>/studio` the way an owner page
        can — `/welcome` makes a journal and ends in its studio (B2170);
        somebody who already has one signs in from there.
      */}
      <p className="mt-3 text-lg leading-relaxed text-ink-body">
        Days are written in{" "}
        <Link
          href="/welcome"
          className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
        >
          the studio
        </Link>
        , which walks you through photographs, places and costs. If you would
        rather hand a folder to an agent you run yourself,{" "}
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

      <div className="mt-8 border-t border-line-quiet pt-8">
        <pre className="overflow-x-auto rounded-xl bg-overlay-strong p-4 text-sm text-overlay-ink">
          <code>{`git clone ${HELPER_REPO}\ncd fernscout-helper\nclaude`}</code>
        </pre>
        <p className="mt-3 text-sm text-ink-secondary">
          MIT, no dependencies to install, and nothing it produces depends on it
          afterwards.
        </p>
      </div>

      <div className="mt-8">
        <EntryContent markdown={fix(section(doc, "What it is for"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
        Extracting photographs
      </h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "Extracting photographs"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
        Extracting costs
      </h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "Extracting costs"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
        The costs a statement cannot see
      </h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "The costs a statement cannot see"))} />
      </div>

      <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">What comes out</h2>
      <div className="mt-3">
        <EntryContent markdown={fix(section(doc, "What comes out"))} />
      </div>

      <div className="mt-8">
        <EntryContent markdown={fix(section(doc, "What it does not do"))} />
      </div>
    </main>
  );
}
