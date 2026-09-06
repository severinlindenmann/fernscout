import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VisitorsContent from "./VisitorsContent";
import { visitorReport } from "@/lib/analytics/report";
import { RETENTION_DAYS } from "@/lib/analytics/record";
import { isOwner } from "@/lib/contacts/session";
import { requestLocale, translateIn } from "@/lib/locales";
import { getTrips } from "@/lib/trips";
import { getUser } from "@/lib/users";

/**
 * Who is reading this journal — B566.
 *
 * ## Why it is here and not at `/<user>/analytics`
 *
 * That URL is taken, by the trip hub of costs and weather (B557). The two are
 * different in the way that matters most for a URL: `/analytics` is an
 * analysis **of the trip**, shown to its readers, and this is an analysis **of
 * the readers**, shown to one person. Putting the second under `/me` — which
 * is already the reader's own area, already `force-dynamic`, already noindex —
 * says which it is by where it is.
 *
 * ## The gate, and why it answers 404
 *
 * Owner only, and `notFound()` rather than a 403: a refusal that distinguishes
 * "not yours" from "not there" tells a stranger the page exists and that this
 * journal counts its readers. There is nothing sensitive behind it about any
 * individual — that is the point of the whole design — but who is reading a
 * private trip is the owner's business and not the internet's.
 *
 * Buddies and trip people are deliberately not let in yet; `trip_id` is on
 * every row so the trip-scoped query is a `where` clause when somebody asks
 * for it, rather than a migration. See B566's "Not doing".
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translateIn(await requestLocale(), "visitors.title"),
    robots: { index: false, follow: false },
  };
}

/** 7, 30 or 90 — and never anything else. The window is a `?days=` parameter,
 * so it is reader input and goes nowhere near the query without being one of
 * these three; `RETENTION_DAYS` is the ceiling because a longer window would
 * report a drop that is only the sweep. */
const WINDOWS = [7, 30, 90] as const;

function windowFrom(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (WINDOWS as readonly number[]).includes(n) ? n : 30;
}

export default async function VisitorsPage({
  params,
  searchParams,
}: PageProps<"/[user]/me/analytics">) {
  const { user } = await params;
  if (!getUser(user)) notFound();
  if (!(await isOwner(user))) notFound();

  const days = windowFrom((await searchParams).days);
  const report = await visitorReport(user, days);
  // Null is the capability being off, or its database being unreachable.
  // Absent rather than broken: no page at all, exactly as a journal with
  // costs off has no costs page. B165, B267.
  if (!report) notFound();

  // Trip ids become trip titles here rather than in the query — the report
  // layer talks to the database and the titles are on disk, and a join across
  // that boundary does not exist. A trip that has since been deleted keeps its
  // id as its label, which is the honest answer for a row about something that
  // is gone.
  const titles = new Map(getTrips(user).map((t) => [t.id, t.title]));

  return (
    <VisitorsContent
      report={{
        ...report,
        trips: report.trips.map((t) => ({ ...t, label: titles.get(t.id) ?? t.id })),
      }}
      base={`/${user}`}
      windows={[...WINDOWS]}
      retentionDays={RETENTION_DAYS}
    />
  );
}
