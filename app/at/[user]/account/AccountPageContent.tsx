"use client";

import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { CreditCard, HardDrive } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { useNativeShell } from "@/components/nativeShell";
import { useSite } from "@/components/SiteProvider";
import OrderListItem from "@paid/printOrder/components/OrderListItem";
import { formatChf } from "@/lib/creditsFormat";
import type { TranslationKey } from "@/lib/i18n";
import type { OrderRow } from "@paid/printOrder/lib/orders";

/**
 * Credits and storage, on their own page — B821.
 *
 * Moved whole from `/[user]/me`, which held them among the contact form, the
 * journal's own title, the device list and the access panel. They are the
 * two questions an owner asks most often and most urgently — how much can I
 * still spend, how much room is left — and the only two on that page that
 * answer with a number rather than a form. B821 left a card on `/me` pointing
 * here; B876 removed it — the menu entry is the way in, and a card whose only
 * content is "this lives elsewhere" is a whole card to say so. The figures
 * live here and nowhere else, because two live copies of a balance is how
 * they disagree.
 *
 * Owner-only — `app/at/[user]/studio/account/page.tsx` (`requireStudioOwner`,
 * B2016) 404s for anybody else, the same gate `/me` uses. This file kept its
 * address under `app/at/[user]/account/` rather than moving with the route: the
 * component is the same one either way, and `app/at/[user]/account/page.tsx` is
 * now only a redirect to the studio address. `payment` is absent (not zero)
 * when credits are switched off; the page is then storage alone rather than
 * a broken half, exactly the
 * B74 rule the rest of `/me` already followed for these two panels.
 */

/**
 * One channel's mute switch — B463.
 *
 * The two capabilities that spend the balance this card is about, next to the
 * balance, for the person already signed in as the owner of it. Not a settings
 * page and deliberately not the shape of one: two named channels, and the
 * route behind it (`PATCH /api/web/<user>/channels`, the cookie proxy in
 * front of `PATCH /api/v2/<user>/channels`) accepts no other key.
 *
 * `router.refresh()` rather than local state, because the numbers beside it —
 * what a day costs now — are the server's and are exactly what changed.
 * Optimism here would show a total that the next navigation contradicts.
 */
function ChannelSwitch({
  username,
  channel,
  label,
  enabled,
}: {
  username: string;
  channel: "mail" | "whatsapp";
  label: string;
  enabled: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/web/${username}/channels`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [channel]: !enabled }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      {/* The word beside it is gone — B471. `role="switch"` with `aria-checked`
          announces on or off to a screen reader, and the control says it to
          everybody else; repeating it in text cost the width that made the
          switch wrap under the channel's name on a phone. The failure line
          stays, because that one is not visible in the control. */}
      {failed && (
        <span className="text-sm text-coral-600">
          {t("me.paymentChannelFailed")}
        </span>
      )}
      {/* Not a `BusyButton` — B867 deliberately stops here. This is a 24px
          switch, and there is nowhere in it for a spinner to go that is not on
          top of the thing it is reporting about. `disabled` still stops the
          second press, which is the half that matters. */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={busy}
        onClick={toggle}
        // Off is `navy-500` rather than the `navy-200` the card's rules use:
        // a border at 1.3:1 on white is a rule, not a control, and this one
        // has to look pressable while it is off. `navy-500` is the palette's
        // border-and-label ink (5.51:1 on white) — see apply-the-brand.
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
          enabled ? "border-action-strong bg-action-strong" : "border-line-prominent bg-surface-raised"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${
            enabled ? "left-[22px] bg-surface-raised" : "left-0.5 bg-line-prominent"
          }`}
          aria-hidden="true"
        />
      </button>
    </span>
  );
}

/**
 * Five more gigabytes, for fifty credits — B661.
 *
 * A button rather than the tiers dialog above it, because there is one thing
 * to buy and one price. It spends immediately: `PUT
 * /api/web/<user>/storage/purchases/<id>` takes the credits and the
 * extension exists from that moment, so the confirmation is the browser's
 * own — there is no second page to go to and nothing to come back and
 * finish. `router.refresh()` is what redraws the figure above it from the
 * server. The id is generated here, client-side, and only ever used once —
 * it exists so a retried request cannot double-spend, not because the
 * browser needs to remember it afterwards.
 */
/**
 * Give the space back — B664, asked in the page since B668.
 *
 * The confirmation **names what goes and what stays** before anything is
 * deleted, because the person pressing this has usually just been told their
 * journal is full and is in no mood to read carefully.
 *
 * The staged documents used to be a second `confirm()` stacked on the first,
 * which read as a stutter rather than as two questions. They are a checkbox
 * inside the one panel now, unticked: they are somebody's uploads rather than
 * generated output, so they are never swept along with the PDFs unless
 * somebody says so — see `lib/storageCleanup.ts`.
 */
function CleanupButton({
  username,
  reclaimable,
}: {
  username: string;
  reclaimable: StoragePanel["reclaimable"];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function clean() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(
      `/api/web/${username}/storage/cleanup${staged ? "?staged=1" : ""}`,
      { method: "POST" },
    ).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setAsking(false);
      router.refresh();
    } else setFailed(true);
  }

  if (asking) {
    return (
      <ConfirmPanel
        label={t("me.storageCleanup", { size: reclaimable.human })}
        question={t("me.storageCleanupConfirm", { size: reclaimable.human })}
        confirmLabel={t("me.storageCleanupGo")}
        tone="destructive"
        busyLabel={t("me.storageCleanupBusy")}
        busy={busy}
        error={failed ? t("me.storageCleanupFailed") : undefined}
        onConfirm={clean}
        onCancel={() => setAsking(false)}
      >
        {reclaimable.hasStagedFiles && (
          <label className="mt-3 flex items-start gap-2 text-sm leading-6 text-ink-body">
            <input
              type="checkbox"
              checked={staged}
              onChange={(event) => setStaged(event.target.checked)}
              className="mt-1.5 h-4 w-4 shrink-0 accent-navy-900"
            />
            <span>{t("me.storageCleanupStaged")}</span>
          </label>
        )}
      </ConfirmPanel>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setAsking(true);
        }}
        className="inline-flex min-h-11 items-center rounded-full border border-line-prominent px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base"
      >
        {t("me.storageCleanup", { size: reclaimable.human })}
      </button>
      {failed && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("me.storageCleanupFailed")}
        </span>
      )}
    </>
  );
}

/**
 * Which of these is the big one — B664.
 *
 * One stacked bar and a legend, rather than a table: the question an owner
 * actually has is comparative, and a column of numbers answers it slowest.
 * Colours are the brand's, in a fixed order so the same trip keeps the same
 * colour between renders; the legend carries the size in words, so the chart
 * is decoration and nothing is only available by looking at a colour.
 */
const BAR_COLOURS = [
  "bg-action-strong",
  "bg-yellow-400",
  "bg-sky-400",
  "bg-coral-400",
  "bg-green-500",
  "bg-ink-muted",
  "bg-yellow-600",
  "bg-sky-500",
];

/**
 * How many legend rows a journal with a lot of trips gets before it has to ask
 * — B1766. The bar keeps every segment whatever this is: the shares are what
 * make it a whole, and a bar that only adds up to 70% is a lie.
 */
const STORAGE_ROWS_SHOWN = 10;

function StorageBar({ rows }: { rows: StoragePanel["rows"] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, STORAGE_ROWS_SHOWN);
  return (
    <>
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-selected"
        aria-hidden="true"
      >
        {rows.map((row, at) => (
          <span
            key={row.key}
            className={BAR_COLOURS[at % BAR_COLOURS.length]}
            style={{ width: `${row.share}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {shown.map((row, at) => (
          <li
            key={row.key}
            className="flex items-center justify-between gap-3 text-base"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-3 w-3 shrink-0 rounded-full ${BAR_COLOURS[at % BAR_COLOURS.length]}`}
                aria-hidden="true"
              />
              <span className="truncate text-ink-body">{row.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink-strong">
              {row.human}
            </span>
          </li>
        ))}
      </ul>
      {!expanded && rows.length > STORAGE_ROWS_SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 min-h-11 px-2 text-sm text-ink-secondary underline underline-offset-4 transition-colors hover:text-ink-strong"
        >
          {t("common.showMore")}
        </button>
      )}
    </>
  );
}

/**
 * How full this journal is, and what is filling it — B661, B664.
 *
 * `limit` is null where the instance sets no ceiling, and then there is
 * nothing to be near the end of — the whole page section is absent then,
 * same as before B821.
 */
export type StoragePanel = {
  used: string;
  limit: string | null;
  percent: number | null;
  rows: { key: string; label: string; human: string; share: number }[];
  reclaimable: { human: string; files: number; hasStagedFiles: boolean };
  canBuy: boolean;
  buyCredits: number;
};

/**
 * Ledger reasons the owner sees, grouped — B1784.
 *
 * `lib/credits.ts` keeps one reason per door because that is what an operator
 * reconciles a supplier bill against; an owner reading her own account wants
 * "where did my credits go", and four AI doors she cannot tell apart is four
 * lines of noise. Anything not listed falls into `other`, so the next reason
 * added to the ledger cannot put a raw translation key on this page again —
 * which is exactly how `ask_thread` got there.
 */
const SPENT_GROUPS: Record<string, string> = {
  helper: "ai",
  transcription: "ai",
  ask_thread: "ai",
  find_in_journal: "ai",
  travellers_from_photo: "ai",
  day_mail: "messages",
  day_whatsapp: "messages",
  day_sms: "messages",
  invite: "messages",
  digest: "messages",
  postcard: "postcard",
  photobook: "photobook",
  photobook_print: "photobook",
  storage: "storage",
  refunded: "refunded",
};

export function groupSpent(
  spent: { reason: string; credits: number }[],
): { group: string; credits: number }[] {
  const totals = new Map<string, number>();
  for (const { reason, credits } of spent) {
    const group = SPENT_GROUPS[reason] ?? "other";
    totals.set(group, (totals.get(group) ?? 0) + credits);
  }
  return [...totals]
    // Credits carry hundredths (B987), so a sum of two of them can land on
    // 0.30000000000000004 in binary floating point.
    .map(([group, credits]) => ({ group, credits: Math.round(credits * 100) / 100 }))
    .sort((a, b) => b.credits - a.credits);
}

/** What the Payment section needs — B367. `undefined` is credits switched
 * off; the page shows storage alone then, per B821's own acceptance line. */
/**
 * "Your plan" — B2593. A functional first version of the canvas board
 * (`Account.dc.html`): plan, renewal/end date, the two meters that matter
 * (AI days, storage), the portal link, and the two buy buttons. Absent
 * (like `payment`/`storage`) rather than shown empty when `billing` is off
 * — an "unlimited, forever" card on every instance that has not turned
 * plans on would be noise, not news.
 */
export type PlanPanel = {
  plan: "free" | "pass" | "plus";
  /** `null` on Free, which has no period. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Only a paid Plus that is not cancelled renews; a pass, an admin grant
   *  and a cancelled Plus end on `periodEnd`. */
  renews: boolean;
  aiDays: { unlimited: true } | { unlimited: false; used: number; allowed: number };
  storageGb: number;
  /** Only Plus, bought through Stripe, has a subscription to manage. */
  hasStripeSubscription: boolean;
  /** `null` on Free (which has no entitlement row to name a source). An
   *  `apple` plan is managed in the App Store, not here — B2598. */
  source: "stripe" | "apple" | "admin" | null;
};

/** Buy a plan, or ask the operator to grant it when no Stripe key is
 *  configured (`dryRun`) — the same "ask, don't act" shape every panel on this page
 *  and `submitRequest` already take for credits.
 *
 *  Inside the iPhone shell this buys through StoreKit instead — Apple
 *  3.1.3(b) forbids pointing an in-app button at a web checkout — B2598. */
function BuyPlanButton({
  username,
  plan,
  label,
}: {
  username: string;
  plan: "pass" | "plus";
  label: string;
}) {
  const { t } = useI18n();
  const native = useNativeShell();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "failed" | "sent">("idle");

  async function buy() {
    setBusy(true);
    setState("idle");

    if (native) {
      const { buyApplePlan } = await import("@/components/nativeShell");
      const result = await buyApplePlan(username, plan).catch(() => ({ ok: false as const, reason: "failed" as const }));
      setBusy(false);
      if (!result.ok) {
        if (result.reason !== "cancelled") setState("failed");
        return;
      }
      window.location.reload();
      return;
    }

    const response = await fetch(`/api/web/${username}/billing/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setState("failed");
      return;
    }
    if (body?.url) {
      window.location.href = body.url as string;
      return;
    }
    // Dry run: no Stripe key, the operator was mailed — B2593.
    setState("sent");
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={buy}
        className="inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action transition-colors hover:bg-action-strong-hover disabled:opacity-50"
      >
        {label}
      </button>
      {state === "failed" && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.checkoutFailed")}
        </span>
      )}
      {state === "sent" && (
        <span role="status" className="mt-1 block text-sm text-ink-secondary">
          {t("billing.dryRunSent")}
        </span>
      )}
    </div>
  );
}

/** An Apple-sourced plan is managed in the App Store, not here — B2598.
 *  `itms-apps://apps.apple.com/account/subscriptions` opens Apple's own
 *  subscription settings; outside the shell it still works (Safari hands it
 *  to the App Store app), so no `useNativeShell` gate is needed here. */
function ManagedByApple() {
  const { t } = useI18n();
  return (
    <a
      href="itms-apps://apps.apple.com/account/subscriptions"
      className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base"
    >
      {t("billing.managedByApple")}
    </a>
  );
}

/** The Customer Portal — cancel, update the card, see invoices. */
function ManageSubscriptionButton({ username }: { username: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function open() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/web/${username}/billing/portal`, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok || !body?.url) {
      setFailed(true);
      return;
    }
    window.location.href = body.url as string;
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-base disabled:opacity-50"
      >
        {t("billing.manage")}
      </button>
      {failed && (
        <span role="status" className="mt-1 block text-sm text-coral-600">
          {t("billing.checkoutFailed")}
        </span>
      )}
    </div>
  );
}

function YourPlanPanel({ username, plan }: { username: string; plan: PlanPanel }) {
  const { t } = useI18n();
  const native = useNativeShell();
  const planTag = t(`plans.${plan.plan}` as "plans.free");
  const dateStr = plan.periodEnd ? plan.periodEnd.slice(0, 10) : null;

  return (
    <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-ink-strong">
          <CreditCard className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <h3 className="font-display text-lg font-semibold text-ink-strong">{t("billing.title")}</h3>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-2xl font-semibold text-ink-strong">{planTag}</span>
        {dateStr && (
          <span className="text-sm text-ink-secondary">
            {t(plan.renews ? "billing.renews" : "billing.ends", { date: dateStr })}
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-1 text-sm text-ink-body">
        <li>
          {plan.aiDays.unlimited
            ? t("billing.aiDaysUnlimited")
            : t("billing.aiDaysLeft", { used: String(plan.aiDays.used), allowed: String(plan.aiDays.allowed) })}
        </li>
        <li>{t("billing.storage", { size: `${plan.storageGb} GB` })}</li>
      </ul>

      <div className="mt-4 flex flex-wrap gap-3">
        {plan.hasStripeSubscription && <ManageSubscriptionButton username={username} />}
        {plan.source === "apple" && <ManagedByApple />}
        {plan.plan !== "plus" && <BuyPlanButton username={username} plan="plus" label={t("billing.buyPlus")} />}
        {plan.plan === "free" && <BuyPlanButton username={username} plan="pass" label={t("billing.buyPass")} />}
      </div>
      {native && <RestoreApplePurchasesButton username={username} />}
    </div>
  );
}

/** "Restore purchases" — App Store guideline 3.1.2: a purchase made on
 *  another device (or after a reinstall) must be recoverable without a new
 *  charge. Shown only in the shell, since it is meaningless on the web —
 *  B2598. */
function RestoreApplePurchasesButton({ username }: { username: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function restore() {
    setBusy(true);
    setState("idle");
    try {
      const { restoreApplePurchases } = await import("@/components/nativeShell");
      await restoreApplePurchases(username);
      setState("done");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="mt-3 text-sm">
      <button type="button" disabled={busy} onClick={restore} className="font-semibold text-ink-body underline decoration-line-strong underline-offset-2 hover:text-ink-strong disabled:opacity-50">
        {t("billing.restorePurchases")}
      </button>
      {state === "done" && <span className="ml-2 text-ink-secondary">{t("billing.restoreDone")}</span>}
      {state === "failed" && <span className="ml-2 text-coral-600">{t("billing.checkoutFailed")}</span>}
    </p>
  );
}

export type PaymentPanel = {
  balance: number;
  emailRecipients: number;
  whatsappRecipients: number;
  channels: { mail: boolean | null; whatsapp: boolean | null };
  postcardCredits: number | null;
  transactions: PaymentRow[];
  /** What credits have gone on, biggest first — B860. Empty when the journal
   *  has never spent one. */
  spent: { reason: string; credits: number }[];
  /** B2090: card payments go to Stripe's test mode (a `sk_test_` key), so
   *  no real money moves — said once under the buy button. */
  cardTestMode?: boolean;
};

/** One row of the transaction history. `amount` is a preformatted CHF string
 * (server-side, from the pricing table) so the component never does money
 * arithmetic. */
type PaymentRow = {
  id: string;
  credits: number;
  amount: string;
  status: "pending" | "requested" | "paid" | "refunded";
  createdAt: string;
};

export default function AccountPageContent({
  username,
  storage,
  payment,
  orders,
  plan,
}: {
  username: string;
  /** Absent only where the instance sets no ceiling. */
  storage?: StoragePanel;
  /** Absent when credits are switched off. */
  payment?: PaymentPanel;
  /** The 3 most recent orders and the total count — B1452. */
  orders: { recent: OrderRow[]; total: number };
  /** Absent when `billing` is off. */
  plan?: PlanPanel;
}) {
  const { t, tn } = useI18n();
  const site = useSite();

  return (
    <>

        <div className="mt-6 space-y-4">
          {orders.recent.length > 0 && (
            // B1452. At the top — what an owner asks most right after a
            // purchase is "did it go through", not their balance.
            <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-semibold text-ink-strong">
                  {t("orders.title")}
                </h3>
                {/* B2135 — every order, on its own studio page. */}
                {orders.total > 0 && (
                  <Link
                    href={`${site.base}/studio/orders`}
                    className="text-sm font-semibold text-ink-body transition-colors hover:text-ink-strong"
                  >
                    {t("orders.viewAll")}
                  </Link>
                )}
              </div>
              <ul className="mt-2 -mx-5 divide-y divide-line-quiet border-t border-line-quiet sm:-mx-6">
                {orders.recent.map((order) => (
                  <OrderListItem key={`${order.kind}-${order.id}`} order={order} />
                ))}
              </ul>
            </div>
          )}

          {plan && <YourPlanPanel username={username} plan={plan} />}


          {storage && (
            <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-ink-strong">
                  <HardDrive className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h3 className="font-display text-lg font-semibold text-ink-strong">
                  {t("me.storageTitle")}
                </h3>
              </div>

              <p className="mt-4 text-base text-ink-strong">
                {t("me.storageUsed", {
                  used: storage.used,
                  limit: storage.limit ?? "",
                })}
              </p>
              {storage.percent !== null && storage.percent >= 90 && (
                <p className="mt-1 text-sm leading-6 text-coral-600">
                  {t("me.storageNearlyFull")}
                </p>
              )}

              {storage.rows.length > 0 && <StorageBar rows={storage.rows} />}

              {storage.reclaimable.files > 0 && (
                <div className="mt-5 border-t border-line-quiet pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <CleanupButton
                      username={username}
                      reclaimable={storage.reclaimable}
                    />
                  </div>
                  {storage.reclaimable.files > 0 && (
                    <p className="mt-2 text-sm leading-6 text-ink-secondary">
                      {t("me.storageCleanupBody")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!storage && !payment && (
            // Neither figure has anything behind it — no ceiling configured
            // and credits switched off. Rare (an instance normally sets one
            // or the other), but a page with two absent cards and no
            // explanation reads as broken rather than as "nothing to show".
            <p className="rounded-2xl border border-line-quiet bg-surface-raised p-5 text-base leading-7 text-ink-body sm:p-6">
              {t("me.accountCardBody")}
            </p>
          )}
        </div>
    </>
  );
}
