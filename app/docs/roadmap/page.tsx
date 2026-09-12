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

/** Lanes long enough that a reader scanning for what's being built wants them
 * closed by default — everything still on disk in `<details>`, one click
 * away. */
const COLLAPSED_LANES = new Set(["backlog", "completed"]);

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
 * Metadata only: id, title, type, priority, area, grouped by lane —
 * `INDEX.md`'s own shape, rendered as HTML. No bodies and no per-task page,
 * because a body names files and several are security findings written in
 * prose. See `lib/roadmap.ts` for how `type: SECURITY` is kept off this page
 * regardless of which lane it has moved to.
 *
 * Reads `docs/tasks/` fresh on every request, the same as every other page
 * under `/docs` reads `README.md` — an edit reaches this page with no build
 * step. Renders as an empty page rather than failing when `docs/tasks/` is
 * absent, which is every deploy that is not this repository's own checkout.
 *
 * Default view is `type: FEATURE` only — what a reader came here for, at
 * ~1,500 tasks across five lanes. The "show everything" toggle is a plain
 * checkbox with no JavaScript: `:has()` on the wrapping `<div>` shows the
 * non-`FEATURE` rows and the `Type` column, which stays a server component
 * (B1546 — no client-side state for a filter this simple).
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

      <div id="roadmap" className="mt-10">
        <style>{`
          #roadmap tr[data-type]:not([data-type="FEATURE"]),
          #roadmap col[data-type-col],
          #roadmap th[data-type-col],
          #roadmap td[data-type-col] { display: none; }
          #roadmap:has(#roadmap-show-all:checked) tr[data-type]:not([data-type="FEATURE"]),
          #roadmap:has(#roadmap-show-all:checked) col[data-type-col],
          #roadmap:has(#roadmap-show-all:checked) th[data-type-col],
          #roadmap:has(#roadmap-show-all:checked) td[data-type-col] { display: revert; }
          #roadmap [data-context] { display: none; }
          #roadmap:has(#roadmap-show-all:checked) tr[data-type]:not([data-type="FEATURE"]) [data-context] { display: block; }
        `}</style>

        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-navy-700">
          <input id="roadmap-show-all" type="checkbox" className="h-4 w-4 accent-coral-600" />
          Also show issues, chores, ops and docs tasks
        </label>

        <div className="mt-6 space-y-8">
          {lanes.map(({ lane, tasks }) => (
            <details key={lane} open={!COLLAPSED_LANES.has(lane)}>
              <summary className="cursor-pointer select-none font-display text-xl font-semibold text-navy-900">
                {LANE_LABEL[lane] ?? lane}{" "}
                <span className="text-base font-normal text-navy-500">({tasks.length})</span>
              </summary>
              {tasks.length === 0 ? (
                <p className="mt-2 text-sm text-navy-500">Nothing here.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-2xl border border-navy-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-navy-200 bg-cream-100 font-bold uppercase text-navy-500">
                        <th className="px-3 py-1.5">Id</th>
                        <th className="px-3 py-1.5">Title</th>
                        <th data-type-col className="px-3 py-1.5">
                          Type
                        </th>
                        <th className="px-3 py-1.5">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((task) => (
                        <tr
                          key={task.id}
                          data-type={task.type}
                          className="border-b border-navy-100 last:border-0"
                        >
                          <td className="whitespace-nowrap px-3 py-1 font-mono text-navy-500">{task.id}</td>
                          <td className="px-3 py-1 text-navy-900">
                            {task.title}
                            {task.area && (
                              <div data-context className="text-navy-500">
                                {task.area}
                              </div>
                            )}
                          </td>
                          <td data-type-col className="whitespace-nowrap px-3 py-1 text-navy-700">
                            {task.type}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[0.65rem] font-bold uppercase ${
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
            </details>
          ))}
        </div>
      </div>
    </main>
  );
}
