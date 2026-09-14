import type { Metadata } from "next";
import Link from "next/link";
import DocsNav from "@/components/DocsNav";
import { docsNavEntries } from "@/lib/docs";
import {
  getTasks,
  type Complexity,
  type Lane,
  type RoadmapTask,
} from "@/lib/roadmap";
import { requestLocale } from "@/lib/locales";

export const metadata: Metadata = { title: "Roadmap" };

/**
 * `/docs/roadmap` — what is being built, as a board. B675, redrawn by B1721.
 *
 * B675 rendered all ~1,600 tasks as table rows and hid the non-`FEATURE` ones
 * with a `:has()` rule behind an unchecked checkbox. The page was 2.5 MB, and
 * a reader downloaded 870 bug reports to read 417 features. Four columns of
 * ten cards, then a search, is the same information at a fiftieth of the
 * weight.
 *
 * **Size is the visual axis.** Every task file carries
 * `complexity: low | medium | high` and B675's page did not read it, so a
 * fortnight's work and an afternoon's drew identically. A card's type, stripe
 * and count of waymark lozenges now come from that field alone — the first
 * question anybody asks of a roadmap is which of these is big.
 *
 * **Every link on this page is `prefetch={false}`, and that is not a
 * micro-optimisation.** Next prefetches a `<Link>` when it enters the
 * viewport, and each prefetch here is a *server render* that walks all ~1,600
 * task files. Measured on the live instance at the first deploy of this page:
 * one visit to the board fetched 103 distinct ticket pages in 247 requests,
 * because there are a hundred links on it and scrolling past a row is enough.
 * Nobody reads a hundred tickets; they click one. Any link added below must
 * carry this too.
 *
 * **Still no JavaScript.** The search is a `GET` form and the filters are
 * links, so the whole page stays a server component and the list that reaches
 * the browser is the filtered one rather than all 1,600 rows waiting for a
 * client-side `.includes()`. That is also what keeps the page small: the
 * weight B675 shipped was the rows it had already decided to hide.
 *
 * Reads `docs/tasks/` fresh on every request, the same as every other page
 * under `/docs` reads `README.md` — an edit reaches this page with no build
 * step. Renders empty rather than failing when `docs/tasks/` is absent, which
 * is every deploy that is not this repository's own checkout.
 *
 * English only, like `/docs/api` and the rest of the technical pages — see
 * `lib/docs.ts`, which explains why the guides are the translated ones.
 */

/** The Wanderweg lozenge, `docs/branding/BRAND.md` §2, repeated once per step
 * of `complexity`. The mark is the brand's own, which is why size is drawn
 * with it rather than with a number of dots. */
function Waymark({ steps }: { steps: number }) {
  return (
    <svg
      viewBox={`0 0 ${steps * 13 + 2} 15`}
      aria-hidden
      className="h-[9px] shrink-0 fill-yellow-400 stroke-yellow-600"
      strokeWidth={1.1}
    >
      {Array.from({ length: steps }, (_, i) => (
        <path
          key={i}
          d={`M${i * 13 + 8} 1.5 L${i * 13 + 14} 7.5 L${i * 13 + 8} 13.5 L${i * 13 + 2} 7.5 Z`}
        />
      ))}
    </svg>
  );
}

const STEPS: Record<Complexity, number> = { high: 3, medium: 2, low: 1, "": 1 };
const SIZE_LABEL: Record<Complexity, string> = {
  high: "big — weeks",
  medium: "medium — days",
  low: "small — hours",
  "": "unsized",
};

/** The four things a reader wants to know, which are not quite the five lanes:
 * `open/` is a task somebody approved but nobody started, and the difference
 * between that and `backlog/` is our review gate rather than the reader's
 * question. */
const COLUMNS = [
  {
    label: "Backlog",
    lanes: ["backlog", "open"],
    note: "Wanted, not started — highest priority first",
    dot: "bg-ink-faint",
  },
  {
    label: "In development",
    lanes: ["in-development"],
    note: "Being written right now",
    dot: "bg-green-500",
  },
  {
    label: "Testing",
    lanes: ["testing"],
    note: "Built, waiting to be checked",
    dot: "bg-sky-400",
  },
  {
    label: "Done",
    lanes: ["completed"],
    note: "Live here — most recent first",
    dot: "bg-yellow-600",
  },
] as const satisfies readonly {
  label: string;
  lanes: readonly Lane[];
  note: string;
  dot: string;
}[];

type ColumnLabel = (typeof COLUMNS)[number]["label"];

const PER_COLUMN = 10;
/** The list below the board is a search result, not an archive. Sixty rows is
 * more than anybody reads and small enough that the page stays under a
 * hundred kilobytes with every filter cleared. */
const MAX_ROWS = 60;

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const rank = (t: RoadmapTask) => PRIORITY_RANK[t.priority] ?? 3;

const TYPES = ["FEATURE", "ISSUE", "CHORE", "DOCS", "OPS"] as const;

function columnOf(task: RoadmapTask): ColumnLabel {
  return (
    COLUMNS.find((c) => (c.lanes as readonly string[]).includes(task.lane)) ??
    COLUMNS[0]
  ).label;
}

function Card({ task }: { task: RoadmapTask }) {
  const steps = STEPS[task.complexity];
  const areas = task.area
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const tags =
    steps === 3 ? areas.slice(0, 3) : steps === 2 ? areas.slice(0, 1) : [];
  const stripe =
    steps === 3
      ? "border-l-yellow-600"
      : steps === 2
        ? "border-l-yellow-400"
        : "border-l-line-quiet";
  return (
    <li>
      <Link
        href={`/docs/roadmap/${task.id}`}
        prefetch={false}
        className={`flex flex-col gap-1.5 rounded-xl border border-line-quiet border-l-4 bg-surface-base
                    ${stripe} ${steps === 3 ? "px-3 py-3" : "px-3 py-2"}
                    transition-colors hover:border-yellow-400 focus-visible:outline-2
                    focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[0.68rem] text-ink-muted">
            {task.id}
          </span>
          {task.lane === "completed" && task.date && (
            <span className="font-mono text-[0.66rem] tabular-nums text-ink-muted">
              {task.date.slice(0, 10)}
            </span>
          )}
          <span
            className="ml-auto flex items-center"
            title={SIZE_LABEL[task.complexity]}
          >
            <Waymark steps={steps} />
          </span>
        </span>
        <span
          className={
            steps === 3
              ? "font-display text-[0.98rem] font-medium leading-tight text-ink-strong"
              : steps === 2
                ? "text-[0.86rem] leading-snug text-ink-strong"
                : "text-[0.8rem] leading-snug text-ink-body"
          }
        >
          {task.title}
        </span>
        {tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tags.map((area) => (
              <span
                key={area}
                className="rounded-full bg-surface-subtle px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-muted"
              >
                {area}
              </span>
            ))}
          </span>
        )}
      </Link>
    </li>
  );
}

/** The thin bar under a column head: what that lane is made of, by size. It is
 * the one thing on the board that answers "is the backlog big work or small
 * work" without counting cards. */
function SizeMix({ tasks }: { tasks: RoadmapTask[] }) {
  const fill: Record<string, string> = {
    high: "bg-yellow-600",
    medium: "bg-yellow-400",
    low: "bg-surface-selected",
  };
  return (
    <div
      className="flex h-[5px] gap-[2px] overflow-hidden rounded-full bg-surface-subtle"
      aria-hidden
    >
      {(["high", "medium", "low"] as const).map((size) => {
        const n = tasks.filter((t) => t.complexity === size).length;
        return n === 0 ? null : (
          <span key={size} className={fill[size]} style={{ flex: n }} />
        );
      })}
    </div>
  );
}

export default async function RoadmapPage({
  searchParams,
}: PageProps<"/docs/roadmap">) {
  const locale = await requestLocale();
  const asked = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(asked.q).trim();
  const lane = COLUMNS.some((c) => c.label === one(asked.lane))
    ? (one(asked.lane) as ColumnLabel)
    : "";
  const type = (TYPES as readonly string[]).includes(one(asked.type))
    ? one(asked.type)
    : "";

  const tasks = getTasks();
  const features = tasks.filter((t) => t.type === "FEATURE");

  const needle = q.toLowerCase();
  // Newest id first. Ascending puts the oldest sixty tickets at the top of an
  // unfiltered search — which in this repository means a screenful of
  // `backlog/superseded/`, the worst possible sample of what is being built.
  const matches = [...tasks]
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
    .filter(
      (t) =>
        (!lane || columnOf(t) === lane) &&
        (!type || t.type === type) &&
        (!needle ||
          `${t.id} ${t.title} ${t.area} ${t.type}`
            .toLowerCase()
            .includes(needle)),
    );

  const href = (next: { lane?: string; type?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const l = next.lane ?? lane;
    const ty = next.type ?? type;
    if (l) p.set("lane", l);
    if (ty) p.set("type", ty);
    const s = p.toString();
    return `/docs/roadmap${s ? `?${s}` : ""}#all`;
  };

  const chip = (active: boolean) =>
    `inline-flex min-h-8 items-center rounded-full border px-2.5 font-mono text-[0.7rem] transition-colors
     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
       active
         ? "border-yellow-600 bg-yellow-400 text-yellow-950"
         : "border-line-quiet text-ink-muted hover:border-yellow-400"
     }`;

  // What the board draws, so the headline count and the columns agree.
  const ahead = features.filter((t) => t.lane !== "completed" && !t.shelved);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
      <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">
        Roadmap
      </h1>
      <p className="mt-3 max-w-[40em] text-lg leading-relaxed text-ink-body">
        Where every Fernscout feature stands, read straight off this
        checkout&apos;s own task files. A card moves left to right: wanted,
        written, checked, live. Its stripe and its waymarks say how big it is —
        three marks is weeks of work, one is an afternoon. Each column shows
        ten; the rest are in the search below. Security work is never listed
        here.
      </p>

      <div className="mt-6">
        <DocsNav
          locale={locale}
          entries={docsNavEntries()}
          current="/docs/roadmap"
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-dashed border-line-quiet pt-4 text-sm text-ink-muted">
        {(["high", "medium", "low"] as const).map((size) => (
          <span key={size} className="flex items-center gap-1.5">
            <Waymark steps={STEPS[size]} />
            {SIZE_LABEL[size]}
          </span>
        ))}
        <span className="sm:ml-auto">
          <b className="font-mono text-ink-body">{ahead.length}</b> features
          ahead,{" "}
          <b className="font-mono text-ink-body">
            {ahead.filter((t) => t.complexity === "high").length}
          </b>{" "}
          of them big
        </span>
      </div>

      <div className="mt-8 grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const all = tasks.filter(
            (t) =>
              t.type === "FEATURE" &&
              !t.shelved &&
              (column.lanes as readonly string[]).includes(t.lane),
          );
          const sorted =
            column.label === "Done"
              ? [...all].sort((a, b) => b.date.localeCompare(a.date))
              : [...all].sort(
                  (a, b) =>
                    rank(a) - rank(b) ||
                    STEPS[b.complexity] - STEPS[a.complexity] ||
                    a.id.localeCompare(b.id, undefined, { numeric: true }),
                );
          return (
            <section
              key={column.label}
              aria-label={column.label}
              className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line-quiet bg-surface-subtle p-3"
            >
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink-strong">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${column.dot}`}
                  aria-hidden
                />
                {column.label}
                <span className="ml-auto rounded-full bg-surface-selected px-1.5 font-mono text-xs tabular-nums font-normal text-ink-muted">
                  {all.length}
                </span>
              </h2>
              <p className="text-xs text-ink-muted">{column.note}</p>
              <SizeMix tasks={all} />
              <ul className="mt-1 flex flex-col gap-1.5">
                {sorted.slice(0, PER_COLUMN).map((task) => (
                  <Card key={task.id} task={task} />
                ))}
                {sorted.length === 0 && (
                  <li className="py-2 text-sm text-ink-muted">Nothing here.</li>
                )}
              </ul>
              {all.length > PER_COLUMN && (
                <Link
                  href={href({ lane: column.label, type: "FEATURE" })}
                  prefetch={false}
                  className="font-mono text-xs text-ink-muted underline underline-offset-4 hover:text-ink-strong
                             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  + {all.length - PER_COLUMN} more in the search ↓
                </Link>
              )}
            </section>
          );
        })}
      </div>

      <section id="all" className="mt-12 scroll-mt-6">
        <h2 className="font-display text-xl font-semibold text-ink-strong">
          Search all {tasks.length} tickets
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Every ticket in this checkout, whatever its type or lane. Click one to
          read it in full.
        </p>

        <form
          method="get"
          action="/docs/roadmap#all"
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <label htmlFor="roadmap-q" className="sr-only">
            Search tickets
          </label>
          <input
            id="roadmap-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search titles, ids and areas — try “postcard” or “B1585”"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-quiet bg-surface-base px-3
                       text-ink-strong placeholder:text-ink-muted focus-visible:outline-2
                       focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          />
          {lane && <input type="hidden" name="lane" value={lane} />}
          {type && <input type="hidden" name="type" value={type} />}
          <button
            type="submit"
            className="min-h-11 rounded-xl bg-yellow-400 px-4 font-semibold text-yellow-950
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            Search
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Link href={href({ lane: "" })} prefetch={false} className={chip(!lane)}>
            All lanes
          </Link>
          {COLUMNS.map((c) => (
            <Link
              key={c.label}
              href={href({ lane: c.label })}
              prefetch={false}
              className={chip(lane === c.label)}
            >
              {c.label}
            </Link>
          ))}
          <span className="w-3" aria-hidden />
          <Link href={href({ type: "" })} prefetch={false} className={chip(!type)}>
            All types
          </Link>
          {TYPES.map((t) => (
            <Link
              key={t}
              href={href({ type: t })}
              prefetch={false}
              className={chip(type === t)}
            >
              {t.toLowerCase()}
            </Link>
          ))}
        </div>

        <p className="mt-3 font-mono text-xs text-ink-muted">
          {matches.length} of {tasks.length}
          {matches.length > MAX_ROWS &&
            ` — showing the first ${MAX_ROWS}, narrow the search to see the rest`}
        </p>

        <ul className="mt-2 divide-y divide-line-faint overflow-hidden rounded-2xl border border-line-quiet">
          {matches.slice(0, MAX_ROWS).map((task) => (
            <li key={task.id}>
              <Link
                href={`/docs/roadmap/${task.id}`}
                prefetch={false}
                className="flex min-h-11 items-center gap-2.5 bg-surface-base px-3 py-2 text-sm
                           hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2
                           focus-visible:outline-blue-500"
              >
                <span className="font-mono text-[0.68rem] text-ink-muted">
                  {task.id}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-strong">
                  {task.title}
                </span>
                <span className="hidden shrink-0 rounded bg-surface-subtle px-1.5 font-mono text-[0.63rem] uppercase tracking-wide text-ink-muted sm:inline">
                  {task.shelved ? "shelved" : columnOf(task)}
                </span>
                <span className="hidden shrink-0 rounded bg-surface-subtle px-1.5 font-mono text-[0.63rem] uppercase tracking-wide text-ink-muted md:inline">
                  {task.type}
                </span>
                <Waymark steps={STEPS[task.complexity]} />
              </Link>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="bg-surface-base px-3 py-4 text-sm text-ink-muted">
              Nothing matches that. Try a shorter word, or clear the filters
              above.
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}
