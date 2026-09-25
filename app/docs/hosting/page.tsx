import type { Metadata } from "next";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries, readRepoFile, section } from "@/lib/docs";
import { requestLocale } from "@/lib/locales";
import { serverSite } from "@/lib/site";

export const metadata: Metadata = { title: "Hosting" };

/**
 * Running your own copy — B470, redrawn with the docs hub.
 *
 * Everything here is read from the repository at request time rather than
 * repeated (B23): the quick start and the day format from `README.md`, and
 * the capability tables from `docs/capabilities.md` — the file that is the
 * truth about what is off by default, so this page cannot drift from it. The
 * tables are the part a self-hoster actually needs before deciding, and they
 * used to be one click and one repository away.
 *
 * The screenshots lead, above the prose: somebody deciding whether to run
 * this wants to see what they would be running first. Served by
 * `app/docs/screenshots/[file]/route.ts`, the same files the README shows.
 *
 * English, deliberately, and the hub says so: the sources are English files
 * and the audience is somebody about to run `npm install`.
 */
const SHOTS = [
  { file: "trip-story.jpg", alt: "A trip's story page: the day-by-day path, the day card, the route map" },
  { file: "day-entry.jpg", alt: "One day's entry: the prose, photographs, the reaction row" },
  { file: "trip-map.jpg", alt: "The trip map: every stop joined by the route travelled" },
] as const;

/** The `docs/capabilities.md` sections shown here, in its own order. "The
 * rules" goes first as prose; each of the rest is a table under its heading. */
const CAPABILITY_TABLES = [
  "Reading and writing",
  "Telling readers",
  "The helper",
  "Location",
  "Hosted edition only",
] as const;

const SECTIONS = [
  { id: "run", title: "Run it locally" },
  { id: "capabilities", title: "Optional capabilities" },
  { id: "day", title: "What a day looks like" },
  { id: "deploy", title: "Deploying" },
] as const;

const H2 = "mt-12 scroll-mt-6 font-display text-2xl font-semibold text-ink-strong";
const LINK = "underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600";

export default async function HostingPage() {
  const locale = await requestLocale();
  const site = serverSite();
  const readme = readRepoFile("README.md");
  const capabilities = readRepoFile("docs/capabilities.md");
  const dayEntry = section(readme, "What a day looks like");
  const repoFile = (file: string) => (site.repository ? `${site.repository}/blob/main/${file}` : null);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">Hosting</h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-body">
        One server with Node behind Caddy, and one deploy script. Reading a
        public journal needs no database; writing and guests do. Every optional
        capability is off until you configure it.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/hosting" />
      </div>

      <ul className="mt-8 grid grid-cols-3 gap-2 sm:gap-3">
        {SHOTS.map((shot) => (
          <li key={shot.file}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/docs/screenshots/${shot.file}`}
              alt={shot.alt}
              width={1280}
              height={800}
              className="aspect-[4/3] w-full rounded-xl border border-line-quiet object-cover"
            />
          </li>
        ))}
      </ul>

      <nav aria-label="On this page" className="mt-8 border-t border-line-quiet pt-6">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-ink-body">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex min-h-11 items-center hover:text-ink-strong">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <h2 id="run" className="mt-6 scroll-mt-6 font-display text-2xl font-semibold text-ink-strong">
        Run it locally
      </h2>
      <pre className="mt-3 overflow-x-auto rounded-xl bg-overlay-strong p-4 text-sm text-overlay-ink">
        <code>{"npm install\nnpm run dev            # http://localhost:3000/example"}</code>
      </pre>
      <p className="mt-3 text-ink-body">
        SQLite locally, Postgres in production. Nothing needs a paid account to
        develop or test: mail can write <code>.eml</code> files, and every
        provider has a dry-run backend.
      </p>

      <h2 id="capabilities" className={H2}>
        Optional capabilities
      </h2>
      <div className="mt-2">
        <EntryContent markdown={section(capabilities, "The rules")} />
      </div>
      {CAPABILITY_TABLES.map((heading) => (
        <div key={heading} className="mt-6">
          <h3 className="font-display text-lg font-semibold text-ink-strong">{heading}</h3>
          <div className="mt-1">
            <EntryContent markdown={section(capabilities, heading)} />
          </div>
        </div>
      ))}
      <p className="mt-4 text-ink-body">
        A running instance explains its own state at <code>/api/health</code>.
      </p>

      <h2 id="day" className={H2}>
        What a day looks like
      </h2>
      <div className="mt-2">
        <EntryContent markdown={dayEntry} />
      </div>

      <h2 id="deploy" className={H2}>
        Deploying
      </h2>
      <p className="mt-2 text-ink-body">
        A server with backups is a longer walk than this page, and it lives in
        the repository beside the code it deploys.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          { file: "docs/runbook.md", title: "Deploying to a server", note: "docs/runbook.md, step by step" },
          { file: "docs/disaster-recovery.md", title: "Backups and recovery", note: "docs/disaster-recovery.md" },
        ].map((doc) => {
          const href = repoFile(doc.file);
          return (
            <li key={doc.file}>
              {href ? (
                <a
                  href={href}
                  className="flex min-h-11 flex-col gap-1 rounded-xl border border-line-quiet bg-surface-raised px-4 py-3
                             transition-colors hover:border-line-ink
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  <span className="font-semibold text-ink-strong">{doc.title}</span>
                  <span className="font-mono text-xs text-ink-secondary">{doc.note}</span>
                </a>
              ) : (
                <span className="flex flex-col gap-1 rounded-xl border border-line-quiet bg-surface-raised px-4 py-3">
                  <span className="font-semibold text-ink-strong">{doc.title}</span>
                  <span className="font-mono text-xs text-ink-secondary">{doc.file}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {site.repository && (
        <p className="mt-4 text-sm text-ink-secondary">
          Every capability, with what it needs, is in{" "}
          <a href={repoFile("docs/capabilities.md") ?? undefined} className={LINK}>
            docs/capabilities.md
          </a>
          .
        </p>
      )}
    </main>
  );
}
