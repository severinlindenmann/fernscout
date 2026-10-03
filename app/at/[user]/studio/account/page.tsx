import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AccountPageContent, {
  type PlanOptionFacts,
  type PlanPanel,
  type StoragePanel,
} from "../../account/AccountPageContent";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { listStaged } from "@/lib/inbox";
import { requestLocale, translateIn } from "@/lib/locales";
import { listAllOrders } from "@paid/printOrder/lib/orders";
import { cleanupPlan } from "@/lib/storageCleanup";
import { formatBytes, storageBreakdown, storageFor, worthShowing } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";
import { planSummaryFor } from "@/lib/billingSummary";
import { PLANS } from "@paid/billing/lib/plans";

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
  const locale = await requestLocale();
  // B1392 — the legend's own labels go through t(); a trip keeps its title.
  const rowLabel: Record<string, string> = {
    inbox: translateIn(locale, "me.storageRow.inbox"),
    photobooks: translateIn(locale, "me.storageRow.photobooks"),
    postcards: translateIn(locale, "me.storageRow.postcards"),
    other: translateIn(locale, "me.storageRow.other"),
  };
  const stagedFiles = listStaged(user);
  const usage = await storageFor(user);
  if (usage.limitBytes !== null) {
    const limit = usage.limitBytes;
    const reclaimable = await cleanupPlan(user);
    const percent = Math.round((usage.usedBytes / limit) * 100);
    storage = {
      used: formatBytes(usage.usedBytes),
      limit: formatBytes(limit),
      percent,
      // How far over, in words — only ever set once `usedBytes` has actually
      // passed `limit` — B2636's "X GB über dem Limit".
      excess: usage.usedBytes > limit ? formatBytes(usage.usedBytes - limit) : null,
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
                label: rowLabel[row.key] ?? row.label,
                human: formatBytes(row.bytes),
                share: Math.min(100, (row.bytes / limit) * 100),
              }))
          : [],
      // Shown whenever anything is staged, whatever the cleanup floor says.
      staged:
        stagedFiles.length > 0
          ? {
              human: formatBytes(stagedFiles.reduce((n, f) => n + f.bytes, 0)),
              files: stagedFiles.map((f) => ({ id: f.id, name: f.name, human: formatBytes(f.bytes), day: f.day })),
            }
          : undefined,
      reclaimable: {
        human: formatBytes(reclaimable.bytes),
        // "Free up 10 KB" is not an offer — B2090. `files` only decides
        // whether the button shows, so under the floor it reads as nothing.
        files: worthShowing(reclaimable.bytes) ? reclaimable.files : 0,
      },
    };
  }

  const allOrders = await listAllOrders(user);
  const orders = { recent: allOrders.slice(0, 3), total: allOrders.length };

  // "Your plan" — B2593. Absent when `billing` is off, the same "absent, not
  // shown empty" rule `storage` already follows. `planSummaryFor` is the one
  // place this is read — `/me`'s own plan card (B2622) asks it too.
  const plan: PlanPanel | undefined = await planSummaryFor(user);

  // The two buy tiles' own numbers — B2638. Read here, not by
  // `AccountPageContent` (a client component): see that file's own `chf()`
  // comment for why `@paid/billing/lib/plans` cannot cross into its bundle.
  const planOptions: PlanOptionFacts | undefined = plan
    ? {
        plus: {
          priceChf: PLANS.plus.priceChf,
          aiDays: PLANS.plus.aiDays,
          storageGb: PLANS.plus.storageGb,
          includedPostcards: PLANS.plus.includedPostcards,
        },
        pass: {
          priceChf: PLANS.tripPass.priceChf,
          days: PLANS.tripPass.days,
          aiDays: PLANS.tripPass.aiDays,
          storageGb: PLANS.tripPass.storageGb,
          includedPostcards: PLANS.tripPass.includedPostcards,
          appUpgradeVoucherRappen: PLANS.tripPass.appUpgradeVoucherRappen,
        },
      }
    : undefined;

  return (
    <StudioPage username={user} group="journal" title={translateIn(await requestLocale(), "studio.hub.item.account.title")}>
      <AccountPageContent username={user} storage={storage} orders={orders} plan={plan} planOptions={planOptions} />
    </StudioPage>
  );
}
