import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VisitorsContent from "./VisitorsContent";
import StudioPage from "@/components/studio/StudioPage";
import { isEnabled } from "@/lib/capabilities";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { visitorReport } from "@/lib/analytics/report";
import { RETENTION_DAYS } from "@/lib/analytics/record";
import { requestLocale, translateIn } from "@/lib/locales";
import { getTrips } from "@/lib/trips";
import { getUser } from "@/lib/users";

/**
 * Who is reading this journal — B566, moved whole from `/[user]/me/analytics`
 * to `/[user]/studio/visitors` by B2017 so all journal administration lives
 * in the studio; `/[user]/me/analytics` is now a permanent redirect here.
 *
 * `requireStudioOwner` (`lib/studio/pageGate.ts`) replaces the page's own
 * `isOwner` check — same underlying cookie resolution, and the same gate
 * every other `/[user]/studio/*` page uses. It still answers `notFound()`
 * rather than a 403, for the reason this page's own history already gives:
 * a refusal that distinguishes "not yours" from "not there" tells a
 * stranger the page exists and that this journal counts its readers.
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

export default async function StudioVisitorsPage({
  params,
  searchParams,
}: PageProps<"/[user]/studio/visitors">) {
  const { user } = await params;
  if (!getUser(user)) notFound();
  await requireStudioOwner(user);

  const locale = await requestLocale();
  const shell = {
    username: user,
    group: "journal" as const,
    title: translateIn(locale, "studio.hub.item.visitors.title"),
    lede: translateIn(locale, "visitors.subtitle"),
    // A chart: a day per bar across up to 90 days, and a trip table beside it.
    width: "wide" as const,
  };

  // Switched off: the owner sees why (B2068), never a 404 — the owner check
  // above still comes first, so a stranger learns nothing either way.
  if (!isEnabled("analytics", user)) {
    return (
      <StudioPage
        {...shell}
        capabilityOff={{
          banner: translateIn(locale, "studio.visitors.off.banner"),
          body: translateIn(locale, "studio.visitors.off.body"),
        }}
      />
    );
  }

  const days = windowFrom((await searchParams).days);
  const report = await visitorReport(user, days);
  // On, but null: the database it needs is unreachable. "Nobody read it" and
  // "we cannot tell you" must not render as the same page (B267).
  if (!report) return <StudioPage {...shell} error={translateIn(locale, "studio.visitors.unavailable")} />;

  // Trip ids become trip titles here rather than in the query — the report
  // layer talks to the database and the titles are on disk, and a join across
  // that boundary does not exist. A trip that has since been deleted keeps its
  // id as its label, which is the honest answer for a row about something that
  // is gone.
  const titles = new Map(getTrips(user).map((t) => [t.id, t.title]));

  return (
    <StudioPage {...shell}>
      <VisitorsContent
        report={{
          ...report,
          trips: report.trips.map((t) => ({ ...t, label: titles.get(t.id) ?? t.id })),
        }}
        base={`/${user}`}
        windows={[...WINDOWS]}
        retentionDays={RETENTION_DAYS}
      />
    </StudioPage>
  );
}
