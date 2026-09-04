import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import EntryContent from "@/components/EntryContent";
import { demote, dropTitle, readRepoFile, section } from "@/lib/docs";
import { openApiDocument } from "@/lib/api/openapi";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs",
  description: "How to hand your agent content, and how the site itself runs.",
};

/**
 * The guide a journal's owner actually needs: what to hand an agent, and how
 * the software runs. `AGENTS.md`, the skills in `.claude/skills/` and
 * `docs/` already say all of this — for a person in the repository. Nothing
 * here repeats them; it reads `README.md` and `docs/ingest.md` at request
 * time and renders their own words, so an edit to either reaches this page
 * with no second edit here. `test/docs.test.ts` is the tripwire for the one
 * way that can silently fail: a heading `section()` depends on getting
 * renamed out from under it.
 *
 * The four screenshots are the same files the README embeds
 * (`docs/screenshots/*.jpg`), served by `app/docs/screenshots/[file]/route.ts`
 * rather than copied into `public/` — see that route for why.
 */
export default function DocsPage() {
  const readme = readRepoFile("README.md");
  const ingest = readRepoFile("docs/ingest.md");
  const doc = openApiDocument();
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <p className="text-sm font-semibold text-navy-500">
        <Link href="/docs/api" className="underline decoration-navy-200 hover:decoration-navy-500">
          /docs/api
        </Link>{" "}
        · <a href="/agent.md" className="underline decoration-navy-200 hover:decoration-navy-500">
          /agent.md
        </a>
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        {site.name} docs
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        Everything below is what an agent needs from you, and what the site does
        with it once it has it.
      </p>

      <section className="mt-10">
        <h2 className="font-display text-2xl font-semibold text-navy-900">
          What to hand your agent
        </h2>
        <p className="mt-2 text-navy-700">
          Two ways in, and you can mix both across one trip: a folder of photos,
          or a markdown file written by hand.
        </p>

        <h3 className="mt-6 font-display text-xl font-semibold text-navy-900">
          A folder of photos
        </h3>
        <div className="mt-2">
          {/* The page's own <h3> above already titles this section, so
              ingest.md's own `# Title` is dropped rather than duplicated;
              its `##`/`###` become `####`/`#####`, nested under that <h3>. */}
          <EntryContent markdown={demote(dropTitle(ingest), 2)} />
        </div>

        <h3 className="mt-8 font-display text-xl font-semibold text-navy-900">
          A markdown file, written by hand
        </h3>
        <div className="mt-2">
          <EntryContent markdown={dayEntry} />
        </div>
      </section>

      <section className="mt-12 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">What you get</h2>
        <div className="mt-2">
          <EntryContent markdown={usage} />
        </div>
      </section>

      <section className="mt-12 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">Hosting</h2>
        <p className="mt-2 text-navy-700">
          A VPS, Node and Caddy, one deploy script. A public journal needs no
          database, and every optional capability — mail, sign-in, guests, push,
          print — is off by default.
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

      <section className="mt-12 border-t border-navy-200 pt-8">
        <h2 className="font-display text-2xl font-semibold text-navy-900">The API</h2>
        <p className="mt-2 text-navy-700">{doc.info.summary}</p>
        <Link
          href="/docs/api"
          className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-navy-900
                     underline decoration-blue-500 decoration-2 underline-offset-4
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <BookOpen className="h-4 w-4" aria-hidden />
          Full reference
        </Link>
      </section>
    </main>
  );
}
