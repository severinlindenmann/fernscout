import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AccountPageContent, {
  type PaymentPanel,
  type StoragePanel,
} from "./AccountPageContent";
import { isOwner } from "@/lib/contacts/session";
import { optedInCounts, listContacts } from "@/lib/contacts";
import { balanceOf, creditsEnabled, spentByReason } from "@/lib/credits";
import { EXTRA_STORAGE_CREDITS, formatChf, POSTCARD_CREDITS } from "@/lib/credits/pricing";
import { isEnabled } from "@/lib/capabilities";
import { listPayments } from "@/lib/payments";
import { requestLocale, translateIn } from "@/lib/locales";
import { cleanupPlan } from "@/lib/storageCleanup";
import { formatBytes, storageBreakdown, storageFor } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";

/**
 * Credits and storage — B821, moved whole from `/[user]/me`.
 *
 * Owner only, and `notFound()` rather than a 403 — the same choice
 * `/me/analytics` (B566) made and for the same reason: a refusal that told a
 * stranger "this exists but is not yours" would say more than the page is
 * allowed to.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/account">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "account.title"),
    robots: { index: false, follow: false },
  };
}

export default async function AccountPage({ params }: PageProps<"/[user]/account">) {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal) notFound();
  if (!(await isOwner(user))) notFound();

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
    storage = {
      used: formatBytes(usage.usedBytes),
      limit: formatBytes(limit),
      percent: Math.round((usage.usedBytes / limit) * 100),
      rows: storageBreakdown(user)
        .filter((row) => row.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .map((row) => ({
          key: row.key,
          label: row.label,
          human: formatBytes(row.bytes),
          share: Math.min(100, (row.bytes / limit) * 100),
        })),
      reclaimable: {
        human: formatBytes(reclaimable.bytes),
        files: reclaimable.files,
        hasStagedFiles: reclaimable.stagedFiles > 0,
      },
      canBuy: creditsEnabled(),
      buyCredits: EXTRA_STORAGE_CREDITS,
    };
  }

  let payment: PaymentPanel | undefined;
  const balance = await balanceOf(user);
  if (balance !== null) {
    const counts = optedInCounts(await listContacts(user), journal.owner);
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
    };
  }

  return <AccountPageContent username={user} storage={storage} payment={payment} />;
}
