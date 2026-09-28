import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import StatementFlow from "@/components/studio/statement/StatementFlow";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { journalCurrencies } from "@/lib/rates";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "A bank statement" — B1822, spec §7.7. `lib/statements/apply.ts` already
 * does the write; this page is the decide step the ticket names as the
 * whole gap.
 */
export default async function StudioStatementPage({ params }: PageProps<"/at/[user]/studio/statement">) {
  const { user } = await params;
  await requireStudioOwner(user);

  const trips = getTrips(user).map((t) => ({ id: t.id, title: t.title, costsPublic: t.costsVisibility === "public" }));
  const current = getCurrentTrip(user);

  return (
    <StudioPage username={user} group="bringIn" title={translateIn(await requestLocale(), "studio.statement.title")}>
      <StatementFlow
        username={user}
        trips={trips}
        defaultTripId={current?.id ?? null}
        currencies={journalCurrencies(user)}
      />
    </StudioPage>
  );
}
