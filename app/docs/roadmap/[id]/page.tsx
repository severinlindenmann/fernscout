import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DocsNav from "@/components/DocsNav";
import EntryContent from "@/components/EntryContent";
import { docsNavEntries } from "@/lib/docs";
import { getTask } from "@/lib/roadmap";
import { requestLocale } from "@/lib/locales";

/**
 * `/docs/roadmap/<id>` — one ticket, in full. B1721.
 *
 * A separate route rather than a panel on the board, for the reason the board
 * exists at all: `docs/tasks/` is 5.7 MB of bodies, and any shape that ships
 * them together ships all of them. This reads exactly the one file asked for.
 *
 * `getTask()` answers `null` for a missing id, an unparseable file *and* a
 * `type: SECURITY` ticket alike, which is why this route has one `notFound()`
 * and no branch that could tell a reader which of the three they hit.
 *
 * No `generateStaticParams`: the tree changes hourly, the ids are not known at
 * build time, and every other page under `/docs` is read fresh per request for
 * the same reason.
 */

const GITHUB = "https://github.com/severinlindenmann/fernscout/blob/main/";

const LANE_LABEL: Record<string, string> = {
  backlog: "Backlog",
  open: "Backlog",
  "in-development": "In development",
  testing: "Testing",
  completed: "Done",
};

export async function generateMetadata({ params }: PageProps<"/docs/roadmap/[id]">): Promise<Metadata> {
  const { id } = await params;
  const task = getTask(id);
  return task ? { title: `${task.id} — ${task.title}` } : { title: "Roadmap" };
}

export default async function RoadmapTaskPage({ params }: PageProps<"/docs/roadmap/[id]">) {
  const locale = await requestLocale();
  const { id } = await params;
  const task = getTask(id);
  if (!task) notFound();

  // Every task file opens with `# <id> — <title>`, which this page has
  // already drawn as its own `h1`. Rendering the body verbatim prints the
  // title twice, once in each typeface.
  const body = task.body.replace(/^#\s.*(\n|$)/, "").trim();

  const facts: [string, string][] = [
    ["lane", LANE_LABEL[task.lane] ?? task.lane],
    ["type", task.type.toLowerCase()],
    ["priority", task.priority],
    ["size", task.complexity],
    ["area", task.area],
    ["date", task.date.slice(0, 10)],
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <Link
        href="/docs/roadmap"
        className="font-mono text-sm text-ink-muted underline underline-offset-4 hover:text-ink-strong
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        ← Roadmap
      </Link>

      <p className="mt-6 font-mono text-sm text-ink-muted">{task.id}</p>
      <h1 className="mt-1 font-display text-2xl font-semibold text-ink-strong sm:text-3xl">{task.title}</h1>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <span
              key={label}
              className="rounded-full bg-surface-subtle px-2 py-0.5 font-mono text-xs text-ink-muted"
            >
              {label} · {value}
            </span>
          ))}
      </div>

      <div className="mt-8">
        {body ? (
          <EntryContent markdown={body} />
        ) : (
          <p className="rounded-xl border border-dashed border-line-quiet bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
            This ticket has a title and nothing else written under it yet.
          </p>
        )}
      </div>

      <p className="mt-10 border-t border-line-quiet pt-4 font-mono text-sm">
        <a
          href={`${GITHUB}${task.path}`}
          className="text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-2 hover:decoration-coral-600"
        >
          Read this file on GitHub ↗
        </a>
      </p>

      <div className="mt-10">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/roadmap" />
      </div>
    </main>
  );
}
