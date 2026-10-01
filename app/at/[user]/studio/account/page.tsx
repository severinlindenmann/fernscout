import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AccountPageContent, {
  type PlanPanel,
  type StoragePanel,
} from "../../account/AccountPageContent";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { requestLocale, translateIn } from "@/lib/locales";
import { listAllOrders } from "@paid/printOrder/lib/orders";
import { cleanupPlan } from "@/lib/storageCleanup";
import { formatBytes, storageBreakdown, storageFor, worthShowing } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";
import { planSummaryFor } from "@/lib/billingSummary";

/**
 * Storage and plan — B821, moved whole here from `/[user]/account` by
 * B2016, so the studio is the one place an owner administers the journal.
 * `AccountPageContent` is unchanged; only the gate and the address move
 * (`lib/studio/pageGate.ts`'s `requireStudioOwner`, the same one every other
 * `/[user]/studio/*` page uses). `notFound()` rather than a 403 — the same
 * choice `/me/analytics` (B566) made and for the same reason: a refusal that
 * told a stranger "this exists but is not yours" would say more than the
 * page is allowed to.
 *
 * `app/at/[user]/account/page.tsx` is now a permanent redirect here, so an old
 * bookmark or a link the photobook/postcard flows already sent (`#buy`)
 * keeps working — the browser keeps that hash across the redirect on its
 * own.
 */

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/studio/account">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "account.title"),
    robots: { index: false, follow: false },
  };
}

export default async function StudioAccountPage({ params }: PageProps<"/at/[user]/studio/account">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const journal = getUser(user);
  if (!journal) notFound();

  /** Storage — B664/B821. */
  let storage: StoragePanel | undefined;
  const usage = await storageFor(user);
  if (usage.limitBytes !== null) {
    const limit = usage.limitBytes;
    const reclaimable = await cleanupPlan(user, true);
    const percent = Math.round((usage.usedBytes / limit) * 100);
    storage = {
      used: formatBytes(usage.usedBytes),
      limit: formatBytes(limit),
      percent,
      // A breakdown of a kilobyte is a bar with nothing visible in it and a
      // legend of near-zero rows — B1270. The floor is in bytes, not the
      // rounded percent: a purchase raises the ceiling, and a journal that
      // then rounded to 0% lost its breakdown mid-visit (B2090).
      rows:
        worthShowing(usage.usedBytes)
          ? storageBreakdown(user)
              .filter((row) => row.bytes > 0)
              .sort((a, b) => b.bytes - a.bytes)
              .map((row) => ({
                key: row.key,
                label: row.label,
                human: formatBytes(row.bytes),
                share: Math.min(100, (row.bytes / limit) * 100),
              }))
          : [],
      reclaimable: {
        human: formatBytes(reclaimable.bytes),
        // "Free up 10 KB" is not an offer — B2090. `files` only decides
        // whether the button shows, so under the floor it reads as nothing.
        files: worthShowing(reclaimable.bytes) ? reclaimable.files : 0,
        hasStagedFiles: reclaimable.stagedFiles > 0,
      },
    };
  }

  const allOrders = await listAllOrders(user);
  const orders = { recent: allOrders.slice(0, 3), total: allOrders.length };

  // "Your plan" — B2593. Absent when `billing` is off, the same "absent, not
  // shown empty" rule `storage` already follows. `planSummaryFor` is the one
  // place this is read — `/me`'s own plan card (B2622) asks it too.
  const plan: PlanPanel | undefined = await planSummaryFor(user);

  return (
    <StudioPage username={user} group="journal" title={translateIn(await requestLocale(), "studio.hub.item.account.title")}>
      <AccountPageContent username={user} storage={storage} orders={orders} plan={plan} />
    </StudioPage>
  );
}
