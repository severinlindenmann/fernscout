import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import EntryContent from "@/components/EntryContent";
import { readRepoFile, section } from "@/lib/docs";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs",
  description: "How to use, host and contribute to this journal.",
};

const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-navy-200 bg-white px-4 text-sm " +
  "font-semibold text-navy-900 transition-colors hover:border-navy-700";

/**
 * Three audiences, three sections, one page: a reader deciding how to hand an
 * agent content, somebody deciding whether to self-host, somebody deciding
 * whether to send a PR. Where a section is content that already exists and is
 * still accurate — the day-entry example, the four checks — it is read off
 * `README.md`/`CONTRIBUTING.md` at request time rather than retyped (B23: a
 * reference kept in two places disagrees with itself within a month).
 * `test/docs.test.ts` is the tripwire for a heading either file renames out
 * from under this page.
 *
 * "What to give it" is written directly for this page rather than pulled from
 * `docs/ingest.md` (B306) — that file documents a specific import pipeline,
 * and this section only needs to say what actually helps an agent: a
 * timestamp on your photos, and the fields worth filling in by hand.
 *
 * The four screenshots are the same files the README embeds
 * (`docs/screenshots/*.jpg`), served by `app/docs/screenshots/[file]/route.ts`
 * rather than copied into `public/` — see that route for why.
 */
export default function DocsPage() {
  const readme = readRepoFile("README.md");
  const contributing = readRepoFile("CONTRIBUTING.md");
  const site = serverSite();

  const dayEntry = section(readme, "What a day looks like");

  // The image paths (e.g. `docs/screenshots/trip-story.jpg`) are repo-relative,
  // meant for GitHub's own markdown renderer, so they are rewritten to the
  // route that actually serves them here. The closing line is a note for a
  // contributor deciding whether to add a fifth screenshot, not for a
  // visitor, so it is dropped rather than left as a dead link on this page.
  const usage = section(readme, "What it looks like")
    .replace(/\(docs\/screenshots\//g, "(/docs/screenshots/")
    .split("\n\n*Captured at")[0];

  const gettingStarted = section(contributing, "Getting started");
  const fourChecks = section(contributing, "Before you open a PR");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <p className="text-sm font-semibold text-navy-500">
        <a href="/agent.md" className="underline decoration-navy-200 hover:decoration-navy-500">
          /agent.md
        </a>{" "}
        · <a href="/openapi.json" className="underline decoration-navy-200 hover:decoration-navy-500">
          /openapi.json
        </a>
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        {site.name} docs
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        How to use this journal, how to run your own, and how to change the
        software itself.
      </p>

      <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-2">
        <a href="#use" className={PILL}>
          How to Use
        </a>
        <a href="#host" className={PILL}>
          How to Host
        </a>
        <a href="#contribute" className={PILL}>
          How to Contribute
        </a>
        <Link href="/docs/api" className={PILL}>
          API <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Link>
      </nav>

      {/* How to Use — the part every reader of this instance actually came
          for: what to hand an agent, and what it becomes. */}
      <section id="use" className="mt-12 scroll-mt-6 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">How to Use</h2>

        <h3 className="mt-6 font-display text-xl font-semibold text-navy-900">
          Hand this to your agent
        </h3>
        <p className="mt-2 text-navy-700">
          Give it this instance&rsquo;s guide, and the email address your
          journal belongs to:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-navy-900 p-4 text-sm text-cream-50">
          <code>{`${site.url}/documentation.txt`}</code>
        </pre>
        <p className="mt-3 text-navy-700">
          It reads from there, asks for a six-digit code, and exchanges it
          for a token that writes for seven days. Everything it writes
          arrives as a draft — you decide when it goes up. The full guide,
          with every call, is at{" "}
          <a
            href="/agent.md"
            className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
          >
            /agent.md
          </a>
          .
        </p>

        <h3 className="mt-8 font-display text-xl font-semibold text-navy-900">
          What to give it
        </h3>
        <p className="mt-2 text-navy-700">
          Two things help an agent write a good day, and neither is required —
          an empty field beats a guessed one.
        </p>
        <p className="mt-3 text-navy-700">
          <strong className="font-semibold text-navy-900">
            Photos, with a timestamp.
          </strong>{" "}
          Any common format works. JPEG and HEIC carry the capture time (and
          often GPS) automatically on most phones and cameras; if you are
          exporting, scanning or renaming files by hand, keep the date in the
          filename instead —{" "}
          <code className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-sm text-navy-900">
            2026-08-26-hoi-an-01.jpg
          </code>
          . A dated,
          ideally located, set of photos is what lets an agent turn a folder
          into an ordered day with the least back-and-forth.
        </p>
        <p className="mt-3 text-navy-700">
          <strong className="font-semibold text-navy-900">
            A markdown file, if you are writing by hand.
          </strong>{" "}
          One file per update, with whatever of these fields you actually
          know:
        </p>
        <div className="mt-2">
          <EntryContent markdown={dayEntry} />
        </div>

        <h3 className="mt-8 font-display text-xl font-semibold text-navy-900">What you get</h3>
        <div className="mt-2">
          <EntryContent markdown={usage} />
        </div>
      </section>

      {/* How to Host — the other audience this page has: somebody deciding
          whether to self-host, not yet running anything. */}
      <section id="host" className="mt-12 scroll-mt-6 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">How to Host</h2>
        <p className="mt-2 text-navy-700">
          A VPS, Node and Caddy, one deploy script. A public journal needs no
          database, and every optional capability — mail, sign-in, guests,
          push, print — is off by default.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-navy-900 p-4 text-sm text-cream-50">
          <code>{"npm install\nnpm run dev            # http://localhost:3000"}</code>
        </pre>
        {site.repository && (
          <p className="mt-3 text-sm text-navy-600">
            Deploying to a VPS is a longer walk — see{" "}
            <a
              href={`${site.repository}/blob/main/docs/runbook.md`}
              className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              docs/runbook.md
            </a>{" "}
            in the repository.
          </p>
        )}
      </section>

      {/* How to Contribute — the code itself, for whoever wants to change it. */}
      <section id="contribute" className="mt-12 scroll-mt-6 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">
          How to Contribute
        </h2>
        <h3 className="mt-6 font-display text-xl font-semibold text-navy-900">
          Getting started
        </h3>
        <div className="mt-2">
          <EntryContent markdown={gettingStarted} />
        </div>

        <h3 className="mt-6 font-display text-xl font-semibold text-navy-900">
          Before you open a PR
        </h3>
        <div className="mt-2">
          <EntryContent markdown={fourChecks} />
        </div>

        {site.repository && (
          <p className="mt-6 text-sm text-navy-600">
            AGPL-3.0 — the name and mark are not covered by it; see{" "}
            <a
              href={`${site.repository}/blob/main/TRADEMARK.md`}
              className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              TRADEMARK.md
            </a>{" "}
            before using either outside the repository. Full guide:{" "}
            <a
              href={`${site.repository}/blob/main/CONTRIBUTING.md`}
              className="underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
            >
              CONTRIBUTING.md
            </a>
            .
          </p>
        )}
      </section>
    </main>
  );
}
