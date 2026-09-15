import type { Metadata } from "next";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";

export const metadata: Metadata = { title: "Getting your own data out" };

/**
 * Where a person's own data actually lives, and the shortest real way to get
 * it out of there — B1751's companion to the camera-roll import. That import
 * (`/[user]/extract`) handles photographs already on the device; this page is
 * the other half, for the exports that are buried somewhere else and written
 * down nowhere on this site: a location history, an address book, a bank
 * statement.
 *
 * Read from `docs/extract.md` at request time, the same reason `/docs/hosting`
 * reads `README.md` — a route this fragile (every export flow named here
 * moves every few months) is worse kept in two places than in one. This page
 * writes no click-by-click instructions of its own: every step comes from the
 * provider's own linked documentation, or from a route already followed and
 * recorded elsewhere in this repository.
 *
 * English, deliberately, like the other technical pages: the source is an
 * English file and every link on it goes to an English support page.
 */
export default async function ExtractPage() {
  const locale = await requestLocale();
  const doc = readRepoFile("docs/extract.md");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">
        Getting your own data out
      </h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-body">
        A trip is not only the photographs on a phone. It is also a location
        history, an address book, a bank statement — each buried somewhere
        different, and each with its own route out.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/extract" />
      </div>

      <p className="mt-8 text-sm text-ink-secondary">
        Last checked 2026-09-15. Every route named below moves every few
        months — a menu gets renamed, a button moves a screen over. The
        provider&rsquo;s own linked page is the authoritative one; this page
        only says what to look for and what this software does with it once
        you have it.
      </p>

      <div className="mt-8 border-t border-line-quiet pt-8">
        <h2 className="font-display text-2xl font-semibold text-ink-strong">
          Photographs with their location
        </h2>
        <div className="mt-2">
          <EntryContent markdown={section(doc, "Photographs with their location")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
          Location history
        </h2>
        <div className="mt-2">
          <EntryContent markdown={section(doc, "Location history")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">Contacts</h2>
        <div className="mt-2">
          <EntryContent markdown={section(doc, "Contacts")} />
        </div>

        <h2 className="mt-10 font-display text-2xl font-semibold text-ink-strong">
          Bank statements, for a trip&rsquo;s costs
        </h2>
        <div className="mt-2">
          <EntryContent markdown={section(doc, "Bank statements, for a trip's costs")} />
        </div>
      </div>
    </main>
  );
}
