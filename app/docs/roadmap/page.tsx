import type { Metadata } from "next";
import DocsNav from "@/components/DocsNav";
import { docsNavEntries } from "@/lib/docs";
import { getRoadmap } from "@/lib/roadmap";
import { requestLocale } from "@/lib/locales";

export const metadata: Metadata = { title: "Roadmap" };

/** Flow order, same as `scripts/tasks.mjs`'s `LANES` — a person reads it top
 * to bottom the same way work actually moves. */
const LANE_LABEL: Record<string, string> = {
  backlog: "Backlog",
  open: "Open",
  "in-development": "In development",
  testing: "Testing",
  completed: "Completed",
};

/** Badge classes per priority — reusing the API page's palette rather than
 * inventing a second one. */
const PRIORITY_STYLE: Record<string, string> = {
  high: "bg-coral-600 text-white",
  medium: "bg-yellow-400 text-yellow-950",
  low: "border border-navy-700 text-navy-900",
};

/**
 * `/docs/roadmap` — everything `docs/tasks/` currently says, for a reader who
 * has no checkout to open. B675.
 *
 * Metadata only: id, title, type, priority, grouped by lane — `INDEX.md`'s
 * own shape, rendered as HTML. No bodies and no per-task page, because a body
 * names files and several are security findings written in prose. See
 * `lib/roadmap.ts` for how `type: SECURITY` is kept off this page regardless
 * of which lane it has moved to.
 *
 * Reads `docs/tasks/` fresh on every request, the same as every other page
 * under `/docs` reads `README.md` — an edit reaches this page with no build
 * step. Renders as an empty page rather than failing when `docs/tasks/` is
 * absent, which is every deploy that is not this repository's own checkout.
 */
export default async function RoadmapPage() {
  const locale = await requestLocale();
  const lanes = getRoadmap();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-navy-900 sm:text-4xl">Roadmap</h1>
      <p className="mt-3 text-lg leading-relaxed text-navy-700">
        What this software is built on top of: every task tracked in this
        checkout&apos;s own `docs/tasks/`, read fresh off the files and grouped by
        the lane it sits in — the lane is the status; there is no separate
        field for it. Titles only, no bodies.
      </p>

      <div className="mt-6">
        <DocsNav locale={locale} entries={docsNavEntries()} current="/docs/roadmap" />
      </div>

      <div className="mt-10 space-y-10">
        {lanes.map(({ lane, tasks }) => (
          <section key={lane}>
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {LANE_LABEL[lane] ?? lane}{" "}
              <span className="text-base font-normal text-navy-500">({tasks.length})</span>
            </h2>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-navy-500">Nothing here.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-2xl border border-navy-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-navy-200 bg-cream-100 text-xs font-bold uppercase text-navy-500">
                      <th className="px-4 py-2">Id</th>
                      <th className="px-4 py-2">Title</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id} className="border-b border-navy-100 last:border-0">
                        <td className="whitespace-nowrap px-4 py-2 font-mono text-navy-500">{task.id}</td>
                        <td className="px-4 py-2 text-navy-900">{task.title}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-navy-700">{task.type}</td>
                        <td className="whitespace-nowrap px-4 py-2">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase ${
                              PRIORITY_STYLE[task.priority] ?? "bg-navy-200 text-navy-900"
                            }`}
                          >
                            {task.priority}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
