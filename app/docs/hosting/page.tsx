import type { Metadata } from "next";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Hosting" };

/**
 * Running your own copy — B470.
 *
 * Was `#host` on the docs index, which made it an anchor sitting in a row that
 * otherwise held links to pages. Its content is read from `README.md` at
 * request time rather than repeated (B23), so the repository's front door
 * stays the one place this is maintained.
 *
 * English, deliberately, and the hub says so: the source is an English file
 * and the audience is somebody about to run `npm install`.
 */
export default async function HostingPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const readme = readRepoFile("README.md");

  // Repo-relative image paths are written for GitHub's own renderer; rewrite
  // them to the route that serves those files here. The trailing capture note
  // is for a contributor rather than a visitor, so it is dropped rather than
  // left on the page as a dangling aside.
  const looks = section(readme, "What it looks like")
    .replace(/\(docs\/screenshots\//g, "(/docs/screenshots/")
    .split("\n\n*Captured at")[0];
  const dayEntry = section(readme, "What a day looks like");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">Hosting</h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        A VPS, Node and Caddy, one deploy script. A public journal needs no
        database, and every optional capability — mail, sign-in, guests, push,
        print — is off by default.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/hosting" />
      </div>

      <div className="mt-8 border-t border-navy-200 pt-8">
        <pre className="overflow-x-auto rounded-xl bg-navy-900 p-4 text-sm text-cream-50">
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

        <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">
          What a day looks like
        </h2>
        <p className="mt-2 text-navy-700">
          One markdown file per update, carrying whatever fields are actually
          known. An empty field beats a guessed one.
        </p>
        <div className="mt-2">
          <EntryContent markdown={dayEntry} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-navy-900">What you get</h2>
        <div className="mt-2">
          <EntryContent markdown={looks} />
        </div>
      </div>
    </main>
  );
}
