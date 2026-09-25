import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AccountPageContent, {
  type PaymentPanel,
  type StoragePanel,
} from "../../account/AccountPageContent";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { optedInCounts, listContacts } from "@/lib/contacts";
import { getOwnerTel } from "@/lib/ownerTel";
import { balanceOf, creditsEnabled, spentByReason } from "@/lib/credits";
import { formatChf } from "@/lib/creditsFormat";
import { EXTRA_STORAGE_CREDITS, POSTCARD_CREDITS } from "@paid/credits/lib/credits/pricing";
import { isEnabled } from "@/lib/capabilities";
import { listPayments } from "@paid/credits/lib/payments";
import { requestLocale, translateIn } from "@/lib/locales";
import { listAllOrders } from "@paid/printOrder/lib/orders";
import { cleanupPlan } from "@/lib/storageCleanup";
import { formatBytes, storageBreakdown, storageFor, worthShowing } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";
import { stripeEnabled, stripeMode } from "@paid/credits/lib/stripe";

/**
 * Credits and storage — B821, moved whole here from `/[user]/account` by
 * B2016, so the studio is the one place an owner administers the journal.
 * `AccountPageContent` is unchanged; only the gate and the address move
 * (`lib/studio/pageGate.ts`'s `requireStudioOwner`, the same one every other
 * `/[user]/studio/*` page uses). `notFound()` rather than a 403 — the same
 * choice `/me/analytics` (B566) made and for the same reason: a refusal that
 * told a stranger "this exists but is not yours" would say more than the
 * page is allowed to.
 *
 * `app/[user]/account/page.tsx` is now a permanent redirect here, so an old
 * bookmark or a link the photobook/postcard flows already sent (`#buy`)
 * keeps working — the browser keeps that hash across the redirect on its
 * own.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/studio/account">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "account.title"),
    robots: { index: false, follow: false },
  };
}

export default async function StudioAccountPage({ params }: PageProps<"/[user]/studio/account">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const journal = getUser(user);
  if (!journal) notFound();

  /**
   * Storage — B664/B821. Outside the `balance !== null` branch below on
   * purpose: how full a journal is has nothing to do with whether this
   * instance charges for sends. Only `canBuy` depends on that.
   */
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
      // Offered whenever this instance charges at all — B1745. B1270 gated
      // this on `percent >= 90` so a near-empty journal was not sold 5 GB;
      // that also stopped an owner buying room ahead of a large import, which
      // is the case they actually have. The purchase route never had the gate.
      canBuy: creditsEnabled(),
      buyCredits: EXTRA_STORAGE_CREDITS,
    };
  }

  let payment: PaymentPanel | undefined;
  const balance = await balanceOf(user);
  if (balance !== null) {
    const counts = optedInCounts(await listContacts(user), {
      email: journal.owner.email,
      tel: (await getOwnerTel(user))?.tel ?? null,
    });
    const transactions = (await listPayments(user)).map((tx) => ({
      id: tx.id,
      credits: tx.credits,
      amount: formatChf(tx.amountRappen),
      status: tx.status,
      createdAt: tx.createdAt,
    }));
    const channelState = (name: "mail" | "whatsapp") =>
      isEnabled(name) ? journal.features[name].enabled : null;

    payment = {
      balance,
      spent: await spentByReason(user),
      transactions,
      emailRecipients: counts.email,
      whatsappRecipients: counts.whatsapp,
      channels: { mail: channelState("mail"), whatsapp: channelState("whatsapp") },
      postcardCredits: isEnabled("postcards", user) ? POSTCARD_CREDITS : null,
      cardTestMode: stripeEnabled() && stripeMode() === "test",
    };
  }

  const allOrders = await listAllOrders(user);
  const orders = { recent: allOrders.slice(0, 3), total: allOrders.length };

  return (
    <StudioPage username={user} group="journal" title={translateIn(await requestLocale(), "studio.hub.item.account.title")}>
      <AccountPageContent username={user} storage={storage} payment={payment} orders={orders} />
    </StudioPage>
  );
}
